const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Event = require('../models/Event');
const Job = require('../models/Job');
const { Survey, SurveyResponse } = require('../models/Survey');
const { auth, adminAuth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');
const emailService = require('../services/emailService');

const router = express.Router();

// Admin dashboard analytics
router.get('/dashboard', [auth, adminAuth], async (req, res) => {
  try {
    const cacheKey = 'admin:dashboard';
    let cachedData = await cache.get(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData);
    }

    // Get counts
    const [
      totalUsers,
      totalAlumni,
      activeUsers,
      totalEvents,
      upcomingEvents,
      totalJobs,
      activeJobs,
      totalSurveys,
      activeSurveys,
      totalSurveyResponses
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'alumni' }),
      User.countDocuments({ isActive: true }),
      Event.countDocuments(),
      Event.countDocuments({ status: 'published', startDate: { $gte: new Date() } }),
      Job.countDocuments(),
      Job.countDocuments({ status: 'active' }),
      Survey.countDocuments(),
      Survey.countDocuments({ status: 'active' }),
      SurveyResponse.countDocuments()
    ]);

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const [
      newUsersThisMonth,
      newEventsThisMonth,
      newJobsThisMonth,
      newSurveyResponsesThisMonth
    ] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Event.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Job.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      SurveyResponse.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    ]);

    // User registration trends (last 6 months)
    const registrationTrends = await getUserRegistrationTrends();

    const dashboardData = {
      success: true,
      data: {
        overview: {
          totalUsers,
          totalAlumni,
          activeUsers,
          totalEvents,
          upcomingEvents,
          totalJobs,
          activeJobs,
          totalSurveys,
          activeSurveys,
          totalSurveyResponses
        },
        recentActivity: {
          newUsersThisMonth,
          newEventsThisMonth,
          newJobsThisMonth,
          newSurveyResponsesThisMonth
        },
        trends: {
          userRegistrations: registrationTrends
        }
      }
    };

    // Cache for 30 minutes
    await cache.set(cacheKey, dashboardData, 1800);
    res.json(dashboardData);

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

// User management
router.get('/users', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      role,
      status,
      isVerified
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (isVerified === 'true') query.isVerified = true;
    if (isVerified === 'false') query.isVerified = false;

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// Update user status
router.put('/users/:id/status', [auth, adminAuth], async (req, res) => {
  try {
    const { isActive, isVerified } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (typeof isVerified === 'boolean') user.isVerified = isVerified;

    await user.save();

    // Clear user cache
    await cache.del(`user:${user._id}`);

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: user
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

// Delete user
router.delete('/users/:id', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Don't allow deleting other admins
    if (user.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete admin users'
      });
    }

    // Delete associated profile
    await Profile.findOneAndDelete({ user: user._id });

    // Remove user from events and jobs
    await Event.updateMany(
      { 'attendees.user': user._id },
      { $pull: { attendees: { user: user._id } } }
    );

    await Job.updateMany(
      { 'applications.applicant': user._id },
      { $pull: { applications: { applicant: user._id } } }
    );

    // Delete survey responses
    await SurveyResponse.deleteMany({ respondent: user._id });

    // Finally delete the user
    await User.findByIdAndDelete(req.params.id);

    // Clear caches
    await cache.del(`user:${user._id}`);
    await cache.flush(); // Clear all cache to ensure consistency

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

// Event management
router.get('/events', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const events = await Event.find()
      .populate('organizer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Event.countDocuments();

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
        }
      }
    });

  } catch (error) {
    console.error('Get admin events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events'
    });
  }
});

// Job management
router.get('/jobs', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const jobs = await Job.find()
      .populate('postedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Job.countDocuments();

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
        }
      }
    });

  } catch (error) {
    console.error('Get admin jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
});

// Send bulk email
router.post('/send-email', [auth, adminAuth], async (req, res) => {
  try {
    const { subject, message, recipients } = req.body;

    if (!subject || !message || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({
        success: false,
        message: 'Subject, message, and recipients array are required'
      });
    }

    const results = [];
    
    for (const email of recipients) {
      try {
        const result = await emailService.sendEmail(email, subject, message);
        results.push({ email, success: result.success });
      } catch (error) {
        results.push({ email, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      message: `Emails sent successfully to ${successCount} out of ${recipients.length} recipients`,
      data: results
    });

  } catch (error) {
    console.error('Send bulk email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send emails'
    });
  }
});

// Export data
router.get('/export/:type', [auth, adminAuth], async (req, res) => {
  try {
    const { type } = req.params;
    let data;

    switch (type) {
      case 'users':
        data = await User.find().select('-password').lean();
        break;
      case 'alumni':
        data = await User.find({ role: 'alumni' }).select('-password').lean();
        break;
      case 'events':
        data = await Event.find().populate('organizer', 'firstName lastName email').lean();
        break;
      case 'jobs':
        data = await Job.find().populate('postedBy', 'firstName lastName email').lean();
        break;
      case 'surveys':
        data = await Survey.find().populate('createdBy', 'firstName lastName email').lean();
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    res.json({
      success: true,
      data,
      exportedAt: new Date().toISOString(),
      count: data.length
    });

  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
});

// Helper function for user registration trends
async function getUserRegistrationTrends() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const trends = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: sixMonthsAgo }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 }
    }
  ]);

  return trends.map(trend => ({
    month: `${trend._id.year}-${String(trend._id.month).padStart(2, '0')}`,
    count: trend.count
  }));
}

module.exports = router;