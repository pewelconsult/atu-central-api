// scripts/fixConnections.js
const mongoose = require('mongoose');
const Profile = require('../models/Profile');
const User = require('../models/User');
require('dotenv').config();

async function fixConnections() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all profiles
    const profiles = await Profile.find({});
    console.log(`Found ${profiles.length} profiles to check`);

    let fixedCount = 0;
    let removedCount = 0;

    for (const profile of profiles) {
      let modified = false;
      const validConnections = [];

      for (const conn of profile.connections) {
        try {
          // Check if user ID is valid
          let userId = conn.user;
          
          // Convert string to ObjectId if needed
          if (typeof userId === 'string') {
            userId = mongoose.Types.ObjectId(userId);
            conn.user = userId;
            modified = true;
            fixedCount++;
          }

          // Check if user exists
          const userExists = await User.findById(userId);
          if (userExists) {
            validConnections.push(conn);
          } else {
            console.log(`Removing connection to deleted user: ${userId}`);
            removedCount++;
            modified = true;
          }
        } catch (error) {
          console.log(`Invalid connection found and removed: ${conn.user}`);
          removedCount++;
          modified = true;
        }
      }

      if (modified) {
        profile.connections = validConnections;
        await profile.save();
        console.log(`Updated profile for user ${profile.user}`);
      }
    }

    console.log(`\nFixed ${fixedCount} string user IDs`);
    console.log(`Removed ${removedCount} invalid connections`);
    console.log('Connection cleanup completed!');

  } catch (error) {
    console.error('Error fixing connections:', error);
  } finally {
    await mongoose.connection.close();
  }
}

// Run the fix
fixConnections();