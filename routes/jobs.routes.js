const express = require('express');
const Job = require('../models/Job');
const { auth, optionalAuth } = require('../middleware/auth');
const { validateJob, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Get all jobs with filtering
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      employmentType,
      experienceLevel,
      location,
      salaryMin,
      salaryMax,
      skills,
      status = 'active'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status };

    // Build search query
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }

    if (employmentType) {
      query.employmentType = { $in: Array.isArray(employmentType) ? employmentType : [employmentType] };
    }
    if (experienceLevel) {
      query.experienceLevel = { $in: Array.isArray(experienceLevel) ? experienceLevel : [experienceLevel] };
    }
    if (location) {
      query.$or = [
        { 'location.city': { $regex: location, $options: 'i' } },
        { 'location.country': { $regex: location, $options: 'i' } }
      ];
    }
    if (skills) {
      query.skills = { $in: Array.isArray(skills) ? skills : [skills] };
    }

    // Salary range filter
    if (salaryMin || salaryMax) {
      query['salaryRange.min'] = {};
      if (salaryMin) query['salaryRange.min'].$gte = parseInt(salaryMin);
      if (salaryMax) query['salaryRange.max'] = { $lte: parseInt(salaryMax) };
    }

    const cacheKey = `jobs:${JSON.stringify({ page, limit, search, employmentType, experienceLevel, location, salaryMin, salaryMax, skills, status })}`;
    let cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName email')
      .select('-applications') // Don't include applications in list view
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Job.countDocuments(query);

    const result = {
      success: true,
      data: {
        jobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    };

    // Cache for 10 minutes
    await cache.set(cacheKey, result, 600);
    res.json(result);

  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
});

// Get single job
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('postedBy', 'firstName lastName email')
      .populate('applications.applicant', 'firstName lastName email');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Increment view count
    job.views += 1;
    await job.save();

    // Check if current user has applied
    let userApplication = null;
    if (req.user) {
      userApplication = job.applications.find(
        app => app.applicant._id.toString() === (req.user._id || req.user.id).toString()
      );
    }

    res.json({
      success: true,
      data: {
        job,
        userApplication
      }
    });

  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job'
    });
  }
});

// Create new job
router.post('/', [auth, validateJob], async (req, res) => {
  try {
    const jobData = {
      ...req.body,
      postedBy: req.user._id || req.user.id
    };

    const job = new Job(jobData);
    await job.save();

    // Clear jobs cache
    await cache.del('jobs:*');

    res.status(201).json({
      success: true,
      message: 'Job posted successfully',
      data: job
    });

  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create job'
    });
  }
});

// Update job
router.put('/:id', [auth, validateJob], async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this job'
      });
    }

    Object.assign(job, req.body);
    await job.save();

    // Clear cache
    await cache.del('jobs:*');

    res.json({
      success: true,
      message: 'Job updated successfully',
      data: job
    });

  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job'
    });
  }
});

// Apply for job
router.post('/:id/apply', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { coverLetter, resumeUrl } = req.body;
    
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Job is not available for applications'
      });
    }

    // Check if already applied
    const existingApplication = job.applications.find(
      app => app.applicant.toString() === userId.toString()
    );

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'Already applied for this job'
      });
    }

    // Check application deadline
    if (job.applicationDeadline && new Date() > job.applicationDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Application deadline has passed'
      });
    }

    job.applications.push({
      applicant: userId,
      coverLetter,
      resumeUrl
    });

    await job.save();

    res.json({
      success: true,
      message: 'Application submitted successfully'
    });

  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application'
    });
  }
});

// Get user's applications
router.get('/me/applications', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const jobs = await Job.find({
      'applications.applicant': userId
    })
    .populate('postedBy', 'firstName lastName')
    .select('title company location employmentType applications.$ applications.status applications.appliedAt');

    const applications = jobs.map(job => ({
      job: {
        id: job._id,
        title: job.title,
        company: job.company,
        location: job.location,
        employmentType: job.employmentType,
        postedBy: job.postedBy
      },
      application: job.applications[0] // Will only have one due to applications.$
    }));

    res.json({
      success: true,
      data: applications
    });

  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications'
    });
  }
});

// Get jobs posted by current user
router.get('/me/posted', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const jobs = await Job.find({ postedBy: userId })
      .populate('applications.applicant', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: jobs
    });

  } catch (error) {
    console.error('Get posted jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posted jobs'
    });
  }
});

// Update application status (for job posters)
router.put('/:id/applications/:applicationId', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { status } = req.body;
    
    if (!['pending', 'under_review', 'interview', 'rejected', 'accepted'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update applications'
      });
    }

    const application = job.applications.id(req.params.applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    application.status = status;
    await job.save();

    res.json({
      success: true,
      message: 'Application status updated successfully'
    });

  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status'
    });
  }
});

module.exports = router;