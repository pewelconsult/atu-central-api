// models/Communication.js - Create this file if it doesn't exist

const mongoose = require('mongoose');

const communicationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['email', 'sms', 'both'],
    required: true
  },
  subject: {
    type: String,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000
  },
  recipients: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    email: String,
    phone: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'bounced'],
      default: 'pending'
    },
    sentAt: Date,
    error: String
  }],
  recipientCount: {
    type: Number,
    default: 0
  },
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'sending', 'sent', 'failed', 'scheduled', 'cancelled'],
    default: 'draft'
  },
  scheduledFor: Date,
  sentAt: Date,
  completedAt: Date,
  stats: {
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    emailsSent: { type: Number, default: 0 },
    emailsFailed: { type: Number, default: 0 },
    smsSent: { type: Number, default: 0 },
    smsFailed: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes
communicationSchema.index({ sentBy: 1, createdAt: -1 });
communicationSchema.index({ status: 1, scheduledFor: 1 });
communicationSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('Communication', communicationSchema);