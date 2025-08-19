// routes/alumni.routes.js
const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Activity = require('../models/Activity'); // NEW - Added Activity model
const { auth, optionalAuth } = require('../middleware/auth');
const { validateProfile, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Helper function to update last active time
const updateLastActive = async (userId) => {
  try {
    await Profile.findOneAndUpdate(
      { user: userId },
      { lastActiveAt: new Date() }
    );
  } catch (error) {
    console.error('Error updating lastActiveAt:', error);
  }
};

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
    const currentUserId = req.user?._id || req.user?.id;
    
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

    // Create cache key WITHOUT user-specific data
    const cacheKey = `alumni:${JSON.stringify({ page, limit, search, graduationYear, program, location, employmentStatus, skills })}`;
    
    // Check cache first (but we'll add user-specific data after)
    let cachedResult = await cache.get(cacheKey);
    let alumni;
    let total;
    
    if (cachedResult && cachedResult.data) {
      alumni = cachedResult.data.alumni;
      total = cachedResult.data.pagination.totalItems;
    } else {
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
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            role: 1,
            profilePicture: 1,
            lastLoginAt: 1,
            createdAt: 1,
            profile: {
              _id: 1,
              phone: 1,
              location: 1,
              bio: 1,
              profilePicture: 1,
              graduationYear: 1,
              program: 1,
              degree: 1,
              currentPosition: 1,
              currentCompany: 1,
              skills: 1,
              lastActiveAt: 1
            }
          }
        },
        { $sort: { 'profile.lastActiveAt': -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit) }
      ];

      alumni = await User.aggregate(pipeline);
      
      // Get total count for pagination
      const totalPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
      const totalResult = await User.aggregate(totalPipeline);
      total = totalResult[0]?.total || 0;

      // Cache the basic result
      const basicResult = {
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

      await cache.set(cacheKey, basicResult, 300);
    }
    
    // If user is authenticated, add connection status
    if (currentUserId) {
      // Get current user's profile with connections
      const currentUserProfile = await Profile.findOne({ user: currentUserId });
      
      // Debug logging
      console.log('Current user ID:', currentUserId.toString());
      console.log('Current user connections:', currentUserProfile?.connections?.map(c => ({
        id: c._id,
        userId: c.user.toString(),
        status: c.status
      })));
      
      // Add connection status to each alumni
      alumni.forEach(alumnus => {
        // First check if current user has received a connection from this alumni
        const receivedConnection = currentUserProfile?.connections?.find(
          conn => conn.user.toString() === alumnus._id.toString() && conn.status === 'pending'
        );
        
        if (receivedConnection) {
          // Current user received a pending connection from this alumni
          alumnus.connectionStatus = 'received';
          alumnus.isConnected = false;
          alumnus.receivedConnectionId = receivedConnection._id.toString();
          
          console.log(`Found received connection from ${alumnus.firstName} ${alumnus.lastName}:`, {
            connectionId: receivedConnection._id.toString(),
            status: receivedConnection.status
          });
        } else {
          // Check if already connected
          const existingConnection = currentUserProfile?.connections?.find(
            conn => conn.user.toString() === alumnus._id.toString() && conn.status === 'accepted'
          );
          
          if (existingConnection) {
            alumnus.connectionStatus = 'accepted';
            alumnus.isConnected = true;
          } else {
            alumnus.connectionStatus = null;
            alumnus.isConnected = false;
          }
        }
      });
      
      // Now check for sent connections (where current user sent the request to alumni)
      const alumniIds = alumni.map(a => a._id);
      const alumniProfiles = await Profile.find({ 
        user: { $in: alumniIds }
      }).select('user connections');
      
      alumni.forEach(alumnus => {
        // Only check if we haven't already found a received connection
        if (!alumnus.connectionStatus || alumnus.connectionStatus === null) {
          const alumniProfile = alumniProfiles.find(
            p => p.user.toString() === alumnus._id.toString()
          );
          
          if (alumniProfile) {
            const sentConnection = alumniProfile.connections?.find(
              conn => conn.user.toString() === currentUserId.toString()
            );
            
            if (sentConnection) {
              if (sentConnection.status === 'pending') {
                alumnus.connectionStatus = 'pending'; // Current user sent request
              } else if (sentConnection.status === 'accepted') {
                alumnus.connectionStatus = 'accepted';
                alumnus.isConnected = true;
              }
            }
          }
        }
      });
    }

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

    res.json(result);

  } catch (error) {
    console.error('Get alumni error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alumni'
    });
  }
});

// ===== IMPORTANT: ALL SPECIFIC ROUTES MUST COME BEFORE DYNAMIC ROUTES =====

// Get current user's profile
router.get('/me/profile', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    // Update last active when user views their profile
    await updateLastActive(userId);
    
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


router.get('/connections', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { status } = req.query;
    
    // First, get the current user's profile with basic user population
    const profile = await Profile.findOne({ user: userId })
      .populate({
        path: 'connections.user',
        select: 'firstName lastName email profilePicture lastLoginAt'
      });

    if (!profile) {
      return res.json({
        success: true,
        data: []
      });
    }

    let connections = profile.connections;
    
    // Filter by status if provided
    if (status) {
      connections = connections.filter(conn => conn.status === status);
    }

    // Filter out connections where user is null (deleted users)
    connections = connections.filter(conn => conn.user !== null);

    // Now manually populate the profile data for each connection
    const populatedConnections = await Promise.all(
      connections.map(async (conn) => {
        try {
          // Check if user exists
          if (!conn.user || !conn.user._id) {
            console.log('Skipping connection with missing user:', conn._id);
            return null; // Will be filtered out later
          }

          // Get the profile for this connection
          const connProfile = await Profile.findOne({ user: conn.user._id })
            .select('currentPosition currentCompany location bio skills graduationYear program')
            .lean();
          
          // Return the connection with populated profile data
          return {
            _id: conn._id,
            user: {
              _id: conn.user._id,
              firstName: conn.user.firstName,
              lastName: conn.user.lastName,
              email: conn.user.email,
              profilePicture: conn.user.profilePicture,
              lastLoginAt: conn.user.lastLoginAt,
              profile: connProfile || null
            },
            status: conn.status,
            createdAt: conn.createdAt,
            connectedAt: conn.connectedAt
          };
        } catch (err) {
          console.error('Error populating connection profile:', err);
          // Return null for connections that fail to populate
          return null;
        }
      })
    );

    // Filter out null connections (failed to populate or deleted users)
    const validConnections = populatedConnections.filter(conn => conn !== null);

    res.json({
      success: true,
      data: validConnections
    });

  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch connections'
    });
  }
});

// Search alumni - MOVED BEFORE DYNAMIC ROUTES
router.get('/search', [auth, validatePagination], async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchRegex = new RegExp(q.trim(), 'i');
    const skip = (page - 1) * limit;

    // Search in both User and Profile collections
    const pipeline = [
      {
        $match: {
          role: 'alumni',
          isActive: true,
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex }
          ]
        }
      },
      {
        $lookup: {
          from: 'profiles',
          localField: '_id',
          foreignField: 'user',
          as: 'profile'
        }
      },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
            { 'profile.currentPosition': searchRegex },
            { 'profile.currentCompany': searchRegex },
            { 'profile.location': searchRegex },
            { 'profile.skills': searchRegex }
          ]
        }
      },
      {
        $project: {
          password: 0,
          'profile.connections': 0
        }
      },
      { $sort: { 'profile.lastActiveAt': -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ];

    const results = await User.aggregate(pipeline);
    
    // Get total count
    const totalPipeline = [...pipeline.slice(0, -2), { $count: 'total' }];
    const totalResult = await User.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        results,
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
    console.error('Search alumni error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search alumni'
    });
  }
});

// Create or Update current user's profile
router.put('/profile', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    console.log('Profile update request for user:', userId);
    console.log('Request body:', req.body);

    // Update last active
    await updateLastActive(userId);

    // Clean the request body - remove empty strings and undefined values
    const cleanData = {};
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== '' && req.body[key] !== undefined && req.body[key] !== null) {
        cleanData[key] = req.body[key];
      }
    });

    // Check if profile exists
    let profile = await Profile.findOne({ user: userId });
    
    if (!profile) {
      // Create new profile
      console.log('Creating new profile with data:', cleanData);
      
      profile = new Profile({
        user: userId,
        ...cleanData
      });

      // Validate before saving
      const validationError = profile.validateSync();
      if (validationError) {
        console.error('Validation error:', validationError);
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: Object.keys(validationError.errors).reduce((acc, key) => {
            acc[key] = validationError.errors[key].message;
            return acc;
          }, {})
        });
      }
    } else {
      // Update existing profile
      console.log('Updating existing profile with data:', cleanData);
      Object.assign(profile, cleanData);
    }

    // Save the profile
    try {
      await profile.save();
      console.log('Profile saved successfully');
    } catch (saveError) {
      console.error('Save error:', saveError);
      
      // Handle specific mongoose errors
      if (saveError.name === 'ValidationError') {
        const errors = {};
        Object.keys(saveError.errors).forEach(key => {
          errors[key] = saveError.errors[key].message;
        });
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors
        });
      }
      
      throw saveError;
    }

    // Create activity for profile update - NEW
    try {
      await Activity.createActivity({
        user: userId,
        type: 'profile_update',
        action: 'Updated profile information',
        description: 'updated their profile',
        metadata: {
          changes: Object.keys(cleanData),
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'public',
        points: 5
      });
    } catch (activityError) {
      console.error('Failed to create profile update activity:', activityError);
    }

    // Calculate and update profile completion
    const completionPercentage = calculateProfileCompletion(req.user, profile);
    await User.findByIdAndUpdate(userId, { profileCompletion: completionPercentage });

    // Clear user cache
    if (cache && cache.del) {
      await cache.del(`user:${userId}`);
    }

    // Populate the response
    await profile.populate('user', 'firstName lastName email');

    res.json({
      success: true,
      message: profile.isNew ? 'Profile created successfully' : 'Profile updated successfully',
      data: profile
    });

  } catch (error) {
    console.error('Update profile error:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Accept/reject connection request - MOVED BEFORE DYNAMIC ROUTES
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

    // Get the other user's details for activity tracking
    const otherUser = await User.findById(connection.user).select('firstName lastName');

    if (action === 'accept') {
      connection.status = 'accepted';
      connection.connectedAt = new Date();

      // Add reciprocal connection
      const otherProfile = await Profile.findOne({ user: connection.user });
      if (otherProfile) {
        otherProfile.connections.push({
          user: userId,
          status: 'accepted',
          connectedAt: new Date()
        });
        await otherProfile.save();
      }

      // Create activity for connection acceptance - NEW
      try {
        // Activity for current user
        await Activity.createActivity({
          user: userId,
          type: 'connection_accepted',
          action: `Connected with ${otherUser.firstName} ${otherUser.lastName}`,
          description: `connected with <strong>${otherUser.firstName} ${otherUser.lastName}</strong>`,
          metadata: {
            targetUser: connection.user,
            connectionId: connection._id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
          },
          visibility: 'connections',
          points: 10
        });

        // Activity for the other user
        await Activity.createActivity({
          user: connection.user,
          type: 'connection_accepted',
          action: `Connected with ${req.user.firstName} ${req.user.lastName}`,
          description: `connected with <strong>${req.user.firstName} ${req.user.lastName}</strong>`,
          metadata: {
            targetUser: userId,
            connectionId: connection._id
          },
          visibility: 'connections',
          points: 10,
          isSystemGenerated: true
        });
      } catch (activityError) {
        console.error('Failed to create connection activity:', activityError);
      }
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

// ===== DYNAMIC ROUTES - MUST BE LAST =====

// Get single alumnus profile
router.get('/:id/profile', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?._id || req.user?.id;
    
    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Alumni not found'
      });
    }

    const profile = await Profile.findOne({ user: id })
      .populate('connections.user', 'firstName lastName email');

    // Track profile view if not viewing own profile - NEW
    if (currentUserId && currentUserId.toString() !== id) {
      try {
        await Activity.createActivity({
          user: currentUserId,
          type: 'profile_view',
          action: `Viewed ${user.firstName} ${user.lastName}'s profile`,
          description: `viewed a profile`,
          metadata: {
            targetUser: id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
          },
          visibility: 'private',
          points: 0
        });
      } catch (activityError) {
        console.error('Failed to create profile view activity:', activityError);
      }
    }

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

// Send connection request
router.post('/:id/connect', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const targetUserId = req.params.id;

    // Update last active when user sends connection request
    await updateLastActive(userId);

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

    // Get target user details for activity
    const targetUser = await User.findById(targetUserId).select('firstName lastName');

    // Add connection request
    targetProfile.connections.push({
      user: userId,
      status: 'pending'
    });

    await targetProfile.save();

    // Create activity for connection request - NEW
    try {
      await Activity.createActivity({
        user: userId,
        type: 'connection_request',
        action: `Sent connection request to ${targetUser.firstName} ${targetUser.lastName}`,
        description: `sent a connection request`,
        metadata: {
          targetUser: targetUserId,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'private',
        points: 5
      });
    } catch (activityError) {
      console.error('Failed to create connection request activity:', activityError);
    }

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

// Remove connection
router.delete('/connections/:userId', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const targetUserId = req.params.userId;

    const profile = await Profile.findOne({ user: userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Remove connection from current user's profile
    profile.connections = profile.connections.filter(
      conn => conn.user.toString() !== targetUserId
    );
    await profile.save();

    // Remove reciprocal connection
    const targetProfile = await Profile.findOne({ user: targetUserId });
    if (targetProfile) {
      targetProfile.connections = targetProfile.connections.filter(
        conn => conn.user.toString() !== userId.toString()
      );
      await targetProfile.save();
    }

    res.json({
      success: true,
      message: 'Connection removed successfully'
    });

  } catch (error) {
    console.error('Remove connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove connection'
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