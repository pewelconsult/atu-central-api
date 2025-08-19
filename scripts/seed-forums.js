// scripts/seed-forums.js
const mongoose = require('mongoose');
const { Forum, ForumPost } = require('../models/Forum');
const User = require('../models/User');
require('dotenv').config();

async function seedForums() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find an admin user to be the creator
    const adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      console.error('No admin user found. Please create an admin user first.');
      process.exit(1);
    }

    // Create sample forums
    const forums = [
      {
        title: 'General Discussion',
        description: 'General topics and discussions for all alumni',
        category: 'General Discussion',
        visibility: 'public',
        createdBy: adminUser._id,
        moderators: [adminUser._id]
      },
      {
        title: 'Career Development',
        description: 'Share career advice, job opportunities, and professional growth tips',
        category: 'Career Development',
        visibility: 'alumni_only',
        createdBy: adminUser._id,
        moderators: [adminUser._id]
      },
      {
        title: 'Technology & Innovation',
        description: 'Discuss latest tech trends, innovations, and technical challenges',
        category: 'Technology',
        visibility: 'public',
        createdBy: adminUser._id,
        moderators: [adminUser._id]
      },
      {
        title: 'Alumni Stories',
        description: 'Share your journey, achievements, and experiences',
        category: 'Alumni Stories',
        visibility: 'alumni_only',
        createdBy: adminUser._id,
        moderators: [adminUser._id]
      }
    ];

    // Clear existing forums (optional)
    // await Forum.deleteMany({});
    
    // Create forums
    for (const forumData of forums) {
      const existingForum = await Forum.findOne({ title: forumData.title });
      if (!existingForum) {
        await Forum.create(forumData);
        console.log(`Created forum: ${forumData.title}`);
      } else {
        console.log(`Forum already exists: ${forumData.title}`);
      }
    }

    console.log('Forum seeding completed!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding forums:', error);
    process.exit(1);
  }
}

seedForums();