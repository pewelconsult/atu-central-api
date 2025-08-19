// routes/activities.routes.js
const express = require('express');
const Activity = require('../models/Activity');
const { auth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');

const router = express.Router();

// Get user's activity history
router.get('/my-activities', [auth, validatePagination], async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, type, includePrivate = false } = req.query;
    
    const result = await Activity.getUserActivities(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      includePrivate: includePrivate === 'true'
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities'
    });
  }
});

// Get activity feed (own + connections)
router.get('/feed', [auth, validatePagination], async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, includeOwn = true } = req.query;
    
    const result = await Activity.getActivityFeed(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      includeOwn: includeOwn !== 'false'
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Get activity feed error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity feed'
    });
  }
});

// Get activity statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { period = '30days' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get activity counts by type
    const activityCounts = await Activity.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get daily activity for chart
    const dailyActivity = await Activity.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get total points earned
    const totalPoints = await Activity.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalPoints: { $sum: '$points' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        activityCounts,
        dailyActivity,
        totalPoints: totalPoints[0]?.totalPoints || 0,
        summary: {
          totalActivities: activityCounts.reduce((sum, item) => sum + item.count, 0),
          mostActiveType: activityCounts[0]?._id || null,
          averagePerDay: Math.round(
            activityCounts.reduce((sum, item) => sum + item.count, 0) / 
            Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
          )
        }
      }
    });
    
  } catch (error) {
    console.error('Get activity stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity statistics'
    });
  }
});

// Get public activities for a specific user
router.get('/user/:userId', [auth, validatePagination], async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type } = req.query;
    
    const result = await Activity.getUserActivities(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      visibility: ['public'],
      includePrivate: false
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Get user activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user activities'
    });
  }
});

// Create manual activity (for testing or admin use)
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, action, description, metadata, visibility } = req.body;
    
    const activity = await Activity.createActivity({
      user: userId,
      type,
      action,
      description,
      metadata: {
        ...metadata,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      },
      visibility
    });
    
    res.status(201).json({
      success: true,
      data: { activity }
    });
    
  } catch (error) {
    console.error('Create activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create activity'
    });
  }
});

// Delete activity
router.delete('/:activityId', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { activityId } = req.params;
    
    const activity = await Activity.findOne({
      _id: activityId,
      user: userId
    });
    
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found'
      });
    }
    
    await activity.remove();
    
    res.json({
      success: true,
      message: 'Activity deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete activity'
    });
  }
});

module.exports = router;