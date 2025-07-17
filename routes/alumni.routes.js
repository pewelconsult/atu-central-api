const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const { auth, optionalAuth } = require('../middleware/auth');
const { validateProfile, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Get all alumni with filtering and pagination
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      graduationYear,
      program,
      location,
      employmentStatus,
      skills
    } = req.query;

    const skip = (page - 1) * limit;
    
    // Build search query
    let searchQuery = {};
    let profileQuery = {};

    if (search) {
      searchQuery.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (graduationYear) profileQuery.graduationYear = graduationYear;
    if (program) profileQuery.program = { $regex: program, $options: 'i' };
    if (location) profileQuery.location = { $regex: location, $options: 'i' };
    if (employmentStatus) profileQuery.employmentStatus = employmentStatus;
    if (skills) profileQuery.skills = { $in: Array.isArray(skills) ? skills : [skills] };

    // Create cache key
    const cacheKey = `alumni:${JSON.stringify({ page, limit, search, graduationYear, program, location, employmentStatus, skills })}`;
    
    // Check cache first
    let cachedResult = await cache.get(cacheKey);
    if (cachedResult) {
      return res.json(cachedResult);
    }

    // Get users with profiles
    const pipeline = [
      { $match: { ...searchQuery, role: 'alumni', isActive: true } },
      {
        $lookup: {
          from: 'profiles',
          localField: '_id',
          foreignField: 'user',
          as: 'profile'
        }
      },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      { $match: profileQuery },
      {
        $project: {
          password: 0,
          'profile.connections': 0
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ];

    const alumni = await User.aggregate(pipeline);
    
    // Get total count for pagination
    const totalPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const totalResult = await User.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    const result = {
      success: true,
      data: {
        alumni,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    };

    // Cache for 5 minutes
    await cache.set(cacheKey, result, 300);

    res.json(result);

  } catch (error) {
    console.error('Get alumni error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alumni'
    });
  }
});

// Get single alumnus profile
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Alumni not found'
      });
    }

    const profile = await Profile.findOne({ user: id }).populate('connections.user', 'firstName lastName email');

    res.json({
      success: true,
      data: {
        user,
        profile
      }
    });

  } catch (error) {
    console.error('Get alumni profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// Update current user's profile
router.put('/profile', [auth, validateProfile], async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    let profile = await Profile.findOne({ user: userId });
    
    if (!profile) {
      profile = new Profile({ user: userId, ...req.body });
    } else {
      Object.assign(profile, req.body);
    }

    await profile.save();

    // Calculate and update profile completion
    const completionPercentage = calculateProfileCompletion(req.user, profile);
    await User.findByIdAndUpdate(userId, { profileCompletion: completionPercentage });

    // Clear user cache
    await cache.del(`user:${userId}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: profile
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Send connection request
router.post('/:id/connect', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const targetUserId = req.params.id;

    if (userId.toString() === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot connect to yourself'
      });
    }

    const targetProfile = await Profile.findOne({ user: targetUserId });
    if (!targetProfile) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    // Check if connection already exists
    const existingConnection = targetProfile.connections.find(
      conn => conn.user.toString() === userId.toString()
    );

    if (existingConnection) {
      return res.status(400).json({
        success: false,
        message: 'Connection request already sent'
      });
    }

    // Add connection request
    targetProfile.connections.push({
      user: userId,
      status: 'pending'
    });

    await targetProfile.save();

    res.json({
      success: true,
      message: 'Connection request sent successfully'
    });

  } catch (error) {
    console.error('Send connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send connection request'
    });
  }
});

// Accept/reject connection request
router.put('/connections/:connectionId/:action', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { connectionId, action } = req.params;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    const profile = await Profile.findOne({ user: userId });
    const connection = profile.connections.id(connectionId);

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    if (action === 'accept') {
      connection.status = 'accepted';
      connection.connectedAt = new Date();

      // Add reciprocal connection
      const otherProfile = await Profile.findOne({ user: connection.user });
      otherProfile.connections.push({
        user: userId,
        status: 'accepted',
        connectedAt: new Date()
      });
      await otherProfile.save();
    } else {
      profile.connections.pull(connectionId);
    }

    await profile.save();

    res.json({
      success: true,
      message: `Connection ${action}ed successfully`
    });

  } catch (error) {
    console.error('Connection action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process connection'
    });
  }
});

// Get current user's profile
router.get('/me/profile', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const profile = await Profile.findOne({ user: userId })
      .populate('connections.user', 'firstName lastName email role');

    if (!profile) {
      return res.json({
        success: true,
        data: null,
        message: 'Profile not found. Please complete your profile.'
      });
    }

    res.json({
      success: true,
      data: profile
    });

  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// Helper function to calculate profile completion
function calculateProfileCompletion(user, profile) {
  let completion = 20; // Base for account creation
  
  if (profile) {
    if (profile.phone) completion += 10;
    if (profile.location) completion += 10;
    if (profile.bio) completion += 15;
    if (profile.currentPosition) completion += 10;
    if (profile.currentCompany) completion += 10;
    if (profile.graduationYear) completion += 10;
    if (profile.program) completion += 10;
    if (profile.skills && profile.skills.length > 0) completion += 5;
  }
  
  return Math.min(completion, 100);
}

module.exports = router;