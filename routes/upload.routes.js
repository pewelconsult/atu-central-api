// routes/upload.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { auth } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');
const Profile = require('../models/Profile');

const router = express.Router();

// Create upload directories if they don't exist
const createUploadDirs = async () => {
  const dirs = ['uploads/profiles', 'uploads/resumes', 'uploads/events', 'uploads/misc'];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
    }
  }
};

// Initialize upload directories
createUploadDirs();

// Helper function to delete old file
const deleteOldFile = async (filePath) => {
  if (filePath) {
    try {
      await fs.unlink(path.join(process.cwd(), filePath));
      console.log(`🗑️ Deleted old file: ${filePath}`);
    } catch (error) {
      console.log(`⚠️ Could not delete old file: ${filePath}`);
    }
  }
};

// Upload profile picture
router.post('/profile-picture', [
  auth,
  uploadLimiter,
  upload.single('profileImage'),
  handleUploadError
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No profile image uploaded'
      });
    }

    const userId = req.user._id || req.user.id;
    const relativePath = `uploads/profiles/${req.file.filename}`;
    const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath}`;

    // Get current profile to delete old image
    let profile = await Profile.findOne({ user: userId });
    const oldImagePath = profile?.profilePicture;

    if (!profile) {
      profile = new Profile({ user: userId });
    }

    // Update profile with new image
    profile.profilePicture = fileUrl;
    profile.profilePicturePath = relativePath;
    await profile.save();

    // Delete old profile picture
    if (oldImagePath && oldImagePath !== fileUrl) {
      const oldPath = oldImagePath.replace(`${req.protocol}://${req.get('host')}/`, '');
      await deleteOldFile(oldPath);
    }

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        profilePicture: fileUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Profile picture upload error:', error);
    
    // Delete uploaded file if there was an error
    if (req.file) {
      await deleteOldFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture'
    });
  }
});

// Upload resume
router.post('/resume', [
  auth,
  uploadLimiter,
  upload.single('resume'),
  handleUploadError
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No resume file uploaded'
      });
    }

    const userId = req.user._id || req.user.id;
    const relativePath = `uploads/resumes/${req.file.filename}`;
    const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath}`;

    // Get current profile to delete old resume
    let profile = await Profile.findOne({ user: userId });
    const oldResumePath = profile?.resumeUrl;

    if (!profile) {
      profile = new Profile({ user: userId });
    }

    // Update profile with new resume
    profile.resumeUrl = fileUrl;
    profile.resumePath = relativePath;
    profile.resumeFilename = req.file.originalname;
    profile.resumeUploadedAt = new Date();
    await profile.save();

    // Delete old resume
    if (oldResumePath && oldResumePath !== fileUrl) {
      const oldPath = oldResumePath.replace(`${req.protocol}://${req.get('host')}/`, '');
      await deleteOldFile(oldPath);
    }

    res.json({
      success: true,
      message: 'Resume uploaded successfully',
      data: {
        resumeUrl: fileUrl,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: profile.resumeUploadedAt
      }
    });

  } catch (error) {
    console.error('Resume upload error:', error);
    
    // Delete uploaded file if there was an error
    if (req.file) {
      await deleteOldFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload resume'
    });
  }
});

// Upload event image
router.post('/event-image', [
  auth,
  uploadLimiter,
  upload.single('eventImage'),
  handleUploadError
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No event image uploaded'
      });
    }

    const relativePath = `uploads/events/${req.file.filename}`;
    const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath}`;

    res.json({
      success: true,
      message: 'Event image uploaded successfully',
      data: {
        imageUrl: fileUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Event image upload error:', error);
    
    // Delete uploaded file if there was an error
    if (req.file) {
      await deleteOldFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload event image'
    });
  }
});

// Upload multiple files (general purpose)
router.post('/multiple', [
  auth,
  uploadLimiter,
  upload.array('files', 5), // Max 5 files
  handleUploadError
], async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const uploadedFiles = req.files.map(file => {
      const relativePath = `uploads/misc/${file.filename}`;
      const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath}`;
      
      return {
        originalName: file.originalname,
        filename: file.filename,
        url: fileUrl,
        size: file.size,
        mimetype: file.mimetype
      };
    });

    res.json({
      success: true,
      message: `${req.files.length} files uploaded successfully`,
      data: {
        files: uploadedFiles,
        count: req.files.length
      }
    });

  } catch (error) {
    console.error('Multiple files upload error:', error);
    
    // Delete uploaded files if there was an error
    if (req.files) {
      for (const file of req.files) {
        await deleteOldFile(file.path);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload files'
    });
  }
});

// Delete uploaded file
router.delete('/file', auth, async (req, res) => {
  try {
    const { fileUrl, type } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'File URL is required'
      });
    }

    const userId = req.user._id || req.user.id;
    
    // Extract file path from URL
    const filePath = fileUrl.replace(`${req.protocol}://${req.get('host')}/`, '');
    
    // Update profile based on file type
    if (type === 'profilePicture') {
      await Profile.findOneAndUpdate(
        { user: userId },
        { 
          $unset: { 
            profilePicture: '', 
            profilePicturePath: '' 
          } 
        }
      );
    } else if (type === 'resume') {
      await Profile.findOneAndUpdate(
        { user: userId },
        { 
          $unset: { 
            resumeUrl: '', 
            resumePath: '', 
            resumeFilename: '',
            resumeUploadedAt: ''
          } 
        }
      );
    }

    // Delete the actual file
    await deleteOldFile(filePath);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
});

// Get user's uploaded files
router.get('/my-files', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    const profile = await Profile.findOne({ user: userId });
    
    const files = {
      profilePicture: profile?.profilePicture || null,
      resume: profile?.resumeUrl ? {
        url: profile.resumeUrl,
        filename: profile.resumeFilename,
        uploadedAt: profile.resumeUploadedAt
      } : null
    };

    res.json({
      success: true,
      data: files
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch files'
    });
  }
});

// Serve uploaded files (static file serving)
router.get('/view/:folder/:filename', async (req, res) => {
  try {
    const { folder, filename } = req.params;
    const allowedFolders = ['profiles', 'resumes', 'events', 'misc'];
    
    if (!allowedFolders.includes(folder)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid folder'
      });
    }

    const filePath = path.join(process.cwd(), 'uploads', folder, filename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Serve the file
    res.sendFile(filePath);

  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to serve file'
    });
  }
});

module.exports = router;