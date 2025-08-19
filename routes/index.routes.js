// routes/index.routes.js
const express = require('express');
const path = require('path');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const alumniRoutes = require('./alumni.routes');
const eventsRoutes = require('./events.routes');
const jobsRoutes = require('./jobs.routes');
const surveysRoutes = require('./surveys.routes');
const adminRoutes = require('./admin.routes');
const uploadRoutes = require('./upload.routes');
const forumRoutes = require('./forum.routes');
const activitiesRoutes = require('./activities.routes'); // NEW

// Import rate limiters
const { generalLimiter, apiLimiter } = require('../middleware/rateLimiter');

// Apply general rate limiting
router.use(generalLimiter);

// Serve static files from uploads directory
router.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API info endpoint
router.get('/', (req, res) => {
  res.json({
    name: 'ATU Alumni Database API',
    version: '1.0.0',
    description: 'Comprehensive API for ATU Alumni management system',
    status: 'Running',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me',
        forgotPassword: 'POST /api/auth/forgot-password',
        resetPassword: 'POST /api/auth/reset-password',
        verifyEmail: 'POST /api/auth/verify-email'
      },
      alumni: {
        list: 'GET /api/alumni',
        profile: 'GET /api/alumni/:id',
        updateProfile: 'PUT /api/alumni/profile',
        myProfile: 'GET /api/alumni/me/profile',
        connect: 'POST /api/alumni/:id/connect',
        connections: 'PUT /api/alumni/connections/:connectionId/:action'
      },
      events: {
        list: 'GET /api/events',
        create: 'POST /api/events',
        details: 'GET /api/events/:id',
        update: 'PUT /api/events/:id',
        rsvp: 'POST /api/events/:id/rsvp',
        cancelRsvp: 'DELETE /api/events/:id/rsvp',
        myEvents: 'GET /api/events/me/events'
      },
      jobs: {
        list: 'GET /api/jobs',
        create: 'POST /api/jobs',
        details: 'GET /api/jobs/:id',
        update: 'PUT /api/jobs/:id',
        apply: 'POST /api/jobs/:id/apply',
        myApplications: 'GET /api/jobs/me/applications',
        myPosted: 'GET /api/jobs/me/posted',
        updateApplication: 'PUT /api/jobs/:id/applications/:applicationId'
      },
      surveys: {
        list: 'GET /api/surveys',
        details: 'GET /api/surveys/:id',
        create: 'POST /api/surveys (Admin)',
        update: 'PUT /api/surveys/:id (Admin)',
        respond: 'POST /api/surveys/:id/respond',
        myResponses: 'GET /api/surveys/me/responses',
        analytics: 'GET /api/surveys/:id/analytics (Admin)',
        responses: 'GET /api/surveys/:id/responses (Admin)'
      },
      activities: { // NEW
        myActivities: 'GET /api/activities/my-activities',
        activityFeed: 'GET /api/activities/feed',
        activityStats: 'GET /api/activities/stats',
        userActivities: 'GET /api/activities/user/:userId',
        createActivity: 'POST /api/activities',
        deleteActivity: 'DELETE /api/activities/:activityId',
        activityTypes: [
          'profile_update',
          'profile_view',
          'connection_made',
          'connection_request',
          'event_registration',
          'event_attendance',
          'job_application',
          'job_posted',
          'forum_post',
          'forum_comment',
          'message_sent',
          'survey_completed',
          'achievement_earned',
          'login',
          'account_created'
        ],
        visibility: ['public', 'connections', 'private']
      },
      forums: {
        // Forum management
        listForums: 'GET /api/forums',
        forumDetails: 'GET /api/forums/:id',
        createForum: 'POST /api/forums (Admin)',
        updateForum: 'PUT /api/forums/:id (Admin/Moderator)',
        deleteForum: 'DELETE /api/forums/:id (Admin)',
        
        // Post management
        listPosts: 'GET /api/forums/:forumId/posts',
        postDetails: 'GET /api/forums/posts/:id',
        createPost: 'POST /api/forums/:forumId/posts',
        updatePost: 'PUT /api/forums/posts/:id',
        deletePost: 'DELETE /api/forums/posts/:id',
        likePost: 'POST /api/forums/posts/:id/like',
        voteOnPoll: 'POST /api/forums/posts/:id/vote',
        
        // Reply management
        listReplies: 'GET /api/forums/posts/:postId/replies',
        createReply: 'POST /api/forums/posts/:postId/replies',
        updateReply: 'PUT /api/forums/replies/:id',
        deleteReply: 'DELETE /api/forums/replies/:id',
        likeReply: 'POST /api/forums/replies/:id/like',
        
        // Search and discovery
        searchPosts: 'GET /api/forums/search',
        trendingPosts: 'GET /api/forums/trending'
      },
      uploads: {
        profilePicture: 'POST /api/uploads/profile-picture',
        resume: 'POST /api/uploads/resume',
        eventImage: 'POST /api/uploads/event-image',
        multiple: 'POST /api/uploads/multiple',
        deleteFile: 'DELETE /api/uploads/file',
        myFiles: 'GET /api/uploads/my-files',
        viewFile: 'GET /api/uploads/view/:folder/:filename'
      },
      admin: {
        dashboard: 'GET /api/admin/dashboard',
        users: 'GET /api/admin/users',
        updateUserStatus: 'PUT /api/admin/users/:id/status',
        deleteUser: 'DELETE /api/admin/users/:id',
        events: 'GET /api/admin/events',
        jobs: 'GET /api/admin/jobs',
        sendBulkEmail: 'POST /api/admin/send-email',
        export: 'GET /api/admin/export/:type'
      }
    },
    documentation: 'Check individual endpoints for detailed usage',
    fileUploads: {
      maxFileSize: '5MB',
      allowedTypes: {
        images: ['jpg', 'jpeg', 'png', 'gif'],
        documents: ['pdf', 'doc', 'docx']
      },
      uploadLimits: '10 uploads per hour per user'
    },
    rateLimit: {
      general: process.env.NODE_ENV === 'development' ? 'DISABLED (Development)' : '100 requests per 15 minutes',
      api: process.env.NODE_ENV === 'development' ? 'DISABLED (Development)' : '1000 requests per hour (authenticated)',
      auth: process.env.NODE_ENV === 'development' ? 'DISABLED (Development)' : '5 attempts per 15 minutes',
      uploads: process.env.NODE_ENV === 'development' ? 'DISABLED (Development)' : '10 uploads per hour'
    }
  });
});

// Mount route modules with API rate limiting for authenticated routes
router.use('/auth', authRoutes);
router.use('/alumni', apiLimiter, alumniRoutes);
router.use('/events', apiLimiter, eventsRoutes);
router.use('/jobs', apiLimiter, jobsRoutes);
router.use('/surveys', apiLimiter, surveysRoutes);
router.use('/forums', apiLimiter, forumRoutes);
router.use('/uploads', apiLimiter, uploadRoutes);
router.use('/activities', apiLimiter, activitiesRoutes); // NEW
router.use('/admin', apiLimiter, adminRoutes);

module.exports = router;