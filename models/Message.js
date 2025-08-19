// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String,
    trim: true
  },
  fileName: {
    type: String,
    trim: true
  },
  fileSize: {
    type: Number
  },
  // Message reactions
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    emoji: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Reply to another message
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  // Message status
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  // Read receipts
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ type: 1 });
messageSchema.index({ isDeleted: 1 });

// Virtual for reaction count
messageSchema.virtual('reactionCount').get(function() {
  return this.reactions.length;
});

// Virtual for read status
messageSchema.virtual('isRead').get(function() {
  return this.readBy.length > 0;
});

// Method to add reaction
messageSchema.methods.addReaction = function(userId, emoji) {
  // Remove existing reaction from this user for this emoji
  this.reactions = this.reactions.filter(
    reaction => !(reaction.user.toString() === userId.toString() && reaction.emoji === emoji)
  );
  
  // Add new reaction
  this.reactions.push({ user: userId, emoji });
  return this.save();
};

// Method to remove reaction
messageSchema.methods.removeReaction = function(userId, emoji) {
  this.reactions = this.reactions.filter(
    reaction => !(reaction.user.toString() === userId.toString() && reaction.emoji === emoji)
  );
  return this.save();
};

// Method to mark as read by user
messageSchema.methods.markAsRead = function(userId) {
  // Check if already read by this user
  const alreadyRead = this.readBy.some(
    read => read.user.toString() === userId.toString()
  );
  
  if (!alreadyRead) {
    this.readBy.push({ user: userId });
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Method to soft delete
messageSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Static method to get chat messages with pagination
messageSchema.statics.getChatMessages = function(chatId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return this.find({ 
    chatId, 
    isDeleted: false 
  })
  .populate('sender', 'firstName lastName profilePicture')
  .populate('replyTo', 'content sender')
  .populate('reactions.user', 'firstName lastName')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

// Static method to get unread message count for user
messageSchema.statics.getUnreadCount = function(chatId, userId) {
  return this.countDocuments({
    chatId,
    isDeleted: false,
    sender: { $ne: userId },
    'readBy.user': { $ne: userId }
  });
};

module.exports = mongoose.model('Message', messageSchema);