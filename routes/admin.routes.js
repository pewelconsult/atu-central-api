// routes/admin.routes.js - ALL ADMIN OPERATIONS

const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Event = require('../models/Event');
const Job = require('../models/Job');
const { Survey, SurveyResponse } = require('../models/Survey');
const { Forum, ForumPost, ForumReply } = require('../models/Forum');
const Activity = require('../models/Activity');
const { auth, adminAuth } = require('../middleware/auth');
const { validatePagination, validateSurvey, validateEvent, validateJob } = require('../middleware/validation');
const { cache } = require('../config/database');
const emailService = require('../services/emailService');
const Communication = require('../models/Communication'); 
const smsService = require('../services/smsService');



const router = express.Router();

// ===================== HELPER FUNCTIONS =====================

// Audit log helper
const createAuditLog = async (adminId, action, targetType, targetId, metadata = {}) => {
  try {
    await Activity.createActivity({
      user: adminId,
      type: 'admin_action',
      action: action,
      description: `Admin action: ${action}`,
      metadata: {
        targetType,
        targetId,
        ...metadata,
        adminAction: true,
        timestamp: new Date()
      },
      visibility: 'admin',
      points: 0,
      isSystemGenerated: true
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

// ===================== DASHBOARD =====================

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
      pendingEvents,
      totalJobs,
      activeJobs,
      pendingJobs,
      totalSurveys,
      activeSurveys,
      totalSurveyResponses,
      totalForums,
      totalForumPosts
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'alumni' }),
      User.countDocuments({ isActive: true }),
      Event.countDocuments(),
      Event.countDocuments({ status: 'published', startDate: { $gte: new Date() } }),
      Event.countDocuments({ status: 'pending_approval' }),
      Job.countDocuments(),
      Job.countDocuments({ status: 'active' }),
      Job.countDocuments({ status: 'pending' }),
      Survey.countDocuments(),
      Survey.countDocuments({ status: 'active' }),
      SurveyResponse.countDocuments(),
      Forum.countDocuments(),
      ForumPost.countDocuments()
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

    // Recent admin actions
    const recentAdminActions = await Activity.find({
      'metadata.adminAction': true
    })
    .populate('user', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(10);

    const dashboardData = {
      success: true,
      data: {
        overview: {
          totalUsers,
          totalAlumni,
          activeUsers,
          totalEvents,
          upcomingEvents,
          pendingEvents,
          totalJobs,
          activeJobs,
          pendingJobs,
          totalSurveys,
          activeSurveys,
          totalSurveyResponses,
          totalForums,
          totalForumPosts
        },
        recentActivity: {
          newUsersThisMonth,
          newEventsThisMonth,
          newJobsThisMonth,
          newSurveyResponsesThisMonth
        },
        trends: {
          userRegistrations: registrationTrends
        },
        recentAdminActions
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

// ===================== USER MANAGEMENT =====================

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

    const changes = {};
    if (typeof isActive === 'boolean') {
      changes.isActive = { from: user.isActive, to: isActive };
      user.isActive = isActive;
    }
    if (typeof isVerified === 'boolean') {
      changes.isVerified = { from: user.isVerified, to: isVerified };
      user.isVerified = isVerified;
    }

    await user.save();
    await cache.del(`user:${user._id}`);

    // Audit log
    await createAuditLog(req.user._id, 'User status updated', 'User', user._id, { changes });

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

router.delete('/users/:id', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete admin users'
      });
    }

    // Cascade delete
    await Profile.findOneAndDelete({ user: user._id });
    await Event.updateMany(
      { 'attendees.user': user._id },
      { $pull: { attendees: { user: user._id } } }
    );
    await Job.updateMany(
      { 'applications.applicant': user._id },
      { $pull: { applications: { applicant: user._id } } }
    );
    await SurveyResponse.deleteMany({ respondent: user._id });
    
    // Audit log before deletion
    await createAuditLog(req.user._id, 'User deleted', 'User', user._id, {
      deletedUser: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`
      }
    });

    await User.findByIdAndDelete(req.params.id);
    await cache.flush();

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

// ===================== SURVEY MANAGEMENT =====================

router.get('/surveys', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      surveyType
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (status && status !== 'all') query.status = status;
    if (surveyType) query.surveyType = surveyType;

    const surveys = await Survey.find(query)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Survey.countDocuments(query);

    res.json({
      success: true,
      data: {
        surveys,
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
    console.error('Get admin surveys error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch surveys'
    });
  }
});

router.post('/surveys', [auth, adminAuth, validateSurvey], async (req, res) => {
  try {
    const surveyData = {
      ...req.body,
      createdBy: req.user._id || req.user.id
    };

    const survey = new Survey(surveyData);
    await survey.save();

    // Audit log
    await createAuditLog(req.user._id, 'Survey created', 'Survey', survey._id, {
      surveyTitle: survey.title,
      surveyType: survey.surveyType
    });

    // Clear cache
    await cache.flush();

    res.status(201).json({
      success: true,
      message: 'Survey created successfully',
      data: survey
    });

  } catch (error) {
    console.error('Create survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create survey'
    });
  }
});

router.put('/surveys/:id', [auth, adminAuth, validateSurvey], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    if (survey.responseCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit survey with existing responses'
      });
    }

    Object.assign(survey, req.body);
    await survey.save();

    // Audit log
    await createAuditLog(req.user._id, 'Survey updated', 'Survey', survey._id);

    await cache.flush();

    res.json({
      success: true,
      message: 'Survey updated successfully',
      data: survey
    });

  } catch (error) {
    console.error('Update survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update survey'
    });
  }
});

router.patch('/surveys/:id/status', [auth, adminAuth], async (req, res) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['draft', 'active', 'paused', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }
    
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    const previousStatus = survey.status;
    survey.status = status;
    await survey.save();

    // Audit log
    await createAuditLog(req.user._id, 'Survey status changed', 'Survey', survey._id, {
      previousStatus,
      newStatus: status
    });

    await cache.flush();

    res.json({
      success: true,
      message: `Survey status updated to ${status}`,
      data: survey
    });

  } catch (error) {
    console.error('Update survey status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update survey status'
    });
  }
});

router.delete('/surveys/:id', [auth, adminAuth], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    if (survey.responseCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete survey with existing responses'
      });
    }

    // Audit log
    await createAuditLog(req.user._id, 'Survey deleted', 'Survey', survey._id, {
      surveyTitle: survey.title
    });

    await survey.deleteOne();
    await cache.flush();

    res.json({
      success: true,
      message: 'Survey deleted successfully'
    });

  } catch (error) {
    console.error('Delete survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete survey'
    });
  }
});

router.get('/surveys/:id/analytics', [auth, adminAuth], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    const responses = await SurveyResponse.find({ survey: req.params.id });
    
    const analytics = {
      totalResponses: responses.length,
      completionRate: survey.targetCount ? (responses.length / survey.targetCount) * 100 : null,
      responsesByDate: getResponsesByDate(responses),
      questionAnalytics: analyzeQuestionResponses(survey.questions, responses)
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Get survey analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey analytics'
    });
  }
});



router.get('/surveys/:id', [auth, adminAuth], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');
    
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }
    
    res.json({
      success: true,
      data: survey
    });
    
  } catch (error) {
    console.error('Get survey by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey'
    });
  }
});

router.get('/surveys/:id/responses', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const responses = await SurveyResponse.find({ survey: req.params.id })
      .populate('respondent', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SurveyResponse.countDocuments({ survey: req.params.id });

    res.json({
      success: true,
      data: {
        responses,
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
    console.error('Get survey responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey responses'
    });
  }
});

// ===================== EVENT MANAGEMENT =====================

router.get('/events', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      eventType
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (status && status !== 'all') query.status = status;
    if (eventType) query.eventType = eventType;

    const events = await Event.find(query)
      .populate('organizer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

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

router.put('/events/:id/status', [auth, adminAuth], async (req, res) => {
  try {
    const { status } = req.body;
    const eventId = req.params.id;
    
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }
    
    const validStatuses = ['draft', 'published', 'cancelled', 'completed', 'pending_approval', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }
    
    const previousStatus = event.status;
    event.status = status;
    
    if (status === 'approved' || status === 'published') {
      event.approvedAt = new Date();
      event.approvedBy = req.user.id;
      event.status = 'published';
    }
    
    await event.save();

    // Audit log
    await createAuditLog(req.user._id, 'Event status changed', 'Event', event._id, {
      previousStatus,
      newStatus: status,
      eventTitle: event.title
    });
    
    await cache.flush();
    
    res.json({
      success: true,
      message: `Event ${status} successfully`,
      data: event
    });
    
  } catch (error) {
    console.error('Update event status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event status'
    });
  }
});

router.delete('/events/:id', [auth, adminAuth], async (req, res) => {
  try {
    const eventId = req.params.id;
    
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Audit log
    await createAuditLog(req.user._id, 'Event deleted', 'Event', event._id, {
      eventTitle: event.title,
      attendeeCount: event.attendees.length
    });
    
    await Event.findByIdAndDelete(eventId);
    await cache.flush();
    
    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event'
    });
  }
});

router.post('/events/bulk', [auth, adminAuth], async (req, res) => {
  try {
    const { action, eventIds } = req.body;
    
    if (!action || !eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json({
        success: false,
        message: 'Action and event IDs are required'
      });
    }
    
    let result;
    switch (action) {
      case 'publish':
        result = await Event.updateMany(
          { _id: { $in: eventIds }, status: { $in: ['draft', 'pending_approval'] } },
          { 
            $set: { 
              status: 'published',
              approvedAt: new Date(),
              approvedBy: req.user.id
            } 
          }
        );
        break;
        
      case 'cancel':
        result = await Event.updateMany(
          { _id: { $in: eventIds } },
          { $set: { status: 'cancelled' } }
        );
        break;
        
      case 'delete':
        result = await Event.deleteMany({ _id: { $in: eventIds } });
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    // Audit log
    await createAuditLog(req.user._id, `Bulk ${action} events`, 'Event', null, {
      action,
      eventIds,
      affectedCount: result.modifiedCount || result.deletedCount || 0
    });
    
    await cache.flush();
    
    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      data: {
        modifiedCount: result.modifiedCount || result.deletedCount || 0
      }
    });
    
  } catch (error) {
    console.error('Bulk operation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk operation'
    });
  }
});

// ===================== JOB MANAGEMENT =====================

router.get('/jobs', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (status && status !== 'all') query.status = status;

    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

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

router.patch('/jobs/:id/status', [auth, adminAuth], async (req, res) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['active', 'pending', 'expired', 'rejected', 'closed'];
    if (!validStatuses.includes(status)) {
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

    const previousStatus = job.status;
    job.status = status;
    await job.save();

    // Audit log
    await createAuditLog(req.user._id, 'Job status changed', 'Job', job._id, {
      previousStatus,
      newStatus: status,
      jobTitle: job.title,
      company: job.company
    });

    await cache.flush();

    res.json({
      success: true,
      message: 'Job status updated successfully',
      data: job
    });

  } catch (error) {
    console.error('Update job status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job status'
    });
  }
});

router.delete('/jobs/:id', [auth, adminAuth], async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Audit log
    await createAuditLog(req.user._id, 'Job deleted', 'Job', job._id, {
      jobTitle: job.title,
      company: job.company,
      applicantCount: job.applications.length
    });

    await Job.findByIdAndDelete(req.params.id);
    await cache.flush();

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });

  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete job'
    });
  }
});

router.post('/jobs/bulk', [auth, adminAuth], async (req, res) => {
  try {
    const { action, jobIds } = req.body;

    if (!action || !jobIds || !Array.isArray(jobIds)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data'
      });
    }

    let result;

    switch (action) {
      case 'approve':
        result = await Job.updateMany(
          { _id: { $in: jobIds }, status: 'pending' },
          { $set: { status: 'active' } }
        );
        break;

      case 'reject':
        result = await Job.updateMany(
          { _id: { $in: jobIds }, status: 'pending' },
          { $set: { status: 'rejected' } }
        );
        break;

      case 'close':
        result = await Job.updateMany(
          { _id: { $in: jobIds } },
          { $set: { status: 'closed' } }
        );
        break;

      case 'delete':
        result = await Job.deleteMany({ _id: { $in: jobIds } });
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    // Audit log
    await createAuditLog(req.user._id, `Bulk ${action} jobs`, 'Job', null, {
      action,
      jobIds,
      affectedCount: result.modifiedCount || result.deletedCount || 0
    });

    await cache.flush();

    res.json({
      success: true,
      message: `Bulk ${action} completed successfully`,
      data: {
        modifiedCount: result.modifiedCount || result.deletedCount || 0
      }
    });

  } catch (error) {
    console.error('Bulk job operation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk operation'
    });
  }
});

// ===================== FORUM MANAGEMENT =====================

router.get('/forums', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (category) query.category = category;

    const forums = await Forum.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('moderators', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Forum.countDocuments(query);

    res.json({
      success: true,
      data: {
        forums,
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
    console.error('Get admin forums error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch forums'
    });
  }
});

router.post('/forums', [auth, adminAuth], async (req, res) => {
  try {
    const forumData = {
      ...req.body,
      createdBy: req.user._id || req.user.id,
      moderators: [req.user._id || req.user.id]
    };

    const forum = new Forum(forumData);
    await forum.save();

    // Audit log
    await createAuditLog(req.user._id, 'Forum created', 'Forum', forum._id, {
      forumTitle: forum.title,
      category: forum.category
    });

    await forum.populate('createdBy moderators', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Forum created successfully',
      data: forum
    });

  } catch (error) {
    console.error('Create forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create forum'
    });
  }
});

router.put('/forums/:id', [auth, adminAuth], async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id);

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    Object.assign(forum, req.body);
    await forum.save();

    // Audit log
    await createAuditLog(req.user._id, 'Forum updated', 'Forum', forum._id);

    res.json({
      success: true,
      message: 'Forum updated successfully',
      data: forum
    });

  } catch (error) {
    console.error('Update forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update forum'
    });
  }
});

router.delete('/forums/:id', [auth, adminAuth], async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id);

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    const postCount = await ForumPost.countDocuments({ forum: req.params.id });
    if (postCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete forum with existing posts'
      });
    }

    // Audit log
    await createAuditLog(req.user._id, 'Forum deleted', 'Forum', forum._id, {
      forumTitle: forum.title
    });

    await forum.deleteOne();

    res.json({
      success: true,
      message: 'Forum deleted successfully'
    });

  } catch (error) {
    console.error('Delete forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete forum'
    });
  }
});

// Forum moderation
router.post('/forums/:forumId/moderators', [auth, adminAuth], async (req, res) => {
  try {
    const { userId, action } = req.body; // action: 'add' or 'remove'
    
    const forum = await Forum.findById(req.params.forumId);
    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    if (action === 'add') {
      if (!forum.moderators.includes(userId)) {
        forum.moderators.push(userId);
      }
    } else if (action === 'remove') {
      forum.moderators = forum.moderators.filter(mod => mod.toString() !== userId);
    }

    await forum.save();

    // Audit log
    await createAuditLog(req.user._id, `Moderator ${action}ed`, 'Forum', forum._id, {
      moderatorId: userId,
      action
    });

    res.json({
      success: true,
      message: `Moderator ${action}ed successfully`,
      data: forum
    });

  } catch (error) {
    console.error('Manage moderator error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to manage moderator'
    });
  }
});

// ===================== EXISTING ENDPOINTS =====================
// (Keep all your existing endpoints for alumni search, export, etc.)

// ===================== AUDIT LOGS =====================

router.get('/audit-logs', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      targetType,
      userId,
      startDate,
      endDate
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { 'metadata.adminAction': true };

    if (targetType) query['metadata.targetType'] = targetType;
    if (userId) query.user = userId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await Activity.find(query)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Activity.countDocuments(query);

    res.json({
      success: true,
      data: {
        logs,
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
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    });
  }
});

// ===================== HELPER FUNCTIONS =====================

// Keep all your existing helper functions (getUserRegistrationTrends, etc.)
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

function getResponsesByDate(responses) {
  const responsesByDate = {};
  
  responses.forEach(response => {
    const date = response.createdAt.toISOString().split('T')[0];
    responsesByDate[date] = (responsesByDate[date] || 0) + 1;
  });
  
  return responsesByDate;
}

function analyzeQuestionResponses(questions, responses) {
  return questions.map(question => {
    const questionResponses = responses
      .map(r => r.responses.find(resp => resp.questionId.toString() === question._id.toString()))
      .filter(r => r && r.answer);

    const analytics = {
      questionId: question._id,
      questionText: question.questionText,
      questionType: question.questionType,
      totalResponses: questionResponses.length
    };

    // Add type-specific analytics
    if (question.questionType === 'multipleChoice' || question.questionType === 'dropdown') {
      analytics.distribution = question.options.map(option => ({
        option,
        count: questionResponses.filter(r => r.answer === option).length,
        percentage: questionResponses.length > 0 
          ? Math.round((questionResponses.filter(r => r.answer === option).length / questionResponses.length) * 100) 
          : 0
      }));
    } else if (question.questionType === 'rating') {
      const ratings = questionResponses.map(r => parseInt(r.answer)).filter(r => !isNaN(r));
      analytics.average = ratings.length > 0 
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 
        : 0;
    }

    return analytics;
  });
}



// Add this after the GET /surveys/:id/responses endpoint (around line 450)

// Export survey responses
router.get('/surveys/:id/export', [auth, adminAuth], async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    const surveyId = req.params.id;

    // Get survey details
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Get all responses for the survey
    const responses = await SurveyResponse.find({ survey: surveyId })
      .populate('respondent', 'firstName lastName email graduationYear program')
      .sort({ createdAt: -1 });

    if (format === 'csv') {
      // Generate CSV
      const csv = await generateSurveyResponsesCSV(survey, responses);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${survey.title.replace(/[^a-z0-9]/gi, '_')}_responses_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else if (format === 'json') {
      // Return JSON
      res.json({
        success: true,
        data: {
          survey: {
            title: survey.title,
            description: survey.description,
            questions: survey.questions,
            responseCount: survey.responseCount
          },
          responses: responses
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid export format. Use csv or json'
      });
    }

  } catch (error) {
    console.error('Export survey responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export survey responses'
    });
  }
});

// Helper function to generate CSV
function generateSurveyResponsesCSV(survey, responses) {
  const headers = ['Response ID', 'Date', 'Time', 'Status', 'Respondent'];
  
  // Add question headers
  survey.questions.forEach((question, index) => {
    headers.push(`Q${index + 1}: ${question.questionText}`);
  });

  // Create CSV rows
  const rows = [headers];

  responses.forEach(response => {
    const row = [
      response._id.toString(),
      new Date(response.createdAt).toLocaleDateString(),
      new Date(response.createdAt).toLocaleTimeString(),
      response.isComplete ? 'Complete' : 'Incomplete',
      response.respondent ? `${response.respondent.firstName} ${response.respondent.lastName} (${response.respondent.email})` : 'Anonymous'
    ];

    // Add answers for each question
    survey.questions.forEach(question => {
      const answer = response.responses.find(r => r.questionId.toString() === question._id.toString());
      if (answer) {
        if (Array.isArray(answer.answer)) {
          row.push(answer.answer.join('; '));
        } else {
          row.push(answer.answer || '');
        }
      } else {
        row.push('No response');
      }
    });

    rows.push(row);
  });

  // Convert to CSV format
  return rows.map(row => 
    row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma, newline, or quotes
      const cellStr = String(cell || '');
      if (cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(',')
  ).join('\n');
}


// admin.routes.js - Updated getAllUsers endpoint
router.get('/users/all', [auth, adminAuth], async (req, res) => {
  try {
    console.log('=== FETCHING ALL USERS VIA PROFILES ===');
    
    // Fetch all profiles with populated user data
    const profiles = await Profile.find({})
      .populate('user', 'firstName lastName email role isVerified isActive preferences profileCompletion createdAt updatedAt lastLoginAt')
      .lean();
    
    console.log(`Found ${profiles.length} profiles in database`);
    
    // Transform the data to match what the frontend expects
    const users = profiles
      .filter(profile => profile.user) // Only include profiles with valid users
      .map(profile => ({
        // User fields
        _id: profile.user._id,
        firstName: profile.user.firstName,
        lastName: profile.user.lastName,
        email: profile.user.email,
        role: profile.user.role,
        isVerified: profile.user.isVerified,
        isActive: profile.user.isActive,
        preferences: profile.user.preferences,
        profileCompletion: profile.user.profileCompletion,
        createdAt: profile.user.createdAt,
        updatedAt: profile.user.updatedAt,
        lastLoginAt: profile.user.lastLoginAt,
        
        // Profile fields at root level
        phone: profile.phone || null,
        graduationYear: profile.graduationYear || null,
        program: profile.program || null,
        degree: profile.degree || null,
        location: profile.location || null,
        currentPosition: profile.currentPosition || null,
        currentCompany: profile.currentCompany || null,
        bio: profile.bio || '',
        skills: profile.skills || [],
        interests: profile.interests || [],
        employmentStatus: profile.employmentStatus || null
      }));
    
    // Also get users without profiles
    const profileUserIds = profiles.map(p => p.user?._id?.toString()).filter(Boolean);
    const usersWithoutProfiles = await User.find({
      _id: { $nin: profileUserIds }
    }).lean();
    
    console.log(`Found ${usersWithoutProfiles.length} users without profiles`);
    
    // Add users without profiles to the list
    usersWithoutProfiles.forEach(user => {
      users.push({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        isActive: user.isActive,
        preferences: user.preferences,
        profileCompletion: user.profileCompletion,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
        
        // Empty profile fields
        phone: null,
        graduationYear: null,
        program: null,
        degree: null,
        location: null,
        currentPosition: null,
        currentCompany: null,
        bio: '',
        skills: [],
        interests: [],
        employmentStatus: null
      });
    });
    
    // Sort by name
    users.sort((a, b) => {
      const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    console.log(`Total users: ${users.length}`);
    console.log(`Users with phone: ${users.filter(u => u.phone).length}`);
    console.log(`Users with graduation year: ${users.filter(u => u.graduationYear).length}`);
    console.log(`Users with program: ${users.filter(u => u.program).length}`);
    
    // Log sample data
    if (users.length > 0) {
      console.log('Sample users with data:');
      users.slice(0, 3).forEach(user => {
        console.log(`- ${user.email}: Phone=${user.phone || 'N/A'}, Year=${user.graduationYear || 'N/A'}, Program=${user.program || 'N/A'}`);
      });
    }
    
    res.json({
      success: true,
      data: {
        users: users,
        total: users.length,
        stats: {
          withPhone: users.filter(u => u.phone).length,
          withGraduationYear: users.filter(u => u.graduationYear).length,
          withProgram: users.filter(u => u.program).length,
          withDegree: users.filter(u => u.degree).length,
          withEmploymentStatus: users.filter(u => u.employmentStatus).length
        }
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// Also update the regular /users endpoint for paginated results
router.get('/users', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      role,
      status,
      isVerified,
      graduationYear,
      program
    } = req.query;

    const skip = (page - 1) * limit;

    // Build match conditions
    let matchConditions = {};
    
    if (search) {
      matchConditions.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) matchConditions.role = role;
    if (status === 'active') matchConditions.isActive = true;
    if (status === 'inactive') matchConditions.isActive = false;
    if (isVerified === 'true') matchConditions.isVerified = true;
    if (isVerified === 'false') matchConditions.isVerified = false;

    // Build aggregation pipeline
    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'profiles',
          localField: '_id',
          foreignField: 'user',
          as: 'profile'
        }
      },
      { 
        $unwind: { 
          path: '$profile', 
          preserveNullAndEmptyArrays: true 
        } 
      }
    ];

    // Add profile filters if specified
    if (graduationYear || program) {
      const profileMatch = {};
      if (graduationYear) profileMatch['profile.graduationYear'] = parseInt(graduationYear);
      if (program) profileMatch['profile.program'] = program;
      pipeline.push({ $match: profileMatch });
    }

    // Project fields
    pipeline.push({
      $project: {
        _id: 1,
        firstName: 1,
        lastName: 1,
        email: 1,
        role: 1,
        isVerified: 1,
        isActive: 1,
        preferences: 1,
        profileCompletion: 1,
        createdAt: 1,
        updatedAt: 1,
        lastLoginAt: 1,
        phone: { $ifNull: ['$profile.phone', null] },
        graduationYear: { $ifNull: ['$profile.graduationYear', null] },
        program: { $ifNull: ['$profile.program', null] },
        location: { $ifNull: ['$profile.location', null] },
        currentPosition: { $ifNull: ['$profile.currentPosition', null] },
        currentCompany: { $ifNull: ['$profile.currentCompany', null] }
      }
    });

    // Add sorting
    pipeline.push({ $sort: { createdAt: -1 } });

    // Get total count before pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: 'total' });
    const countResult = await User.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // Execute query
    const users = await User.aggregate(pipeline);

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



// ===================== BULK COMMUNICATIONS =====================
router.post('/communications/send', [auth, adminAuth], async (req, res) => {
  console.log('=== COMMUNICATION SEND ENDPOINT HIT ===');
  console.log('Request received at:', new Date().toISOString());
  
  try {
    const { type, recipients, subject, message, scheduledFor } = req.body;
    
    console.log('Request details:', {
      type,
      recipientCount: recipients?.length,
      hasSubject: !!subject,
      messageLength: message?.length,
      scheduled: !!scheduledFor
    });

    // Basic validation - Updated to remove 'both' option
    if (!type || !['email', 'sms'].includes(type)) {
      console.log('Validation failed: Invalid type');
      return res.status(400).json({
        success: false,
        message: 'Invalid communication type. Must be either "email" or "sms"'
      });
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      console.log('Validation failed: No recipients');
      return res.status(400).json({
        success: false,
        message: 'No recipients specified'
      });
    }

    if (!message || message.trim().length === 0) {
      console.log('Validation failed: No message');
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Subject validation only for email
    if (type === 'email' && !subject) {
      console.log('Validation failed: No subject for email');
      return res.status(400).json({
        success: false,
        message: 'Subject is required for email communications'
      });
    }

    console.log('Validation passed, fetching user details...');

    // Get recipient details
    const users = await User.find({ 
      _id: { $in: recipients },
      isActive: true 
    }).select('_id email firstName lastName').lean();

    console.log(`Found ${users.length} active users from ${recipients.length} recipient IDs`);

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid recipients found'
      });
    }

    // Get phone numbers from profiles
    let usersWithPhones = [...users];
    try {
      const userIds = users.map(u => u._id);
      const profiles = await Profile.find({ 
        user: { $in: userIds } 
      }).select('user phone').lean();

      console.log(`Found ${profiles.length} profiles for phone numbers`);

      // Map phone numbers to users
      const profilePhoneMap = {};
      profiles.forEach(profile => {
        if (profile.phone) {
          profilePhoneMap[profile.user.toString()] = profile.phone;
        }
      });

      // Enhance users with phone numbers
      usersWithPhones = users.map(user => ({
        ...user,
        phone: profilePhoneMap[user._id.toString()] || null
      }));

      console.log(`Users with phones: ${usersWithPhones.filter(u => u.phone).length}`);
    } catch (profileError) {
      console.log('Could not fetch phone numbers from profiles:', profileError.message);
    }

    // Initialize stats
    const stats = {
      sent: 0,
      failed: 0,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0
    };

    // Try to save communication record if model exists
    let communicationId = null;
    try {
      if (Communication) {
        console.log('Attempting to save communication record...');
        const communication = new Communication({
          type,
          subject,
          message,
          recipients: usersWithPhones.map(user => ({
            user: user._id,
            email: user.email,
            phone: user.phone || null,
            status: 'pending'
          })),
          recipientCount: usersWithPhones.length,
          sentBy: req.user._id || req.user.id,
          status: scheduledFor ? 'scheduled' : 'sending',
          scheduledFor,
          stats
        });

        const savedComm = await communication.save();
        communicationId = savedComm._id;
        console.log('Communication record saved with ID:', communicationId);
      } else {
        console.log('Communication model not available, skipping database save');
      }
    } catch (dbError) {
      console.error('Failed to save communication record:', dbError.message);
      // Continue anyway - we can still send emails
    }

    // Helper function to personalize message
    const personalizeContent = (content, user) => {
      if (!content) return content;
      
      let personalizedContent = content;
      
      // Replace variables with actual values
      personalizedContent = personalizedContent.replace(/{firstName}/gi, user.firstName || 'Member');
      personalizedContent = personalizedContent.replace(/{lastName}/gi, user.lastName || '');
      personalizedContent = personalizedContent.replace(/{email}/gi, user.email || '');
      personalizedContent = personalizedContent.replace(/{phone}/gi, user.phone || 'N/A');
      
      // Handle full name
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Member';
      personalizedContent = personalizedContent.replace(/{fullName}/gi, fullName);
      
      return personalizedContent;
    };

    // Process sending (simplified since no 'both' option)
    if (!scheduledFor) {
      console.log('Processing immediate send...');
      
      // Send emails
      if (type === 'email') {
        console.log(`Sending emails to ${usersWithPhones.length} recipients...`);
        
        for (const user of usersWithPhones) {
          try {
            // Personalize subject and message for this user
            const personalizedSubject = personalizeContent(subject, user);
            const personalizedMessage = personalizeContent(message, user);
            
            // Create personalized HTML email
            const personalizedHtml = `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
                <div style="background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                  <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 30px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">ATU Alumni Network</h1>
                  </div>
                  <div style="padding: 30px;">
                    <h2 style="color: #1e3a8a; margin-bottom: 20px; font-size: 22px;">${personalizedSubject}</h2>
                    
                    <div style="color: #374151; line-height: 1.8; font-size: 16px;">
                      ${personalizedMessage.replace(/\n/g, '<br>')}
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                      <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
                        Best regards,<br>
                        <strong>ATU Alumni Team</strong>
                      </p>
                    </div>
                  </div>
                  <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                      This email was sent to ${user.email}
                    </p>
                    <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">
                      © ${new Date().getFullYear()} ATU Alumni Network. All rights reserved.
                    </p>
                  </div>
                </div>
              </body>
              </html>
            `;

            // Call sendEmail with personalized content
            const result = await emailService.sendEmail({
              to: user.email,
              subject: personalizedSubject,
              text: personalizedMessage,
              html: personalizedHtml
            });

            if (result.success) {
              console.log(`✅ Email sent to ${user.email} (${user.firstName} ${user.lastName})`);
              stats.emailsSent++;
              stats.sent++;
            } else {
              console.error(`❌ Failed to send email to ${user.email}:`, result.error);
              stats.emailsFailed++;
              stats.failed++;
            }
          } catch (emailError) {
            console.error(`❌ Email send error for ${user.email}:`, emailError.message);
            stats.emailsFailed++;
            stats.failed++;
          }
        }
      }

      // Send SMS
      if (type === 'sms') {
        const smsRecipients = usersWithPhones.filter(u => u.phone);
        console.log(`Processing SMS for ${smsRecipients.length} recipients with phone numbers...`);
        
        if (smsRecipients.length > 0) {
          try {
            if (smsService && smsService.sendBulkSMS) {
              // Personalize SMS messages for each recipient
              const personalizedSmsRecipients = smsRecipients.map(user => ({
                ...user,
                personalizedMessage: personalizeContent(message, user)
              }));
              
              const smsResult = await smsService.sendBulkSMS(personalizedSmsRecipients, message);
              stats.smsSent = smsResult.sent || 0;
              stats.smsFailed = smsResult.failed || 0;
              stats.sent += stats.smsSent;
              stats.failed += stats.smsFailed;
            } else {
              console.log(`✓ [SIMULATED] SMS would be sent to ${smsRecipients.length} recipients`);
              stats.smsSent = smsRecipients.length;
              stats.sent += stats.smsSent;
            }
          } catch (smsError) {
            console.error('SMS sending error:', smsError.message);
            stats.smsFailed = smsRecipients.length;
            stats.failed += smsRecipients.length;
          }
        } else {
          console.log('No recipients with phone numbers for SMS');
        }
      }

      // Update communication record if it was saved
      if (communicationId && Communication) {
        try {
          await Communication.findByIdAndUpdate(communicationId, {
            status: 'sent',
            sentAt: new Date(),
            completedAt: new Date(),
            stats,
            'recipients.$[].status': stats.failed === 0 ? 'sent' : 'partial'
          });
          console.log('Communication record updated with final stats');
        } catch (updateError) {
          console.error('Failed to update communication record:', updateError.message);
        }
      }
    }

    // Prepare response
    const response = {
      success: true,
      message: scheduledFor ? 'Communication scheduled successfully' : 'Communication sent successfully',
      data: {
        communicationId: communicationId?.toString(),
        type,
        recipientCount: usersWithPhones.length,
        ...stats
      }
    };

    console.log('Sending success response:', response);
    console.log('=== COMMUNICATION SEND COMPLETED ===');
    
    return res.json(response);

  } catch (error) {
    console.error('=== COMMUNICATION SEND ERROR ===');
    console.error('Error details:', error);
    console.error('Stack trace:', error.stack);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to send communication',
      error: error.message || 'Unknown error occurred'
    });
  }
});

// Also add this test endpoint to verify the route is working
router.get('/communications/test', [auth, adminAuth], (req, res) => {
  console.log('Communication test endpoint accessed');
  res.json({
    success: true,
    message: 'Communication endpoints are working',
    timestamp: new Date().toISOString(),
    user: req.user?.email || 'Unknown'
  });
});

// Add endpoint to check SMS balance
router.get('/communications/sms-balance', [auth, adminAuth], async (req, res) => {
  try {
    const balance = await smsService.checkBalance();
    
    res.json({
      success: true,
      data: balance
    });
  } catch (error) {
    console.error('Check SMS balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check SMS balance'
    });
  }
});

// Test SMS endpoint
router.post('/communications/test-sms', [auth, adminAuth], async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await smsService.sendTestSMS(phone);
    
    res.json({
      success: result.success,
      message: result.success ? 'Test SMS sent successfully' : 'Failed to send test SMS',
      data: result
    });
  } catch (error) {
    console.error('Test SMS error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test SMS',
      error: error.message
    });
  }
});

// Get communication history
router.get('/communications/history', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      startDate,
      endDate
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    if (type) query.type = type;
    if (startDate || endDate) {
      query.sentAt = {};
      if (startDate) query.sentAt.$gte = new Date(startDate);
      if (endDate) query.sentAt.$lte = new Date(endDate);
    }

    const history = await Communication.find(query)
      .populate('sentBy', 'firstName lastName email')
      .select('-recipients') // Exclude recipients array for performance
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Communication.countDocuments(query);

    res.json({
      success: true,
      data: {
        history: history.map(comm => ({
          _id: comm._id,
          type: comm.type,
          subject: comm.subject,
          message: comm.message.substring(0, 200) + '...',
          recipientCount: comm.recipientCount,
          sentAt: comm.sentAt,
          status: comm.status,
          sentBy: comm.sentBy ? `${comm.sentBy.firstName} ${comm.sentBy.lastName}` : 'Unknown',
          stats: comm.stats
        })),
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
    console.error('Get communication history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch communication history'
    });
  }
});

// Get communication details
router.get('/communications/:id', [auth, adminAuth], async (req, res) => {
  try {
    const communication = await Communication.findById(req.params.id)
      .populate('sentBy', 'firstName lastName email')
      .populate('recipients.user', 'firstName lastName email');

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    res.json({
      success: true,
      data: communication
    });

  } catch (error) {
    console.error('Get communication details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch communication details'
    });
  }
});


module.exports = router;