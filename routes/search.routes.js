// routes/search.routes.js
const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Event = require('../models/Event');
const Job = require('../models/Job');
const { auth, optionalAuth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');

const router = express.Router();

// Global search endpoint
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      q, // search query
      type = 'all', // alumni, events, jobs, all
      page = 1,
      limit = 20
    } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const searchTerm = q.trim();
    const skip = (page - 1) * limit;
    const results = {};

    // Search alumni
    if (type === 'all' || type === 'alumni') {
      results.alumni = await searchAlumni(searchTerm, skip, limit);
    }

    // Search events
    if (type === 'all' || type === 'events') {
      results.events = await searchEvents(searchTerm, skip, limit);
    }

    // Search jobs
    if (type === 'all' || type === 'jobs') {
      results.jobs = await searchJobs(searchTerm, skip, limit);
    }

    res.json({
      success: true,
      data: {
        query: searchTerm,
        results,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed'
    });
  }
});

// Advanced alumni search
router.get('/alumni', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      q,
      graduationYear,
      graduationYearFrom,
      graduationYearTo,
      program,
      degree,
      location,
      currentCompany,
      industry,
      skills,
      employmentStatus,
      openToOpportunities,
      availableForMentoring,
      page = 1,
      limit = 20,
      sortBy = 'relevance' // relevance, name, graduationYear, lastActive
    } = req.query;

    const skip = (page - 1) * limit;

    // Build search pipeline
    const pipeline = [];

    // Match users (alumni only, active, and with proper visibility)
    const userMatch = {
      role: 'alumni',
      isActive: true
    };

    if (q) {
      userMatch.$or = [
        { firstName: { $regex: q, $options: 'i' } },
        { lastName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ];
    }

    pipeline.push({ $match: userMatch });

    // Lookup profiles
    pipeline.push({
      $lookup: {
        from: 'profiles',
        localField: '_id',
        foreignField: 'user',
        as: 'profile'
      }
    });

    pipeline.push({ $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } });

    // Build profile match conditions
    const profileMatch = {
      'profile.profileVisibility': { $ne: 'private' }
    };

    if (graduationYear) {
      profileMatch['profile.graduationYear'] = parseInt(graduationYear);
    }

    if (graduationYearFrom || graduationYearTo) {
      profileMatch['profile.graduationYear'] = {};
      if (graduationYearFrom) profileMatch['profile.graduationYear'].$gte = parseInt(graduationYearFrom);
      if (graduationYearTo) profileMatch['profile.graduationYear'].$lte = parseInt(graduationYearTo);
    }

    if (program) {
      profileMatch['profile.program'] = { $regex: program, $options: 'i' };
    }

    if (degree) {
      profileMatch['profile.degree'] = degree;
    }

    if (location) {
      profileMatch['profile.location'] = { $regex: location, $options: 'i' };
    }

    if (currentCompany) {
      profileMatch['profile.currentCompany'] = { $regex: currentCompany, $options: 'i' };
    }

    if (industry) {
      profileMatch['profile.industry'] = { $regex: industry, $options: 'i' };
    }

    if (skills) {
      const skillsArray = Array.isArray(skills) ? skills : [skills];
      profileMatch['profile.skills'] = { $in: skillsArray.map(skill => new RegExp(skill, 'i')) };
    }

    if (employmentStatus) {
      profileMatch['profile.employmentStatus'] = employmentStatus;
    }

    if (openToOpportunities === 'true') {
      profileMatch['profile.openToOpportunities'] = true;
    }

    if (availableForMentoring === 'true') {
      profileMatch['profile.availableForMentoring'] = true;
    }

    // Apply profile filters
    if (Object.keys(profileMatch).length > 1) {
      pipeline.push({ $match: profileMatch });
    }

    // Add search relevance score
    if (q) {
      pipeline.push({
        $addFields: {
          searchScore: {
            $add: [
              { $cond: [{ $regexMatch: { input: '$firstName', regex: new RegExp(q, 'i') } }, 10, 0] },
              { $cond: [{ $regexMatch: { input: '$lastName', regex: new RegExp(q, 'i') } }, 10, 0] },
              { $cond: [{ $regexMatch: { input: '$profile.currentPosition', regex: new RegExp(q, 'i') } }, 5, 0] },
              { $cond: [{ $regexMatch: { input: '$profile.currentCompany', regex: new RegExp(q, 'i') } }, 5, 0] },
              { $cond: [{ $regexMatch: { input: '$profile.bio', regex: new RegExp(q, 'i') } }, 3, 0] }
            ]
          }
        }
      });
    }

    // Sort based on sortBy parameter
    let sortStage = {};
    switch (sortBy) {
      case 'name':
        sortStage = { firstName: 1, lastName: 1 };
        break;
      case 'graduationYear':
        sortStage = { 'profile.graduationYear': -1 };
        break;
      case 'lastActive':
        sortStage = { 'profile.lastActiveAt': -1 };
        break;
      case 'relevance':
      default:
        sortStage = q ? { searchScore: -1, 'profile.lastActiveAt': -1 } : { 'profile.lastActiveAt': -1 };
    }

    pipeline.push({ $sort: sortStage });

    // Project only needed fields
    pipeline.push({
      $project: {
        password: 0,
        resetPasswordToken: 0,
        resetPasswordExpires: 0,
        emailVerificationToken: 0,
        emailVerificationExpires: 0,
        'profile.connections': 0
      }
    });

    // Get total count for pagination
    const totalPipeline = [...pipeline, { $count: 'total' }];
    const totalResult = await User.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    const alumni = await User.aggregate(pipeline);

    res.json({
      success: true,
      data: {
        alumni,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        },
        filters: {
          graduationYear,
          graduationYearFrom,
          graduationYearTo,
          program,
          degree,
          location,
          currentCompany,
          industry,
          skills,
          employmentStatus,
          openToOpportunities,
          availableForMentoring,
          sortBy
        }
      }
    });

  } catch (error) {
    console.error('Advanced alumni search error:', error);
    res.status(500).json({
      success: false,
      message: 'Alumni search failed'
    });
  }
});

// Advanced job search
router.get('/jobs', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      q,
      company,
      location,
      employmentType,
      experienceLevel,
      skills,
      salaryMin,
      salaryMax,
      postedSince, // days
      page = 1,
      limit = 20,
      sortBy = 'relevance' // relevance, date, salary, company
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    let query = { status: 'active' };

    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } }
      ];
    }

    if (company) {
      query.company = { $regex: company, $options: 'i' };
    }

    if (location) {
      query.$or = [
        { 'location.city': { $regex: location, $options: 'i' } },
        { 'location.country': { $regex: location, $options: 'i' } }
      ];
    }

    if (employmentType) {
      const types = Array.isArray(employmentType) ? employmentType : [employmentType];
      query.employmentType = { $in: types };
    }

    if (experienceLevel) {
      const levels = Array.isArray(experienceLevel) ? experienceLevel : [experienceLevel];
      query.experienceLevel = { $in: levels };
    }

    if (skills) {
      const skillsArray = Array.isArray(skills) ? skills : [skills];
      query.skills = { $in: skillsArray.map(skill => new RegExp(skill, 'i')) };
    }

    if (salaryMin || salaryMax) {
      query['salaryRange.min'] = {};
      if (salaryMin) query['salaryRange.min'].$gte = parseInt(salaryMin);
      if (salaryMax) query['salaryRange.max'] = { $lte: parseInt(salaryMax) };
    }

    if (postedSince) {
      const daysAgo = new Date(Date.now() - parseInt(postedSince) * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: daysAgo };
    }

    // Build sort
    let sort = {};
    switch (sortBy) {
      case 'date':
        sort = { createdAt: -1 };
        break;
      case 'salary':
        sort = { 'salaryRange.max': -1 };
        break;
      case 'company':
        sort = { company: 1 };
        break;
      case 'relevance':
      default:
        sort = { createdAt: -1 }; // Default to newest first
    }

    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        },
        filters: {
          company,
          location,
          employmentType,
          experienceLevel,
          skills,
          salaryMin,
          salaryMax,
          postedSince,
          sortBy
        }
      }
    });

  } catch (error) {
    console.error('Advanced job search error:', error);
    res.status(500).json({
      success: false,
      message: 'Job search failed'
    });
  }
});

// Advanced event search
router.get('/events', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      q,
      eventType,
      location,
      startDate,
      endDate,
      isOnline,
      upcoming = 'true',
      page = 1,
      limit = 20,
      sortBy = 'date' // date, relevance, popularity
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    let query = { status: 'published' };

    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    if (eventType) {
      const types = Array.isArray(eventType) ? eventType : [eventType];
      query.eventType = { $in: types };
    }

    if (location && isOnline !== 'true') {
      query.$or = [
        { 'location.venue': { $regex: location, $options: 'i' } },
        { 'location.city': { $regex: location, $options: 'i' } }
      ];
    }

    if (isOnline === 'true') {
      query['location.isOnline'] = true;
    } else if (isOnline === 'false') {
      query['location.isOnline'] = false;
    }

    if (upcoming === 'true') {
      query.startDate = { $gte: new Date() };
    }

    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }

    // Build sort
    let sort = {};
    switch (sortBy) {
      case 'popularity':
        // Use aggregation for popularity sort
        const popularEvents = await Event.aggregate([
          { $match: query },
          {
            $addFields: {
              attendeeCount: { $size: '$attendees' }
            }
          },
          { $sort: { attendeeCount: -1, startDate: 1 } },
          { $skip: skip },
          { $limit: parseInt(limit) },
          {
            $lookup: {
              from: 'users',
              localField: 'organizer',
              foreignField: '_id',
              as: 'organizer',
              pipeline: [{ $project: { firstName: 1, lastName: 1 } }]
            }
          },
          { $unwind: '$organizer' }
        ]);

        const totalPopular = await Event.countDocuments(query);

        return res.json({
          success: true,
          data: {
            events: popularEvents,
            pagination: {
              currentPage: parseInt(page),
              totalPages: Math.ceil(totalPopular / limit),
              totalItems: totalPopular,
              hasNext: page * limit < totalPopular,
              hasPrev: page > 1
            },
            filters: {
              eventType,
              location,
              startDate,
              endDate,
              isOnline,
              upcoming,
              sortBy
            }
          }
        });

      case 'relevance':
        sort = { createdAt: -1 };
        break;
      case 'date':
      default:
        sort = { startDate: 1 };
    }

    const events = await Event.find(query)
      .populate('organizer', 'firstName lastName')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Event.countDocuments(query);

    res.json({
      success: true,
      data: {
        events,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        },
        filters: {
          eventType,
          location,
          startDate,
          endDate,
          isOnline,
          upcoming,
          sortBy
        }
      }
    });

  } catch (error) {
    console.error('Advanced event search error:', error);
    res.status(500).json({
      success: false,
      message: 'Event search failed'
    });
  }
});

// Get search suggestions/autocomplete
router.get('/suggestions', optionalAuth, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: { suggestions: [] }
      });
    }

    const suggestions = {};

    if (type === 'all' || type === 'skills') {
      // Get skill suggestions
      suggestions.skills = await Profile.distinct('skills', {
        skills: { $regex: q, $options: 'i' }
      }).limit(10);
    }

    if (type === 'all' || type === 'companies') {
      // Get company suggestions
      suggestions.companies = await Profile.distinct('currentCompany', {
        currentCompany: { $regex: q, $options: 'i' },
        currentCompany: { $ne: null }
      }).limit(10);
    }

    if (type === 'all' || type === 'locations') {
      // Get location suggestions
      suggestions.locations = await Profile.distinct('location', {
        location: { $regex: q, $options: 'i' },
        location: { $ne: null }
      }).limit(10);
    }

    if (type === 'all' || type === 'programs') {
      // Get program suggestions
      suggestions.programs = await Profile.distinct('program', {
        program: { $regex: q, $options: 'i' },
        program: { $ne: null }
      }).limit(10);
    }

    res.json({
      success: true,
      data: { suggestions }
    });

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggestions'
    });
  }
});

// Get search statistics
router.get('/stats', optionalAuth, async (req, res) => {
  try {
    const stats = await Promise.all([
      User.countDocuments({ role: 'alumni', isActive: true }),
      Event.countDocuments({ status: 'published' }),
      Job.countDocuments({ status: 'active' }),
      Profile.distinct('skills').then(skills => skills.length),
      Profile.distinct('currentCompany', { currentCompany: { $ne: null } }).then(companies => companies.length),
      Profile.distinct('location', { location: { $ne: null } }).then(locations => locations.length)
    ]);

    res.json({
      success: true,
      data: {
        totalAlumni: stats[0],
        totalEvents: stats[1],
        totalJobs: stats[2],
        uniqueSkills: stats[3],
        uniqueCompanies: stats[4],
        uniqueLocations: stats[5]
      }
    });

  } catch (error) {
    console.error('Search stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch search statistics'
    });
  }
});

// Helper functions
async function searchAlumni(query, skip, limit) {
  const userMatch = {
    role: 'alumni',
    isActive: true,
    $or: [
      { firstName: { $regex: query, $options: 'i' } },
      { lastName: { $regex: query, $options: 'i' } }
    ]
  };

  return await User.aggregate([
    { $match: userMatch },
    {
      $lookup: {
        from: 'profiles',
        localField: '_id',
        foreignField: 'user',
        as: 'profile'
      }
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    { $match: { 'profile.profileVisibility': { $ne: 'private' } } },
    {
      $project: {
        firstName: 1,
        lastName: 1,
        'profile.currentPosition': 1,
        'profile.currentCompany': 1,
        'profile.location': 1,
        'profile.profilePicture': 1
      }
    },
    { $skip: skip },
    { $limit: limit }
  ]);
}

async function searchEvents(query, skip, limit) {
  return await Event.find({
    status: 'published',
    $or: [
      { title: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } }
    ]
  })
  .populate('organizer', 'firstName lastName')
  .select('title description startDate location eventType')
  .sort({ startDate: 1 })
  .skip(skip)
  .limit(limit)
  .lean();
}

async function searchJobs(query, skip, limit) {
  return await Job.find({
    status: 'active',
    $or: [
      { title: { $regex: query, $options: 'i' } },
      { description: { $regex: query, $options: 'i' } },
      { company: { $regex: query, $options: 'i' } }
    ]
  })
  .populate('postedBy', 'firstName lastName')
  .select('title company location employmentType salaryRange createdAt')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
}

module.exports = router;