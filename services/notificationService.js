// services/notificationService.js
const Notification = require('../models/Notification');
const emailService = require('./emailService');

class NotificationService {
  
  // Create a connection request notification
  async createConnectionRequest(senderId, recipientId, senderName) {
    try {
      const notification = await Notification.createNotification({
        recipient: recipientId,
        sender: senderId,
        type: 'connection_request',
        title: 'New Connection Request',
        message: `${senderName} wants to connect with you`,
        data: { senderId },
        priority: 'medium'
      });

      // Send email notification if user has email notifications enabled
      const User = require('../models/User');
      const recipient = await User.findById(recipientId);
      const sender = await User.findById(senderId);
      
      if (recipient.preferences?.emailNotifications) {
        emailService.sendConnectionRequestNotification(recipient, sender)
          .catch(err => console.log('Connection request email failed:', err.message));
      }

      return notification;
    } catch (error) {
      console.error('Create connection request notification error:', error);
      throw error;
    }
  }

  // Create connection accepted notification
  async createConnectionAccepted(senderId, recipientId, senderName) {
    try {
      return await Notification.createNotification({
        recipient: recipientId,
        sender: senderId,
        type: 'connection_accepted',
        title: 'Connection Accepted',
        message: `${senderName} accepted your connection request`,
        data: { senderId },
        priority: 'medium'
      });
    } catch (error) {
      console.error('Create connection accepted notification error:', error);
      throw error;
    }
  }

  // Create event reminder notification
  async createEventReminder(eventId, eventTitle, attendeeIds, reminderType = 'upcoming') {
    try {
      const title = reminderType === 'today' ? 'Event Today!' : 
                   reminderType === 'tomorrow' ? 'Event Tomorrow!' : 
                   'Upcoming Event Reminder';
      
      const message = reminderType === 'today' ? `${eventTitle} is happening today!` :
                     reminderType === 'tomorrow' ? `${eventTitle} is tomorrow!` :
                     `Don't forget about ${eventTitle}`;

      const priority = reminderType === 'today' ? 'high' : 
                      reminderType === 'tomorrow' ? 'medium' : 'low';

      return await Notification.createBulkNotifications(attendeeIds, {
        type: 'event_reminder',
        title,
        message,
        data: { eventId, eventTitle, reminderType },
        priority
      });
    } catch (error) {
      console.error('Create event reminder notification error:', error);
      throw error;
    }
  }

  // Create job application notification
  async createJobApplication(jobId, jobTitle, applicantId, applicantName, jobPosterId) {
    try {
      const notification = await Notification.createNotification({
        recipient: jobPosterId,
        sender: applicantId,
        type: 'job_application',
        title: 'New Job Application',
        message: `${applicantName} applied for ${jobTitle}`,
        data: { jobId, jobTitle, applicantId },
        priority: 'medium'
      });

      // Send email notification
      const User = require('../models/User');
      const jobPoster = await User.findById(jobPosterId);
      const applicant = await User.findById(applicantId);
      const Job = require('../models/Job');
      const job = await Job.findById(jobId);
      
      if (jobPoster.preferences?.emailNotifications) {
        emailService.sendJobApplicationNotification(jobPoster, job, applicant)
          .catch(err => console.log('Job application email failed:', err.message));
      }

      return notification;
    } catch (error) {
      console.error('Create job application notification error:', error);
      throw error;
    }
  }

  // Create job status update notification
  async createJobStatusUpdate(jobId, jobTitle, applicantId, status, companyName) {
    try {
      const statusMessages = {
        'under_review': 'Your application is now under review',
        'interview': 'Congratulations! You\'ve been invited for an interview',
        'accepted': 'Congratulations! Your application has been accepted',
        'rejected': 'Your application status has been updated'
      };

      const priority = status === 'accepted' || status === 'interview' ? 'high' : 'medium';

      const notification = await Notification.createNotification({
        recipient: applicantId,
        type: 'job_status_update',
        title: 'Job Application Update',
        message: `${companyName}: ${statusMessages[status]}`,
        data: { jobId, jobTitle, status, companyName },
        priority
      });

      // Send email notification
      const User = require('../models/User');
      const applicant = await User.findById(applicantId);
      const Job = require('../models/Job');
      const job = await Job.findById(jobId);
      
      if (applicant.preferences?.emailNotifications) {
        emailService.sendJobApplicationStatusUpdate(applicant, job, status)
          .catch(err => console.log('Job status email failed:', err.message));
      }

      return notification;
    } catch (error) {
      console.error('Create job status update notification error:', error);
      throw error;
    }
  }

  // Create survey invitation notification
  async createSurveyInvitation(surveyId, surveyTitle, recipientIds) {
    try {
      const notifications = await Notification.createBulkNotifications(recipientIds, {
        type: 'survey_invitation',
        title: 'New Survey Available',
        message: `You've been invited to participate in: ${surveyTitle}`,
        data: { surveyId, surveyTitle },
        priority: 'low'
      });

      // Send email invitations
      const User = require('../models/User');
      const Survey = require('../models/Survey');
      const recipients = await User.find({ 
        _id: { $in: recipientIds },
        'preferences.emailNotifications': true 
      });
      const survey = await Survey.findById(surveyId);
      
      recipients.forEach(user => {
        emailService.sendSurveyInvitation(user, survey)
          .catch(err => console.log('Survey invitation email failed:', err.message));
      });

      return notifications;
    } catch (error) {
      console.error('Create survey invitation notification error:', error);
      throw error;
    }
  }

  // Create event RSVP notification
  async createEventRSVP(eventId, eventTitle, attendeeId, attendeeName, organizerId) {
    try {
      return await Notification.createNotification({
        recipient: organizerId,
        sender: attendeeId,
        type: 'event_rsvp',
        title: 'New Event RSVP',
        message: `${attendeeName} has RSVP'd to ${eventTitle}`,
        data: { eventId, eventTitle, attendeeId },
        priority: 'low'
      });
    } catch (error) {
      console.error('Create event RSVP notification error:', error);
      throw error;
    }
  }

  // Create profile view notification
  async createProfileView(viewerId, viewerName, profileOwnerId) {
    try {
      return await Notification.createNotification({
        recipient: profileOwnerId,
        sender: viewerId,
        type: 'profile_view',
        title: 'Profile View',
        message: `${viewerName} viewed your profile`,
        data: { viewerId },
        priority: 'low'
      });
    } catch (error) {
      console.error('Create profile view notification error:', error);
      throw error;
    }
  }

  // Create system notification
  async createSystemNotification(recipientIds, title, message, data = {}, priority = 'medium') {
    try {
      if (Array.isArray(recipientIds)) {
        return await Notification.createBulkNotifications(recipientIds, {
          type: 'system',
          title,
          message,
          data,
          priority
        });
      } else {
        return await Notification.createNotification({
          recipient: recipientIds,
          type: 'system',
          title,
          message,
          data,
          priority
        });
      }
    } catch (error) {
      console.error('Create system notification error:', error);
      throw error;
    }
  }

  // Create admin message notification
  async createAdminMessage(recipientIds, title, message, senderId = null) {
    try {
      const notificationData = {
        type: 'admin_message',
        title,
        message,
        priority: 'high'
      };

      if (senderId) {
        notificationData.sender = senderId;
      }

      if (Array.isArray(recipientIds)) {
        return await Notification.createBulkNotifications(recipientIds, notificationData);
      } else {
        return await Notification.createNotification({
          recipient: recipientIds,
          ...notificationData
        });
      }
    } catch (error) {
      console.error('Create admin message notification error:', error);
      throw error;
    }
  }

  // Create new job posting notification for relevant alumni
  async createNewJobPosting(jobId, jobTitle, company, skills = [], location = '') {
    try {
      // Find alumni who might be interested based on skills or location
      const User = require('../models/User');
      const Profile = require('../models/Profile');
      
      const query = {
        profileVisibility: { $ne: 'private' },
        openToOpportunities: true
      };

      if (skills.length > 0) {
        query.skills = { $in: skills };
      }

      if (location) {
        query.location = new RegExp(location, 'i');
      }

      const interestedProfiles = await Profile.find(query)
        .select('user')
        .limit(100); // Limit to avoid too many notifications

      const recipientIds = interestedProfiles.map(profile => profile.user);

      if (recipientIds.length > 0) {
        return await Notification.createBulkNotifications(recipientIds, {
          type: 'new_job_posting',
          title: 'New Job Opportunity',
          message: `New ${jobTitle} position at ${company}`,
          data: { jobId, jobTitle, company, skills, location },
          priority: 'medium'
        });
      }

      return [];
    } catch (error) {
      console.error('Create new job posting notification error:', error);
      throw error;
    }
  }

  // Get notification statistics
  async getNotificationStats(userId) {
    try {
      const stats = await Notification.aggregate([
        { $match: { recipient: userId } },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            unreadCount: {
              $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
            }
          }
        }
      ]);

      const totalUnread = await Notification.getUnreadCount(userId);

      return {
        byType: stats,
        totalUnread
      };
    } catch (error) {
      console.error('Get notification stats error:', error);
      throw error;
    }
  }

  // Clean up old notifications (can be run as a cron job)
  async cleanupOldNotifications() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const result = await Notification.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        isRead: true
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old notifications`);
      return result;
    } catch (error) {
      console.error('Cleanup old notifications error:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();