// models/Profile.js
const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  phone: {
    type: String,
    trim: true,
    match: [/^\+?[\d\s\-\(\)]+$/, 'Please enter a valid phone number']
  },
  location: {
    type: String,
    trim: true,
    maxlength: [100, 'Location cannot exceed 100 characters']
  },
  bio: {
    type: String,
    trim: true,
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },
  
  // File Upload Fields
  profilePicture: {
    type: String, // URL to the uploaded image
    trim: true
  },
  profilePicturePath: {
    type: String, // Relative path for internal use
    trim: true
  },
  resumeUrl: {
    type: String, // URL to the uploaded resume
    trim: true
  },
  resumePath: {
    type: String, // Relative path for internal use
    trim: true
  },
  resumeFilename: {
    type: String, // Original filename
    trim: true
  },
  resumeUploadedAt: {
    type: Date
  },
  
  // Academic Information
  graduationYear: {
    type: Number,
    min: [1950, 'Graduation year must be after 1950'],
    max: [new Date().getFullYear() + 10, 'Graduation year cannot be too far in the future']
  },
  program: {
    type: String,
    trim: true,
    maxlength: [100, 'Program name cannot exceed 100 characters']
  },
  degree: {
    type: String,
    enum: ['Bachelor', 'Master', 'PhD', 'Diploma', 'Certificate', 'Other'],
    default: 'Bachelor'
  },
  gpa: {
    type: Number,
    min: 0,
    max: 4.0
  },
  
  // Employment Information
  employmentStatus: {
    type: String,
    enum: ['Employed full-time', 'Employed part-time', 'Self-employed', 'Unemployed - seeking work', 'Unemployed - not seeking work', 'Student', 'Retired'],
    default: 'Employed full-time'
  },
  currentPosition: {
    type: String,
    trim: true,
    maxlength: [100, 'Position cannot exceed 100 characters']
  },
  currentCompany: {
    type: String,
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  industry: {
    type: String,
    trim: true,
    maxlength: [50, 'Industry cannot exceed 50 characters']
  },
  workExperience: {
    type: Number, // Years of experience
    min: 0,
    max: 50
  },
  
  // Skills and Interests
  skills: [{
    type: String,
    trim: true,
    maxlength: [30, 'Each skill cannot exceed 30 characters']
  }],
  interests: [{
    type: String,
    trim: true,
    maxlength: [30, 'Each interest cannot exceed 30 characters']
  }],
  
  // Social Links
  linkedIn: {
    type: String,
    trim: true,
    match: [/^https?:\/\/(www\.)?linkedin\.com\/.*$/, 'Please enter a valid LinkedIn URL']
  },
  github: {
    type: String,
    trim: true,
    match: [/^https?:\/\/(www\.)?github\.com\/.*$/, 'Please enter a valid GitHub URL']
  },
  twitter: {
    type: String,
    trim: true,
    match: [/^https?:\/\/(www\.)?twitter\.com\/.*$/, 'Please enter a valid Twitter URL']
  },
  website: {
    type: String,
    trim: true,
    match: [/^https?:\/\/.*$/, 'Please enter a valid website URL']
  },
  
  // Availability
  openToOpportunities: {
    type: Boolean,
    default: true
  },
  availableForMentoring: {
    type: Boolean,
    default: false
  },
  openToNetworking: {
    type: Boolean,
    default: true
  },
  
  // Privacy Settings
  profileVisibility: {
    type: String,
    enum: ['public', 'alumni-only', 'private'],
    default: 'alumni-only'
  },
  showEmail: {
    type: Boolean,
    default: false
  },
  showPhone: {
    type: Boolean,
    default: false
  },
  
  // Connections
  connections: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'blocked'],
      default: 'pending'
    },
    connectedAt: {
      type: Date
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Statistics
  profileViews: {
    type: Number,
    default: 0
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
profileSchema.index({ user: 1 });
profileSchema.index({ graduationYear: 1, program: 1 });
profileSchema.index({ employmentStatus: 1, currentCompany: 1 });
profileSchema.index({ location: 1, openToOpportunities: 1 });
profileSchema.index({ skills: 1 });
profileSchema.index({ profileVisibility: 1, lastActiveAt: -1 });
profileSchema.index({ 'connections.user': 1, 'connections.status': 1 });

// Virtual for connection count
profileSchema.virtual('connectionCount').get(function() {
  return this.connections.filter(conn => conn.status === 'accepted').length;
});

// Virtual for profile completion percentage
profileSchema.virtual('completionPercentage').get(function() {
  let completion = 0;
  const fields = [
    'phone', 'location', 'bio', 'graduationYear', 'program', 
    'currentPosition', 'currentCompany', 'skills', 'profilePicture'
  ];
  
  fields.forEach(field => {
    if (field === 'skills') {
      if (this.skills && this.skills.length > 0) completion += 10;
    } else if (this[field]) {
      completion += 10;
    }
  });
  
  return Math.min(completion, 100);
});

// Method to add connection
profileSchema.methods.addConnection = function(userId, status = 'pending') {
  const existingConnection = this.connections.find(
    conn => conn.user.toString() === userId.toString()
  );
  
  if (existingConnection) {
    existingConnection.status = status;
    if (status === 'accepted') {
      existingConnection.connectedAt = new Date();
    }
  } else {
    this.connections.push({
      user: userId,
      status,
      connectedAt: status === 'accepted' ? new Date() : undefined
    });
  }
  
  return this.save();
};

// Method to remove connection
profileSchema.methods.removeConnection = function(userId) {
  this.connections = this.connections.filter(
    conn => conn.user.toString() !== userId.toString()
  );
  return this.save();
};

// Method to update last active
profileSchema.methods.updateLastActive = function() {
  this.lastActiveAt = new Date();
  return this.save();
};

// Static method to find profiles with filters
profileSchema.statics.findWithFilters = function(filters = {}) {
  const query = { profileVisibility: { $ne: 'private' } };
  
  if (filters.graduationYear) {
    query.graduationYear = filters.graduationYear;
  }
  
  if (filters.program) {
    query.program = new RegExp(filters.program, 'i');
  }
  
  if (filters.location) {
    query.location = new RegExp(filters.location, 'i');
  }
  
  if (filters.employmentStatus) {
    query.employmentStatus = filters.employmentStatus;
  }
  
  if (filters.skills && Array.isArray(filters.skills)) {
    query.skills = { $in: filters.skills };
  }
  
  return this.find(query).populate('user', 'firstName lastName email role');
};

// Pre-save middleware to update profile completion in User model
profileSchema.post('save', async function(doc) {
  try {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(doc.user, {
      profileCompletion: doc.completionPercentage
    });
  } catch (error) {
    console.error('Error updating user profile completion:', error);
  }
});

module.exports = mongoose.model('Profile', profileSchema);