// models/Forum.js
const mongoose = require('mongoose');

const forumSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Forum title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: String,
    enum: [
      'General Discussion',
      'Career Development',
      'Industry Insights',
      'Academic Support',
      'Networking',
      'Job Opportunities',
      'Alumni Stories',
      'Events',
      'Technology',
      'Business',
      'Social',
      'Announcements'
    ],
    required: true
  },
  // Forum access control
  visibility: {
    type: String,
    enum: ['public', 'alumni_only', 'verified_only', 'private'],
    default: 'alumni_only'
  },
  // Forum moderators
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Forum creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Forum settings
  allowPosts: {
    type: Boolean,
    default: true
  },
  requireApproval: {
    type: Boolean,
    default: false
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  // Forum statistics
  postCount: {
    type: Number,
    default: 0
  },
  lastPost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumPost'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  // Forum tags
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  // Forum rules
  rules: [{
    type: String,
    maxlength: 200
  }]
}, {
  timestamps: true
});

// Indexes
forumSchema.index({ category: 1, visibility: 1 });
forumSchema.index({ isPinned: -1, lastActivity: -1 });
forumSchema.index({ moderators: 1 });
forumSchema.index({ tags: 1 });

module.exports = mongoose.model('Forum', forumSchema);

// models/ForumPost.js
const forumPostSchema = new mongoose.Schema({
  forum: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Forum',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [300, 'Post title cannot exceed 300 characters']
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: [10000, 'Post content cannot exceed 10000 characters']
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Post type
  type: {
    type: String,
    enum: ['discussion', 'question', 'announcement', 'poll', 'job_posting'],
    default: 'discussion'
  },
  // Post status
  status: {
    type: String,
    enum: ['draft', 'published', 'pending_approval', 'rejected'],
    default: 'published'
  },
  // Post moderation
  isApproved: {
    type: Boolean,
    default: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  // Post interactions
  views: {
    type: Number,
    default: 0
  },
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    likedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Post settings
  isPinned: {
    type: Boolean,
    default: false
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  // Post replies count
  replyCount: {
    type: Number,
    default: 0
  },
  lastReply: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumReply'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  // Post attachments
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'document', 'video', 'audio']
    },
    url: String,
    filename: String,
    size: Number
  }],
  // Post tags
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  // For polls
  pollOptions: [{
    option: {
      type: String,
      required: true,
      maxlength: 200
    },
    votes: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      votedAt: {
        type: Date,
        default: Date.now
      }
    }]
  }],
  pollEndsAt: {
    type: Date
  },
  allowMultipleVotes: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
forumPostSchema.index({ forum: 1, createdAt: -1 });
forumPostSchema.index({ author: 1, createdAt: -1 });
forumPostSchema.index({ status: 1, isApproved: 1 });
forumPostSchema.index({ isPinned: -1, lastActivity: -1 });
forumPostSchema.index({ tags: 1 });
forumPostSchema.index({ type: 1 });

// Virtual for like count
forumPostSchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

// Virtual for total poll votes
forumPostSchema.virtual('totalPollVotes').get(function() {
  if (!this.pollOptions) return 0;
  return this.pollOptions.reduce((total, option) => total + option.votes.length, 0);
});

// Method to add like
forumPostSchema.methods.addLike = function(userId) {
  // Remove existing like from this user
  this.likes = this.likes.filter(like => like.user.toString() !== userId.toString());
  
  // Add new like
  this.likes.push({ user: userId });
  return this.save();
};

// Method to remove like
forumPostSchema.methods.removeLike = function(userId) {
  this.likes = this.likes.filter(like => like.user.toString() !== userId.toString());
  return this.save();
};

// Method to add poll vote
forumPostSchema.methods.addPollVote = function(userId, optionIndex) {
  if (!this.pollOptions || !this.pollOptions[optionIndex]) {
    throw new Error('Invalid poll option');
  }

  // Check if poll has ended
  if (this.pollEndsAt && new Date() > this.pollEndsAt) {
    throw new Error('Poll has ended');
  }

  // If multiple votes not allowed, remove existing votes
  if (!this.allowMultipleVotes) {
    this.pollOptions.forEach(option => {
      option.votes = option.votes.filter(vote => vote.user.toString() !== userId.toString());
    });
  }

  // Add new vote
  this.pollOptions[optionIndex].votes.push({ user: userId });
  return this.save();
};

// Method to increment views
forumPostSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

// Static method to get forum posts with filters
forumPostSchema.statics.getForumPosts = function(forumId, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'lastActivity',
    order = 'desc',
    type,
    status = 'published'
  } = options;

  const skip = (page - 1) * limit;
  const query = { forum: forumId, status };

  if (type) {
    query.type = type;
  }

  const sortOptions = {};
  if (sortBy === 'pinned') {
    sortOptions.isPinned = -1;
    sortOptions.lastActivity = -1;
  } else {
    sortOptions[sortBy] = order === 'desc' ? -1 : 1;
  }

  return this.find(query)
    .populate('author', 'firstName lastName profilePicture')
    .populate('lastReply', 'content author createdAt')
    .sort(sortOptions)
    .skip(skip)
    .limit(limit);
};

module.exports = mongoose.model('ForumPost', forumPostSchema);

// models/ForumReply.js
const forumReplySchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumPost',
    required: true,
    index: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: [5000, 'Reply content cannot exceed 5000 characters']
  },
  // Reply to another reply (nested replies)
  parentReply: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumReply'
  },
  // Reply status
  status: {
    type: String,
    enum: ['published', 'pending_approval', 'rejected', 'deleted'],
    default: 'published'
  },
  isApproved: {
    type: Boolean,
    default: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Reply interactions
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    likedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Reply attachments
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'document', 'video', 'audio']
    },
    url: String,
    filename: String,
    size: Number
  }],
  // Edit history
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes
forumReplySchema.index({ post: 1, createdAt: 1 });
forumReplySchema.index({ author: 1, createdAt: -1 });
forumReplySchema.index({ parentReply: 1 });
forumReplySchema.index({ status: 1, isApproved: 1 });

// Virtual for like count
forumReplySchema.virtual('likeCount').get(function() {
  return this.likes.length;
});

// Method to add like
forumReplySchema.methods.addLike = function(userId) {
  this.likes = this.likes.filter(like => like.user.toString() !== userId.toString());
  this.likes.push({ user: userId });
  return this.save();
};

// Method to remove like
forumReplySchema.methods.removeLike = function(userId) {
  this.likes = this.likes.filter(like => like.user.toString() !== userId.toString());
  return this.save();
};

// Method to edit reply
forumReplySchema.methods.editContent = function(newContent) {
  // Save to edit history
  this.editHistory.push({ 
    content: this.content 
  });
  
  this.content = newContent;
  this.isEdited = true;
  this.editedAt = new Date();
  
  return this.save();
};

// Static method to get post replies with nesting
forumReplySchema.statics.getPostReplies = function(postId, options = {}) {
  const {
    page = 1,
    limit = 20,
    includeNested = true
  } = options;

  const skip = (page - 1) * limit;
  const query = { 
    post: postId, 
    status: 'published',
    parentReply: null // Only top-level replies
  };

  let populateOptions = 'author';
  if (includeNested) {
    populateOptions = [
      {
        path: 'author',
        select: 'firstName lastName profilePicture'
      }
    ];
  }

  return this.find(query)
    .populate(populateOptions)
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);
};

// Static method to get nested replies
forumReplySchema.statics.getNestedReplies = function(parentReplyId) {
  return this.find({ 
    parentReply: parentReplyId, 
    status: 'published' 
  })
  .populate('author', 'firstName lastName profilePicture')
  .sort({ createdAt: 1 });
};

module.exports = {
  Forum: mongoose.model('Forum', forumSchema),
  ForumPost: mongoose.model('ForumPost', forumPostSchema),
  ForumReply: mongoose.model('ForumReply', forumReplySchema)
};