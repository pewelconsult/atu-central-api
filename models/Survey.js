const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  questionType: {
    type: String,
    enum: ['text', 'multipleChoice', 'rating', 'dropdown', 'checkbox'],
    required: true
  },
  options: [String], // For multiple choice, dropdown, checkbox
  isRequired: { type: Boolean, default: true },
  order: { type: Number, required: true }
});

const surveySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  surveyType: {
    type: String,
    enum: ['Employment Status', 'Career Progression', 'Skills Assessment', 'Program Evaluation', 'General Feedback'],
    required: true
  },
  
  // Survey Structure
  questions: [questionSchema],
  
  // Targeting
  targetAudience: {
    graduationYears: [Number],
    programs: [String],
    allAlumni: { type: Boolean, default: false }
  },
  
  // Survey Settings
  isAnonymous: { type: Boolean, default: false },
  allowMultipleResponses: { type: Boolean, default: false },
  
  // Dates
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  
  // Survey Status
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'closed'],
    default: 'draft'
  },
  
  // Creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Analytics
  responseCount: { type: Number, default: 0 },
  targetCount: Number
}, {
  timestamps: true
});

// Survey Response Model
const responseSchema = new mongoose.Schema({
  survey: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Survey',
    required: true
  },
  respondent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  responses: [{
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    answer: mongoose.Schema.Types.Mixed // Can be string, array, number
  }],
  
  isComplete: { type: Boolean, default: false },
  completedAt: Date,
  ipAddress: String
}, {
  timestamps: true
});

surveySchema.index({ status: 1 });
surveySchema.index({ createdBy: 1 });
surveySchema.index({ surveyType: 1 });

responseSchema.index({ survey: 1 });
responseSchema.index({ respondent: 1 });
responseSchema.index({ survey: 1, respondent: 1 }, { unique: true });

module.exports = {
  Survey: mongoose.model('Survey', surveySchema),
  SurveyResponse: mongoose.model('SurveyResponse', responseSchema)
};