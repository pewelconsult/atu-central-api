require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Event = require('../models/Event');
const Job = require('../models/Job');

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Profile.deleteMany({});
    await Event.deleteMany({});
    await Job.deleteMany({});
    console.log('Cleared existing data');

    // Create admin user
    const admin = new User({
      email: 'admin@atu.edu.gh',
      password: 'admin123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isVerified: true
    });
    await admin.save();
    console.log('Created admin user');

    // Create sample alumni
    const alumni = [
      {
        email: 'sarah.johnson@gmail.com',
        password: 'password123',
        firstName: 'Sarah',
        lastName: 'Johnson',
        role: 'alumni',
        isVerified: true
      },
      {
        email: 'michael.asante@gmail.com',
        password: 'password123',
        firstName: 'Michael',
        lastName: 'Asante',
        role: 'alumni',
        isVerified: true
      },
      {
        email: 'jennifer.lee@gmail.com',
        password: 'password123',
        firstName: 'Jennifer',
        lastName: 'Lee',
        role: 'alumni',
        isVerified: false
      }
    ];

    const createdAlumni = [];
    for (const alumniData of alumni) {
      const user = new User(alumniData);
      await user.save();
      createdAlumni.push(user);
    }
    console.log('Created alumni users');

    // Create profiles for alumni
    const profiles = [
      {
        user: createdAlumni[0]._id,
        graduationYear: 2022,
        program: 'Computer Science',
        currentPosition: 'Software Engineer',
        currentCompany: 'Google Ghana',
        location: 'Accra, Ghana',
        bio: 'Passionate software engineer with expertise in full-stack development.',
        skills: ['JavaScript', 'Python', 'React', 'Node.js'],
        phone: '+233 24 123 4567',
        linkedIn: 'https://linkedin.com/in/sarahjohnson'
      },
      {
        user: createdAlumni[1]._id,
        graduationYear: 2021,
        program: 'Business Administration',
        currentPosition: 'Product Manager',
        currentCompany: 'MTN Ghana',
        location: 'Kumasi, Ghana',
        bio: 'Product manager with a focus on mobile financial services.',
        skills: ['Product Management', 'Analytics', 'Agile', 'Leadership'],
        phone: '+233 20 987 6543'
      }
    ];

    for (const profileData of profiles) {
      const profile = new Profile(profileData);
      await profile.save();
    }
    console.log('Created profiles');

    // Create sample events
    const events = [
      {
        title: 'Alumni Networking Night 2024',
        description: 'Join us for an evening of networking with fellow ATU alumni working in tech.',
        eventType: 'Networking',
        startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week from now
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000), // 3 hours later
        location: {
          venue: 'ATU Campus Auditorium',
          address: 'University Avenue, Tema',
          city: 'Tema',
          isOnline: false
        },
        organizer: admin._id,
        status: 'published',
        maxAttendees: 100,
        registrationDeadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      },
      {
        title: 'Career Development Workshop',
        description: 'Learn about resume writing, interview skills, and career advancement strategies.',
        eventType: 'Career Development',
        startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks from now
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000), // 4 hours later
        location: {
          venue: 'Online Event',
          isOnline: true,
          onlineLink: 'https://zoom.us/j/123456789'
        },
        organizer: admin._id,
        status: 'published',
        maxAttendees: 50
      }
    ];

    for (const eventData of events) {
      const event = new Event(eventData);
      await event.save();
    }
    console.log('Created events');

    // Create sample jobs
    const jobs = [
      {
        title: 'Frontend Developer',
        description: 'We are looking for a skilled Frontend Developer to join our team...',
        company: 'TechStart Ghana',
        employmentType: 'Full-time',
        experienceLevel: 'Mid Level',
        location: {
          city: 'Accra',
          country: 'Ghana',
          isRemote: false
        },
        salaryRange: {
          min: 5000,
          max: 8000,
          currency: 'GHS',
          period: 'monthly'
        },
        requirements: [
          '3+ years of frontend development experience',
          'Proficiency in React.js',
          'Experience with modern CSS frameworks'
        ],
        skills: ['React', 'JavaScript', 'CSS', 'HTML'],
        postedBy: createdAlumni[0]._id,
        status: 'active',
        applicationMethod: 'email',
        applicationEmail: 'jobs@techstart.com.gh'
      },
      {
        title: 'Business Analyst',
        description: 'Join our team as a Business Analyst and help drive business growth...',
        company: 'FinTech Solutions',
        employmentType: 'Full-time',
        experienceLevel: 'Entry Level',
        location: {
          city: 'Kumasi',
          country: 'Ghana',
          isRemote: true
        },
        salaryRange: {
          min: 3500,
          max: 5500,
          currency: 'GHS',
          period: 'monthly'
        },
        requirements: [
          'Bachelor\'s degree in Business or related field',
          'Strong analytical skills',
          'Experience with data analysis tools'
        ],
        skills: ['Excel', 'SQL', 'Data Analysis', 'Business Intelligence'],
        postedBy: createdAlumni[1]._id,
        status: 'active',
        applicationMethod: 'email',
        applicationEmail: 'careers@fintech.com.gh'
      }
    ];

    for (const jobData of jobs) {
      const job = new Job(jobData);
      await job.save();
    }
    console.log('Created jobs');

    console.log('\n✅ Seed data created successfully!');
    console.log('\nTest accounts:');
    console.log('Admin: admin@atu.edu.gh / admin123');
    console.log('Alumni: sarah.johnson@gmail.com / password123');
    console.log('Alumni: michael.asante@gmail.com / password123');
    console.log('Alumni: jennifer.lee@gmail.com / password123 (unverified)');

  } catch (error) {
    console.error('Seed data error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

//seedData();
//console.log("Script file ")