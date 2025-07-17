const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  eventType: {
    type: String,
    enum: ['Networking', 'Career Development', 'Social', 'Academic', 'Alumni Meetup'],
    required: true
  },
  
  // Event Details
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  location: {
    venue: String,
    address: String,
    city: String,
    isOnline: { type: Boolean, default: false },
    onlineLink: String
  },
  
  // Registration
  maxAttendees: {
    type: Number,
    min: 1
  },
  registrationDeadline: Date,
  requiresApproval: {
    type: Boolean,
    default: false
  },
  
  // Organizer
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Attendees
  attendees: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    registeredAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['registered', 'attended', 'cancelled'], default: 'registered' },
    checkInTime: Date
  }],
  
  // Event Status
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled', 'completed'],
    default: 'draft'
  },
  
  // Additional Info
  tags: [String],
  imageUrl: String,
  attachments: [{
    name: String,
    url: String,
    type: String
  }]
}, {
  timestamps: true
});

eventSchema.index({ startDate: 1 });
eventSchema.index({ eventType: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ organizer: 1 });

module.exports = mongoose.model('Event', eventSchema);