// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['direct', 'group', 'alumni_group', 'department_group', 'batch_group'],
    default: 'direct'
  },
  name: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['member', 'admin'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastSeenAt: {
      type: Date
    }
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isPrivate: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
chatSchema.index({ 'participants.user': 1 });
chatSchema.index({ lastActivity: -1 });
chatSchema.index({ type: 1 });

// Virtual for participant count
chatSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

// Static method to find user's chats
chatSchema.statics.findUserChats = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type,
    includeArchived = false
  } = options;

  const query = {
    'participants.user': userId
  };

  if (!includeArchived) {
    query.isArchived = false;
  }

  if (type) {
    query.type = type;
  }

  const skip = (page - 1) * limit;

  return this.find(query)
    .populate('participants.user', 'firstName lastName profilePicture isOnline lastSeenAt')
    .populate('lastMessage')
    .sort({ lastActivity: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static method to create direct chat
chatSchema.statics.createDirectChat = async function(userId1, userId2) {
  // Check if direct chat already exists
  const existingChat = await this.findOne({
    type: 'direct',
    $and: [
      { 'participants.user': userId1 },
      { 'participants.user': userId2 }
    ],
    'participants': { $size: 2 }
  });

  if (existingChat) {
    return existingChat.populate('participants.user', 'firstName lastName profilePicture');
  }

  // Create new direct chat
  const chat = new this({
    type: 'direct',
    participants: [
      { user: userId1, role: 'member' },
      { user: userId2, role: 'member' }
    ],
    createdBy: userId1
  });

  await chat.save();
  return chat.populate('participants.user', 'firstName lastName profilePicture');
};

// Static method to create group chat
chatSchema.statics.createGroupChat = async function(creatorId, name, participantIds, options = {}) {
  const {
    description,
    isPrivate = true,
    type = 'group'
  } = options;

  // Creator is admin, others are members
  const participants = [
    { user: creatorId, role: 'admin' },
    ...participantIds.map(id => ({ user: id, role: 'member' }))
  ];

  const chat = new this({
    type,
    name,
    description,
    participants,
    isPrivate,
    createdBy: creatorId
  });

  await chat.save();
  return chat.populate('participants.user', 'firstName lastName profilePicture');
};

// Instance method to update last seen
chatSchema.methods.updateLastSeen = function(userId) {
  const participant = this.participants.find(p => 
    p.user._id?.toString() === userId.toString() || 
    p.user.toString() === userId.toString()
  );
  
  if (participant) {
    participant.lastSeenAt = new Date();
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to add participant
chatSchema.methods.addParticipant = function(userId, role = 'member') {
  // Check if already a participant
  const isParticipant = this.participants.some(p => 
    p.user.toString() === userId.toString()
  );

  if (!isParticipant) {
    this.participants.push({
      user: userId,
      role,
      joinedAt: new Date()
    });
    return this.save();
  }

  return Promise.resolve(this);
};

// Instance method to remove participant
chatSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(p => 
    p.user.toString() !== userId.toString()
  );
  return this.save();
};

// Instance method to check if user is participant
chatSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => 
    p.user._id?.toString() === userId.toString() || 
    p.user.toString() === userId.toString()
  );
};

// Instance method to get participant info
chatSchema.methods.getParticipant = function(userId) {
  return this.participants.find(p => 
    p.user._id?.toString() === userId.toString() || 
    p.user.toString() === userId.toString()
  );
};

module.exports = mongoose.model('Chat', chatSchema);