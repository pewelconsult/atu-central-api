// backend/seeders/adminSeeder.js
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const adminData = {
      email: 'kumi@gmail.com',
      password: 'admin123', // Will be hashed by the model
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isVerified: true,
      isActive: true
    };
    
    // Check if admin exists
    const existingAdmin = await User.findOne({ email: adminData.email });
    if (existingAdmin) {
      console.log('Admin already exists');
      process.exit(0);
    }
    
    // Create admin
    const admin = new User(adminData);
    await admin.save();
    
    console.log('Admin created successfully:', admin.email);
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();