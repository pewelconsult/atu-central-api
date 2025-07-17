const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 5000
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  
  // Job Details
  employmentType: {
    type: String,
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'],
    required: true
  },
  experienceLevel: {
    type: String,
    enum: ['Entry Level', 'Mid Level', 'Senior Level', 'Executive'],
    required: true
  },
  salaryRange: {
    min: Number,
    max: Number,
    currency: { type: String, default: 'GHS' },
    period: { type: String, enum: ['hourly', 'monthly', 'annually'], default: 'monthly' }
  },
  
  // Location
  location: {
    city: String,
    country: { type: String, default: 'Ghana' },
    isRemote: { type: Boolean, default: false }
  },
  
  // Requirements
  requirements: [String],
  skills: [String],
  qualifications: [String],
  
  // Application Details
  applicationMethod: {
    type: String,
    enum: ['email', 'website', 'internal'],
    default: 'email'
  },
  applicationEmail: String,
  applicationUrl: String,
  applicationDeadline: Date,
  
  // Job Poster (Alumni who posted)
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Applications
  applications: [{
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    appliedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'under_review', 'interview', 'rejected', 'accepted'], default: 'pending' },
    coverLetter: String,
    resumeUrl: String
  }],
  
  // Job Status
  status: {
    type: String,
    enum: ['active', 'paused', 'closed', 'draft'],
    default: 'draft'
  },
  
  // Analytics
  views: { type: Number, default: 0 },
  
  // Additional
  benefits: [String],
  tags: [String]
}, {
  timestamps: true
});

jobSchema.index({ status: 1 });
jobSchema.index({ employmentType: 1 });
jobSchema.index({ experienceLevel: 1 });
jobSchema.index({ postedBy: 1 });
jobSchema.index({ 'location.city': 1 });
jobSchema.index({ skills: 1 });
jobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Job', jobSchema);