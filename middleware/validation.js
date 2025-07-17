const { body, validationResult, query, param } = require('express-validator');

// Handle validation errors
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Auth validations
const validateRegister = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').trim().isLength({ min: 1, max: 50 }).withMessage('First name required (max 50 chars)'),
  body('lastName').trim().isLength({ min: 1, max: 50 }).withMessage('Last name required (max 50 chars)'),
  handleValidation
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  handleValidation
];

// Profile validations
const validateProfile = [
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  body('graduationYear').optional().isInt({ min: 1950, max: new Date().getFullYear() + 10 }),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio must be under 500 characters'),
  body('skills').optional().isArray().withMessage('Skills must be an array'),
  body('linkedIn').optional().isURL().withMessage('Valid LinkedIn URL required'),
  body('github').optional().isURL().withMessage('Valid GitHub URL required'),
  body('website').optional().isURL().withMessage('Valid website URL required'),
  handleValidation
];

// Event validations
const validateEvent = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Event title required (max 200 chars)'),
  body('description').trim().isLength({ min: 1, max: 2000 }).withMessage('Description required (max 2000 chars)'),
  body('eventType').isIn(['Networking', 'Career Development', 'Social', 'Academic', 'Alumni Meetup']),
  body('startDate').isISO8601().withMessage('Valid start date required'),
  body('endDate').isISO8601().withMessage('Valid end date required'),
  body('location.venue').optional().trim().isLength({ max: 200 }),
  handleValidation
];

// Job validations
const validateJob = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Job title required (max 200 chars)'),
  body('description').trim().isLength({ min: 1, max: 5000 }).withMessage('Description required (max 5000 chars)'),
  body('company').trim().isLength({ min: 1 }).withMessage('Company name required'),
  body('employmentType').isIn(['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote']),
  body('experienceLevel').isIn(['Entry Level', 'Mid Level', 'Senior Level', 'Executive']),
  body('requirements').isArray().withMessage('Requirements must be an array'),
  body('skills').isArray().withMessage('Skills must be an array'),
  handleValidation
];

// Survey validations
const validateSurvey = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Survey title required'),
  body('description').trim().isLength({ min: 1, max: 1000 }).withMessage('Description required'),
  body('surveyType').isIn(['Employment Status', 'Career Progression', 'Skills Assessment', 'Program Evaluation', 'General Feedback']),
  body('questions').isArray({ min: 1 }).withMessage('At least one question required'),
  handleValidation
];

// Pagination validation
const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  handleValidation
];

module.exports = {
  validateRegister,
  validateLogin,
  validateProfile,
  validateEvent,
  validateJob,
  validateSurvey,
  validatePagination,
  handleValidation
};