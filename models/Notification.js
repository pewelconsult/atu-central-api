// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.type !== 'system';
    }
  },
  type: {
    type: String,
    enum: [
      'connection_request',
      'connection_accepted',
      'event_reminder',
      'event_rsvp',
      'job_application',
      'job_status_update',
      'survey_invitation',
      'system',
      'admin_message',
      'profile_view',
      'new_job_posting',
      'event_invitation'
    ],
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  data: {
    // Additional data specific to notification type
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  actionUrl: {
    type: String, // URL to navigate to when notification is clicked
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Default expiry: 30 days from creation
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    },
    index: { expireAfterSeconds: 0 } // MongoDB TTL index
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });

// Virtual for time ago
notificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  
  // You can add real-time notification logic here (Socket.io)
  // socketService.sendNotification(data.recipient, notification);
  
  return notification;
};

// Static method to create bulk notifications
notificationSchema.statics.createBulkNotifications = async function(recipients, notificationData) {
  const notifications = recipients.map(recipientId => ({
    ...notificationData,
    recipient: recipientId
  }));
  
  const result = await this.insertMany(notifications);
  
  // Send real-time notifications
  // recipients.forEach(recipientId => {
  //   socketService.sendNotification(recipientId, notificationData);
  // });
  
  return result;
};

// Static method to get unread count for user
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ 
    recipient: userId, 
    isRead: false 
  });
};

// Static method to mark all as read for user
notificationSchema.statics.markAllAsReadForUser = function(userId) {
  return this.updateMany(
    { recipient: userId, isRead: false },
    { 
      isRead: true, 
      readAt: new Date() 
    }
  );
};

// Pre-save middleware to set actionUrl based on type
notificationSchema.pre('save', function(next) {
  if (!this.actionUrl && this.type && this.data) {
    switch (this.type) {
      case 'connection_request':
        this.actionUrl = `/alumni/${this.sender}`;
        break;
      case 'event_reminder':
      case 'event_rsvp':
      case 'event_invitation':
        this.actionUrl = `/events/${this.data.eventId}`;
        break;
      case 'job_application':
      case 'job_status_update':
      case 'new_job_posting':
        this.actionUrl = `/jobs/${this.data.jobId}`;
        break;
      case 'survey_invitation':
        this.actionUrl = `/surveys/${this.data.surveyId}`;
        break;
      case 'profile_view':
        this.actionUrl = `/alumni/me/profile`;
        break;
      default:
        this.actionUrl = '/dashboard';
    }
  }
  next();
});

module.exports = mongoose.model('Notification', notificationSchema);