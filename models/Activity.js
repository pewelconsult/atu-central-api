// models/Activity.js
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'profile_update',
      'profile_view',
      'connection_made',
      'connection_request',
      'connection_accepted', // Added missing types
      'event_registration',
      'event_attendance',
      'event_created',
      'job_application',
      'job_posted',
      'job_application_received',
      'job_application_status_changed',
      'forum_post',
      'forum_comment',
      'message_sent',
      'survey_completed',
      'survey_response', // Added
      'survey_created', // Added
      'achievement_earned',
      'login',
      'account_created'
    ]
  },
  action: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    targetEvent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event'
    },
    targetJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job'
    },
    targetPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ForumPost'
    },
    targetSurvey: { // Added
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey'
    },
    changes: mongoose.Schema.Types.Mixed,
    previousValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    location: {
      city: String,
      country: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    }
  },
  visibility: {
    type: String,
    enum: ['public', 'connections', 'private'],
    default: 'public'
  },
  isSystemGenerated: {
    type: Boolean,
    default: false
  },
  points: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for performance
activitySchema.index({ createdAt: -1 });
activitySchema.index({ user: 1, createdAt: -1 });
activitySchema.index({ type: 1, createdAt: -1 });
activitySchema.index({ 'metadata.targetUser': 1 });

// Virtual for formatted date
activitySchema.virtual('formattedDate').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  
  return this.createdAt.toLocaleDateString();
});

// Static method to create activity
activitySchema.statics.createActivity = async function(data) {
  const activity = new this(data);
  await activity.save();
  
  // Populate user info before returning
  await activity.populate('user', 'firstName lastName profilePicture');
  
  return activity;
};

// Static method to get user activities
activitySchema.statics.getUserActivities = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type,
    visibility = ['public', 'connections'],
    includePrivate = false
  } = options;
  
  const query = { user: userId };
  
  if (type) {
    query.type = type;
  }
  
  if (!includePrivate) {
    query.visibility = { $in: visibility };
  }
  
  const skip = (page - 1) * limit;
  
  const activities = await this.find(query)
    .populate('user', 'firstName lastName profilePicture')
    .populate('metadata.targetUser', 'firstName lastName profilePicture')
    .populate('metadata.targetEvent', 'title startDate')
    .populate('metadata.targetJob', 'title company')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
    
  const total = await this.countDocuments(query);
  
  return {
    activities,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
};

// Static method to get activity feed - FIXED
activitySchema.statics.getActivityFeed = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    includeOwn = true
  } = options;
  
  try {
    // Get user's connections from Profile model
    const Profile = mongoose.model('Profile');
    const userProfile = await Profile.findOne({ user: userId })
      .select('connections')
      .lean();
    
    // Get accepted connections
    const connectionIds = userProfile?.connections
      ?.filter(conn => conn.status === 'accepted')
      ?.map(conn => conn.user) || [];
    
    // Build query
    const userIds = includeOwn ? [...connectionIds, userId] : connectionIds;
    const query = {
      user: { $in: userIds },
      visibility: { $in: ['public', 'connections'] }
    };
    
    const skip = (page - 1) * limit;
    
    const activities = await this.find(query)
      .populate('user', 'firstName lastName profilePicture')
      .populate('metadata.targetUser', 'firstName lastName profilePicture')
      .populate('metadata.targetEvent', 'title startDate')
      .populate('metadata.targetJob', 'title company')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await this.countDocuments(query);
    
    return {
      activities,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error('Error in getActivityFeed:', error);
    throw error;
  }
};

// Instance method to get icon
activitySchema.methods.getIcon = function() {
  const iconMap = {
    'profile_update': 'person',
    'profile_view': 'visibility',
    'connection_made': 'people',
    'connection_request': 'person_add',
    'connection_accepted': 'people',
    'event_registration': 'event',
    'event_attendance': 'event_available',
    'event_created': 'event',
    'job_application': 'work',
    'job_posted': 'post_add',
    'job_application_received': 'work',
    'job_application_status_changed': 'work',
    'forum_post': 'forum',
    'forum_comment': 'comment',
    'message_sent': 'message',
    'survey_completed': 'assignment_turned_in',
    'survey_response': 'assignment_turned_in',
    'survey_created': 'assignment',
    'achievement_earned': 'emoji_events',
    'login': 'login',
    'account_created': 'account_circle'
  };
  
  return iconMap[this.type] || 'info';
};

// Instance method to get color
activitySchema.methods.getColor = function() {
  const colorMap = {
    'profile_update': '#3b82f6',
    'profile_view': '#8b5cf6',
    'connection_made': '#10b981',
    'connection_request': '#06b6d4',
    'connection_accepted': '#10b981',
    'event_registration': '#f59e0b',
    'event_attendance': '#f97316',
    'event_created': '#f59e0b',
    'job_application': '#6366f1',
    'job_posted': '#8b5cf6',
    'job_application_received': '#6366f1',
    'job_application_status_changed': '#6366f1',
    'forum_post': '#3b82f6',
    'forum_comment': '#06b6d4',
    'message_sent': '#10b981',
    'survey_completed': '#f59e0b',
    'survey_response': '#f59e0b',
    'survey_created': '#f97316',
    'achievement_earned': '#f97316',
    'login': '#6b7280',
    'account_created': '#10b981'
  };
  
  return colorMap[this.type] || '#6b7280';
};

module.exports = mongoose.model('Activity', activitySchema);