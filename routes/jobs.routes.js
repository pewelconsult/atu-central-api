const express = require('express');
const Job = require('../models/Job');
const Activity = require('../models/Activity'); // NEW
const { auth, optionalAuth } = require('../middleware/auth');
const { validateJob, validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// Get all jobs with filtering
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      employmentType,
      experienceLevel,
      location,
      salaryMin,
      salaryMax,
      skills,
      status = 'active'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status };

    // Build search query
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }

    if (employmentType) {
      query.employmentType = { $in: Array.isArray(employmentType) ? employmentType : [employmentType] };
    }
    if (experienceLevel) {
      query.experienceLevel = { $in: Array.isArray(experienceLevel) ? experienceLevel : [experienceLevel] };
    }
    if (location) {
      query.$or = [
        { 'location.city': { $regex: location, $options: 'i' } },
        { 'location.country': { $regex: location, $options: 'i' } }
      ];
    }
    if (skills) {
      query.skills = { $in: Array.isArray(skills) ? skills : [skills] };
    }

    // Salary range filter
    if (salaryMin || salaryMax) {
      query['salaryRange.min'] = {};
      if (salaryMin) query['salaryRange.min'].$gte = parseInt(salaryMin);
      if (salaryMax) query['salaryRange.max'] = { $lte: parseInt(salaryMax) };
    }

    const cacheKey = `jobs:${JSON.stringify({ page, limit, search, employmentType, experienceLevel, location, salaryMin, salaryMax, skills, status })}`;
    let cachedResult = await cache.get(cacheKey);
    
    if (cachedResult) {
      return res.json(cachedResult);
    }

    const jobs = await Job.find(query)
      .populate('postedBy', 'firstName lastName email')
      .select('-applications') // Don't include applications in list view
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Job.countDocuments(query);

    const result = {
      success: true,
      data: {
        jobs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    };

    // Cache for 10 minutes
    await cache.set(cacheKey, result, 600);
    res.json(result);

  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs'
    });
  }
});

// Get single job
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('postedBy', 'firstName lastName email')
      .populate('applications.applicant', 'firstName lastName email');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Increment view count
    job.views += 1;
    await job.save();

    // Check if current user has applied
    let userApplication = null;
    if (req.user) {
      userApplication = job.applications.find(
        app => app.applicant._id.toString() === (req.user._id || req.user.id).toString()
      );
    }

    res.json({
      success: true,
      data: {
        job,
        userApplication
      }
    });

  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job'
    });
  }
});

// Create new job
router.post('/', [auth, validateJob], async (req, res) => {
  try {
    const jobData = {
      ...req.body,
      postedBy: req.user._id || req.user.id
    };

    const job = new Job(jobData);
    await job.save();

    // Create activity for job posting - NEW
    try {
      await Activity.createActivity({
        user: req.user._id || req.user.id,
        type: 'job_posted',
        action: `Posted job: ${job.title}`,
        description: `posted a new job opportunity: <strong>${job.title}</strong> at <strong>${job.company}</strong>`,
        metadata: {
          targetJob: job._id,
          jobTitle: job.title,
          company: job.company,
          employmentType: job.employmentType,
          location: job.location,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'public',
        points: 15
      });
    } catch (activityError) {
      console.error('Failed to create job posting activity:', activityError);
    }

    // Clear jobs cache
    await cache.del('jobs:*');

    res.status(201).json({
      success: true,
      message: 'Job posted successfully',
      data: job
    });

  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create job'
    });
  }
});

// Update job
router.put('/:id', [auth, validateJob], async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this job'
      });
    }

    Object.assign(job, req.body);
    await job.save();

    // Clear cache
    await cache.del('jobs:*');

    res.json({
      success: true,
      message: 'Job updated successfully',
      data: job
    });

  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job'
    });
  }
});

// Apply for job
router.post('/:id/apply', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { coverLetter, resumeUrl } = req.body;
    
    const job = await Job.findById(req.params.id)
      .populate('postedBy', 'firstName lastName');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Job is not available for applications'
      });
    }

    // Check if already applied
    const existingApplication = job.applications.find(
      app => app.applicant.toString() === userId.toString()
    );

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'Already applied for this job'
      });
    }

    // Check application deadline
    if (job.applicationDeadline && new Date() > job.applicationDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Application deadline has passed'
      });
    }

    job.applications.push({
      applicant: userId,
      coverLetter,
      resumeUrl
    });

    await job.save();

    // Create activity for job application - NEW
    try {
      await Activity.createActivity({
        user: userId,
        type: 'job_application',
        action: `Applied to ${job.title} at ${job.company}`,
        description: `applied to <strong>${job.title}</strong> at <strong>${job.company}</strong>`,
        metadata: {
          targetJob: job._id,
          jobTitle: job.title,
          company: job.company,
          jobPosterId: job.postedBy._id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'private', // Private since job applications are sensitive
        points: 20
      });

      // Notify job poster about new application
      if (job.postedBy._id.toString() !== userId.toString()) {
        await Activity.createActivity({
          user: job.postedBy._id,
          type: 'job_application_received',
          action: `New application for ${job.title}`,
          description: `received a new application for <strong>${job.title}</strong>`,
          metadata: {
            targetJob: job._id,
            applicantId: userId,
            applicantName: `${req.user.firstName} ${req.user.lastName}`
          },
          visibility: 'private',
          points: 0,
          isSystemGenerated: true
        });
      }
    } catch (activityError) {
      console.error('Failed to create job application activity:', activityError);
    }

    res.json({
      success: true,
      message: 'Application submitted successfully',
      data: { job }
    });

  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application'
    });
  }
});

// Get user's applications
router.get('/me/applications', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const jobs = await Job.find({
      'applications.applicant': userId
    })
    .populate('postedBy', 'firstName lastName')
    .select('title company location employmentType applications.$'); // Remove the conflicting field selections

    const applications = jobs.map(job => ({
      job: {
        id: job._id,
        title: job.title,
        company: job.company,
        location: job.location,
        employmentType: job.employmentType,
        postedBy: job.postedBy
      },
      application: job.applications[0] // Will only have one due to applications.$
    }));

    res.json({
      success: true,
      data: applications
    });

  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications'
    });
  }
});

// Get jobs posted by current user
router.get('/me/posted', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const jobs = await Job.find({ postedBy: userId })
      .populate('applications.applicant', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: jobs
    });

  } catch (error) {
    console.error('Get posted jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posted jobs'
    });
  }
});

// Update application status (for job posters)
router.put('/:id/applications/:applicationId', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { status } = req.body;
    
    if (!['pending', 'under_review', 'interview', 'rejected', 'accepted'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const job = await Job.findById(req.params.id)
      .populate('applications.applicant', 'firstName lastName email');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update applications'
      });
    }

    const application = job.applications.id(req.params.applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const previousStatus = application.status;
    application.status = status;
    await job.save();

    // Create activity for application status change - NEW
    if (previousStatus !== status) {
      try {
        // Activity for the applicant
        await Activity.createActivity({
          user: application.applicant._id,
          type: 'job_application_status_changed',
          action: `Application status updated for ${job.title}`,
          description: `application for <strong>${job.title}</strong> at <strong>${job.company}</strong> was ${status === 'accepted' ? '<strong>accepted</strong>' : status === 'rejected' ? '<strong>rejected</strong>' : `updated to <strong>${status}</strong>`}`,
          metadata: {
            targetJob: job._id,
            jobTitle: job.title,
            company: job.company,
            previousStatus,
            newStatus: status
          },
          visibility: 'private',
          points: status === 'accepted' ? 50 : 0,
          isSystemGenerated: true
        });
      } catch (activityError) {
        console.error('Failed to create application status activity:', activityError);
      }
    }

    res.json({
      success: true,
      message: 'Application status updated successfully',
      data: {
        applicationId: application._id,
        status: application.status,
        applicant: application.applicant
      }
    });

  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status'
    });
  }
});

// Add this DELETE endpoint to your jobs route file (after the Update job endpoint)

// Delete job
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this job'
      });
    }

    // Store job info for activity before deletion
    const jobTitle = job.title;
    const jobCompany = job.company;

    // Delete the job
    await Job.findByIdAndDelete(req.params.id);

    // Create activity for job deletion
    try {
      await Activity.createActivity({
        user: userId,
        type: 'job_deleted',
        action: `Deleted job: ${jobTitle}`,
        description: `deleted the job posting for <strong>${jobTitle}</strong> at <strong>${jobCompany}</strong>`,
        metadata: {
          deletedJobId: req.params.id,
          jobTitle: jobTitle,
          company: jobCompany,
          deletedBy: req.user.role === 'admin' ? 'admin' : 'poster',
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        },
        visibility: 'private',
        points: 0
      });
    } catch (activityError) {
      console.error('Failed to create job deletion activity:', activityError);
    }

    // Clear cache
    await cache.del('jobs:*');

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });

  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete job'
    });
  }
});

// Update job status (for admins) - Add this if you want to support status updates
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user._id || req.user.id;

    // Validate status
    const validStatuses = ['active', 'pending', 'expired', 'rejected', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if user is job poster or admin
    if (job.postedBy.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update job status'
      });
    }

    const previousStatus = job.status;
    job.status = status;
    await job.save();

    // Create activity for status change
    if (previousStatus !== status) {
      try {
        await Activity.createActivity({
          user: userId,
          type: 'job_status_changed',
          action: `Changed job status to ${status}`,
          description: `changed status of <strong>${job.title}</strong> from ${previousStatus} to <strong>${status}</strong>`,
          metadata: {
            targetJob: job._id,
            jobTitle: job.title,
            company: job.company,
            previousStatus,
            newStatus: status,
            changedBy: req.user.role === 'admin' ? 'admin' : 'poster'
          },
          visibility: 'private',
          points: 0
        });
      } catch (activityError) {
        console.error('Failed to create job status activity:', activityError);
      }
    }

    // Clear cache
    await cache.del('jobs:*');

    res.json({
      success: true,
      message: 'Job status updated successfully',
      data: job
    });

  } catch (error) {
    console.error('Update job status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job status'
    });
  }
});

// Bulk operations for admin
router.post('/bulk', auth, async (req, res) => {
  try {
    const { action, jobIds } = req.body;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    if (!action || !jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data'
      });
    }

    let result;
    const userId = req.user._id || req.user.id;

    switch (action) {
      case 'delete':
        result = await Job.deleteMany({ _id: { $in: jobIds } });
        
        // Create activity for bulk deletion
        try {
          await Activity.createActivity({
            user: userId,
            type: 'jobs_bulk_deleted',
            action: `Deleted ${result.deletedCount} jobs`,
            description: `performed bulk deletion of <strong>${result.deletedCount}</strong> job postings`,
            metadata: {
              deletedJobIds: jobIds,
              deletedCount: result.deletedCount,
              ipAddress: req.ip,
              userAgent: req.get('user-agent')
            },
            visibility: 'admin',
            points: 0,
            isSystemGenerated: true
          });
        } catch (activityError) {
          console.error('Failed to create bulk deletion activity:', activityError);
        }
        break;

      case 'approve':
        result = await Job.updateMany(
          { _id: { $in: jobIds }, status: 'pending' },
          { $set: { status: 'active' } }
        );
        break;

      case 'reject':
        result = await Job.updateMany(
          { _id: { $in: jobIds }, status: 'pending' },
          { $set: { status: 'rejected' } }
        );
        break;

      case 'close':
        result = await Job.updateMany(
          { _id: { $in: jobIds } },
          { $set: { status: 'closed' } }
        );
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    // Clear cache
    await cache.del('jobs:*');

    res.json({
      success: true,
      message: `Bulk ${action} completed successfully`,
      data: {
        modifiedCount: result.modifiedCount || result.deletedCount || 0
      }
    });

  } catch (error) {
    console.error('Bulk operation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk operation'
    });
  }
});

module.exports = router;