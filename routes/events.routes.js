// routes/events.routes.js - USER OPERATIONS ONLY

const express = require('express');
const Event = require('../models/Event');
const Activity = require('../models/Activity');
const { auth, optionalAuth } = require('../middleware/auth');
const { validateEvent, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');
const { isOwnerOrAdmin } = require('../utils/authHelpers'); // New helper

const router = express.Router();

// Get all published events (public)
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      eventType,
      upcoming = true,
      search
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status: 'published' }; // Only show published events to users

    if (eventType) query.eventType = eventType;
    if (upcoming === 'true') query.startDate = { $gte: new Date() };
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const cacheKey = `events:public:${JSON.stringify({ page, limit, eventType, upcoming, search })}`;
    let cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const events = await Event.find(query)
      .populate('organizer', 'firstName lastName')
      .sort({ startDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Event.countDocuments(query);

    const result = {
      success: true,
      data: {
        events,
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
    console.error('Get events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events'
    });
  }
});

// Get single event
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'firstName lastName email')
      .populate('attendees.user', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if current user is registered
    let userRegistration = null;
    if (req.user) {
      userRegistration = event.attendees.find(
        a => a.user._id.toString() === (req.user._id || req.user.id).toString()
      );
    }

    res.json({
      success: true,
      data: {
        event,
        userRegistration,
        isOrganizer: req.user && event.organizer._id.toString() === (req.user._id || req.user.id).toString()
      }
    });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event'
    });
  }
});

// Create new event (any authenticated user)
router.post('/', [auth, validateEvent], async (req, res) => {
  try {
    const eventData = {
      ...req.body,
      organizer: req.user._id || req.user.id,
      status: 'draft' // New events start as draft
    };

    const event = new Event(eventData);
    await event.save();

    // Create activity for event creation
    try {
      await Activity.createActivity({
        user: req.user._id || req.user.id,
        type: 'event_created',
        action: `Created event: ${event.title}`,
        description: `created a new event <strong>${event.title}</strong>`,
        metadata: {
          targetEvent: event._id,
          eventType: event.eventType,
          startDate: event.startDate,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'public',
        points: 20
      });
    } catch (activityError) {
      console.error('Failed to create event activity:', activityError);
    }

    // Clear events cache
    await cache.flush();

    res.status(201).json({
      success: true,
      message: 'Event created successfully. It will be visible after admin approval.',
      data: event
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create event'
    });
  }
});

// Update own event
router.put('/:id', [auth, validateEvent], async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user is organizer
    if (event.organizer.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own events'
      });
    }

    // Users can't change certain fields
    const { status, approvedAt, approvedBy, ...updateData } = req.body;

    Object.assign(event, updateData);
    await event.save();

    // Clear cache
    await cache.flush();

    res.json({
      success: true,
      message: 'Event updated successfully',
      data: event
    });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event'
    });
  }
});

// Delete own event
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user is organizer
    if (event.organizer.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own events'
      });
    }

    // Can't delete if event has attendees
    if (event.attendees.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete event with registered attendees'
      });
    }

    await event.deleteOne();

    // Clear cache
    await cache.flush();

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event'
    });
  }
});

// RSVP to event
router.post('/:id/rsvp', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status !== 'published') {
      return res.status(400).json({
        success: false,
        message: 'Event is not available for registration'
      });
    }

    // Check if already registered
    const existingRSVP = event.attendees.find(
      a => a.user.toString() === userId.toString()
    );

    if (existingRSVP) {
      return res.status(400).json({
        success: false,
        message: 'Already registered for this event'
      });
    }

    // Check capacity
    if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
      return res.status(400).json({
        success: false,
        message: 'Event is full'
      });
    }

    // Check registration deadline
    if (event.registrationDeadline && new Date() > event.registrationDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Registration deadline has passed'
      });
    }

    event.attendees.push({ user: userId });
    await event.save();

    // Create activity for event registration
    try {
      await Activity.createActivity({
        user: userId,
        type: 'event_registration',
        action: `Registered for ${event.title}`,
        description: `registered for <strong>${event.title}</strong>`,
        metadata: {
          targetEvent: event._id,
          eventType: event.eventType,
          eventDate: event.startDate,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'public',
        points: 15
      });
    } catch (activityError) {
      console.error('Failed to create RSVP activity:', activityError);
    }

    res.json({
      success: true,
      message: 'Successfully registered for event',
      data: { event }
    });

  } catch (error) {
    console.error('RSVP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register for event'
    });
  }
});

// Cancel RSVP
router.delete('/:id/rsvp', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const attendeeIndex = event.attendees.findIndex(
      a => a.user.toString() === userId.toString()
    );

    if (attendeeIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'Not registered for this event'
      });
    }

    event.attendees.splice(attendeeIndex, 1);
    await event.save();

    res.json({
      success: true,
      message: 'Successfully cancelled registration'
    });

  } catch (error) {
    console.error('Cancel RSVP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel registration'
    });
  }
});

// Get user's events (organized or attending)
router.get('/me/events', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { type = 'all' } = req.query;

    let query = {};
    
    if (type === 'organized') {
      query.organizer = userId;
    } else if (type === 'attending') {
      query['attendees.user'] = userId;
    } else {
      query.$or = [
        { organizer: userId },
        { 'attendees.user': userId }
      ];
    }

    const events = await Event.find(query)
      .populate('organizer', 'firstName lastName')
      .sort({ startDate: 1 });

    res.json({
      success: true,
      data: events
    });

  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your events'
    });
  }
});

// Mark attendance (for event organizers only)
router.post('/:id/attendance/:userId', auth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user is organizer
    if (event.organizer.toString() !== (req.user._id || req.user.id).toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only event organizers can mark attendance'
      });
    }

    // Find attendee
    const attendee = event.attendees.find(
      a => a.user.toString() === req.params.userId
    );

    if (!attendee) {
      return res.status(404).json({
        success: false,
        message: 'User is not registered for this event'
      });
    }

    // Update attendance
    attendee.status = 'attended';
    attendee.checkInTime = new Date();
    await event.save();

    // Create activity for event attendance
    try {
      await Activity.createActivity({
        user: req.params.userId,
        type: 'event_attendance',
        action: `Attended ${event.title}`,
        description: `attended <strong>${event.title}</strong>`,
        metadata: {
          targetEvent: event._id,
          markedBy: req.user._id
        },
        visibility: 'public',
        points: 25
      });
    } catch (activityError) {
      console.error('Failed to create attendance activity:', activityError);
    }

    res.json({
      success: true,
      message: 'Attendance marked successfully'
    });

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark attendance'
    });
  }
});

module.exports = router;