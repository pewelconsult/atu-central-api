// routes/surveys.routes.js - USER OPERATIONS ONLY

const express = require('express');
const { Survey, SurveyResponse } = require('../models/Survey');
const Activity = require('../models/Activity');
const { auth, optionalAuth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Get all active surveys (public)
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      surveyType
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status: 'active' }; // Only show active surveys to users
    
    if (surveyType && surveyType !== 'all') {
      query.surveyType = surveyType;
    }

    const cacheKey = `surveys:public:${JSON.stringify({ page, limit, surveyType })}`;
    let cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const surveys = await Survey.find(query)
      .populate('createdBy', 'firstName lastName')
      .select('-questions') // Don't include questions in list view
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Survey.countDocuments(query);

    const result = {
      success: true,
      data: {
        surveys,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    };

    // Cache for 15 minutes
    await cache.set(cacheKey, result, 900);
    res.json(result);

  } catch (error) {
    console.error('Get surveys error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch surveys'
    });
  }
});

// Get user's survey responses
router.get('/me/responses', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const responses = await SurveyResponse.find({ respondent: userId })
      .populate('survey', 'title surveyType createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: responses
    });

  } catch (error) {
    console.error('Get user responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your responses'
    });
  }
});

// Get single survey with questions
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id)
      .populate('createdBy', 'firstName lastName');

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Only show active surveys to regular users
    if (survey.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Survey is not available'
      });
    }

    // Check if user has already responded
    let userResponse = null;
    if (req.user && !survey.allowMultipleResponses) {
      userResponse = await SurveyResponse.findOne({
        survey: req.params.id,
        respondent: req.user._id || req.user.id
      });
    }

    res.json({
      success: true,
      data: {
        survey,
        hasResponded: !!userResponse,
        userResponse: userResponse || null
      }
    });

  } catch (error) {
    console.error('Get survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey'
    });
  }
});

// Submit survey response
router.post('/:id/respond', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { responses } = req.body;
    
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    if (survey.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Survey is not active'
      });
    }

    // Check if survey has ended
    if (survey.endDate && new Date() > survey.endDate) {
      return res.status(400).json({
        success: false,
        message: 'Survey has ended'
      });
    }

    // Check if user has already responded
    if (!survey.allowMultipleResponses) {
      const existingResponse = await SurveyResponse.findOne({
        survey: req.params.id,
        respondent: userId
      });

      if (existingResponse) {
        return res.status(400).json({
          success: false,
          message: 'You have already responded to this survey'
        });
      }
    }

    // Validate responses against survey questions
    const validationErrors = validateSurveyResponses(survey.questions, responses);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid responses',
        errors: validationErrors
      });
    }

    // Create response
    const surveyResponse = new SurveyResponse({
      survey: req.params.id,
      respondent: survey.isAnonymous ? null : userId,
      responses,
      isComplete: true,
      completedAt: new Date(),
      ipAddress: req.ip
    });

    await surveyResponse.save();

    // Update survey response count
    survey.responseCount += 1;
    await survey.save();

    // Create activity for survey response
    if (!survey.isAnonymous) {
      try {
        await Activity.createActivity({
          user: userId,
          type: 'survey_response',
          action: `Completed survey: ${survey.title}`,
          description: `completed the survey <strong>${survey.title}</strong>`,
          metadata: {
            targetSurvey: survey._id,
            surveyTitle: survey.title,
            surveyType: survey.surveyType,
            responseId: surveyResponse._id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
          },
          visibility: 'private',
          points: 30
        });
      } catch (activityError) {
        console.error('Failed to create survey response activity:', activityError);
      }
    }

    res.json({
      success: true,
      message: 'Survey response submitted successfully',
      data: { 
        responseId: surveyResponse._id,
        survey: survey.title 
      }
    });

  } catch (error) {
    console.error('Submit survey response error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit survey response'
    });
  }
});

// Helper function
function validateSurveyResponses(questions, responses) {
  const errors = [];
  
  questions.forEach(question => {
    const response = responses.find(r => r.questionId.toString() === question._id.toString());
    
    if (question.isRequired && (!response || !response.answer)) {
      errors.push(`Question "${question.questionText}" is required`);
    }
    
    if (response && response.answer) {
      switch (question.questionType) {
        case 'multipleChoice':
        case 'dropdown':
          if (!question.options.includes(response.answer)) {
            errors.push(`Invalid option for question "${question.questionText}"`);
          }
          break;
        case 'rating':
          const rating = parseInt(response.answer);
          if (isNaN(rating) || rating < 1 || rating > 5) {
            errors.push(`Rating must be between 1-5 for question "${question.questionText}"`);
          }
          break;
        case 'checkbox':
          if (!Array.isArray(response.answer)) {
            errors.push(`Checkbox response must be an array for question "${question.questionText}"`);
          }
          break;
        case 'number':
          if (isNaN(response.answer)) {
            errors.push(`Number response required for question "${question.questionText}"`);
          }
          break;
      }
    }
  });
  
  return errors;
}

module.exports = router;