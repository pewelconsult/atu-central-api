// migrations/createMissingProfiles.js
// Run this script to create profiles for existing users who don't have them

const mongoose = require('mongoose');
const User = require('../models/User');
const Profile = require('../models/Profile');
require('dotenv').config();

async function createMissingProfiles() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all users
    const users = await User.find({});
    console.log(`Found ${users.length} users`);

    let profilesCreated = 0;
    let profilesExisting = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Check if profile exists
        const existingProfile = await Profile.findOne({ user: user._id });
        
        if (existingProfile) {
          profilesExisting++;
          console.log(`✓ Profile exists for ${user.email}`);
        } else {
          // Create new profile
          const profile = new Profile({
            user: user._id,
            // Try to extract phone from user object if it exists
            phone: user.phoneNumber || user.phone || null,
            // Try to extract graduation year and program if they exist on user
            graduationYear: user.graduationYear || null,
            program: user.program || null,
            // Initialize other fields
            bio: '',
            skills: [],
            interests: [],
            location: '',
            currentPosition: '',
            currentCompany: '',
            linkedinUrl: '',
            githubUrl: '',
            portfolioUrl: '',
            achievements: [],
            socialLinks: {
              twitter: '',
              facebook: '',
              instagram: ''
            }
          });

          await profile.save();
          profilesCreated++;
          console.log(`✅ Created profile for ${user.email}`);

          // Update user's profile reference if the field exists
          if ('profile' in user.schema.paths) {
            user.profile = profile._id;
            await user.save();
          }
        }
      } catch (error) {
        errors++;
        console.error(`❌ Error processing user ${user.email}:`, error.message);
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total users: ${users.length}`);
    console.log(`Profiles already existing: ${profilesExisting}`);
    console.log(`Profiles created: ${profilesCreated}`);
    console.log(`Errors: ${errors}`);

    // Verify the results
    const totalProfiles = await Profile.countDocuments();
    console.log(`\nTotal profiles in database: ${totalProfiles}`);

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  }
}

// Run the migration
createMissingProfiles();