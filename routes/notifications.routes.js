// routes/notifications.routes.js
const express = require('express');
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');

const router = express.Router();

// Get user's notifications
router.get('/', [auth, validatePagination], async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      isRead,
      priority
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { recipient: userId };

    // Apply filters
    if (type) query.type = type;
    if (typeof isRead !== 'undefined') query.isRead = isRead === 'true';
    if (priority) query.priority = priority;

    const notifications = await Notification.find(query)
      .populate('sender', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.getUnreadCount(userId);

    // Add virtual fields manually since we're using lean()
    const notificationsWithVirtuals = notifications.map(notification => ({
      ...notification,
      timeAgo: getTimeAgo(notification.createdAt)
    }));

    res.json({
      success: true,
      data: {
        notifications: notificationsWithVirtuals,
        unreadCount,
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
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Get unread notifications count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const unreadCount = await Notification.getUnreadCount(userId);

    res.json({
      success: true,
      data: { unreadCount }
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
});

// Mark notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const result = await Notification.markAllAsReadForUser(userId);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: { modifiedCount: result.modifiedCount }
    });

  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Delete notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
});

// Delete all read notifications
router.delete('/read/clear', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const result = await Notification.deleteMany({
      recipient: userId,
      isRead: true
    });

    res.json({
      success: true,
      message: 'Read notifications cleared successfully',
      data: { deletedCount: result.deletedCount }
    });

  } catch (error) {
    console.error('Clear read notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear read notifications'
    });
  }
});

// Get notification settings/preferences
router.get('/settings', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    // Get user's notification preferences from User model
    const User = require('../models/User');
    const user = await User.findById(userId).select('preferences');

    res.json({
      success: true,
      data: {
        preferences: user.preferences || {
          emailNotifications: true,
          eventReminders: true,
          jobAlerts: true,
          newsletter: true
        }
      }
    });

  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings'
    });
  }
});

// Update notification settings
router.put('/settings', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid preferences data'
      });
    }

    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(
      userId,
      { preferences },
      { new: true, runValidators: true }
    ).select('preferences');

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: { preferences: user.preferences }
    });

  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings'
    });
  }
});

// Helper function to calculate time ago
function getTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

module.exports = router;