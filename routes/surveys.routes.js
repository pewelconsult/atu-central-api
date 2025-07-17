const express = require('express');
const { Survey, SurveyResponse } = require('../models/Survey');
const { auth, optionalAuth, adminAuth } = require('../middleware/auth');
const { validateSurvey, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Get all surveys (public)
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      surveyType,
      status = 'active'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status };

    if (surveyType) query.surveyType = surveyType;

    const cacheKey = `surveys:${JSON.stringify({ page, limit, surveyType, status })}`;
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

// Get single survey with questions
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
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

// Create new survey (admin only)
router.post('/', [auth, adminAuth, validateSurvey], async (req, res) => {
  try {
    const surveyData = {
      ...req.body,
      createdBy: req.user._id || req.user.id
    };

    const survey = new Survey(surveyData);
    await survey.save();

    // Clear surveys cache
    await cache.del('surveys:*');

    res.status(201).json({
      success: true,
      message: 'Survey created successfully',
      data: survey
    });

  } catch (error) {
    console.error('Create survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create survey'
    });
  }
});

// Update survey (admin only)
router.put('/:id', [auth, adminAuth, validateSurvey], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Don't allow editing if survey has responses
    if (survey.responseCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit survey with existing responses'
      });
    }

    Object.assign(survey, req.body);
    await survey.save();

    // Clear cache
    await cache.del('surveys:*');

    res.json({
      success: true,
      message: 'Survey updated successfully',
      data: survey
    });

  } catch (error) {
    console.error('Update survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update survey'
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

    res.json({
      success: true,
      message: 'Survey response submitted successfully'
    });

  } catch (error) {
    console.error('Submit survey response error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit survey response'
    });
  }
});

// Get survey analytics (admin only)
router.get('/:id/analytics', [auth, adminAuth], async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Get response analytics
    const responses = await SurveyResponse.find({ survey: req.params.id });
    
    const analytics = {
      totalResponses: responses.length,
      completionRate: survey.targetCount ? (responses.length / survey.targetCount) * 100 : null,
      avgCompletionTime: null, // Can be calculated if you track start/end times
      responsesByDate: getResponsesByDate(responses),
      questionAnalytics: analyzeQuestionResponses(survey.questions, responses)
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Get survey analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey analytics'
    });
  }
});

// Get all survey responses (admin only)
router.get('/:id/responses', [auth, adminAuth, validatePagination], async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const responses = await SurveyResponse.find({ survey: req.params.id })
      .populate('respondent', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SurveyResponse.countDocuments({ survey: req.params.id });

    res.json({
      success: true,
      data: {
        responses,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get survey responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey responses'
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

// Helper functions
function validateSurveyResponses(questions, responses) {
  const errors = [];
  
  questions.forEach(question => {
    const response = responses.find(r => r.questionId.toString() === question._id.toString());
    
    if (question.isRequired && (!response || !response.answer)) {
      errors.push(`Question "${question.questionText}" is required`);
    }
    
    if (response && response.answer) {
      // Validate based on question type
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
      }
    }
  });
  
  return errors;
}

function getResponsesByDate(responses) {
  const responsesByDate = {};
  
  responses.forEach(response => {
    const date = response.createdAt.toISOString().split('T')[0];
    responsesByDate[date] = (responsesByDate[date] || 0) + 1;
  });
  
  return responsesByDate;
}

function analyzeQuestionResponses(questions, responses) {
  return questions.map(question => {
    const questionResponses = responses
      .map(r => r.responses.find(resp => resp.questionId.toString() === question._id.toString()))
      .filter(r => r && r.answer);

    const analytics = {
      questionId: question._id,
      questionText: question.questionText,
      questionType: question.questionType,
      totalResponses: questionResponses.length,
      responses: questionResponses.map(r => r.answer)
    };

    // Add specific analytics based on question type
    if (question.questionType === 'multipleChoice' || question.questionType === 'dropdown') {
      analytics.distribution = question.options.map(option => ({
        option,
        count: questionResponses.filter(r => r.answer === option).length
      }));
    } else if (question.questionType === 'rating') {
      const ratings = questionResponses.map(r => parseInt(r.answer));
      analytics.average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      analytics.distribution = [1, 2, 3, 4, 5].map(rating => ({
        rating,
        count: ratings.filter(r => r === rating).length
      }));
    }

    return analytics;
  });
}

module.exports = router;