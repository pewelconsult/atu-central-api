// fix-survey-index.js
const mongoose = require('mongoose');
require('dotenv').config();

async function fixSurveyIndex() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database');
    console.log('Connected to MongoDB');

    // Get the collection
    const db = mongoose.connection.db;
    const collection = db.collection('surveyresponses');

    // List existing indexes
    console.log('Current indexes:');
    const indexes = await collection.indexes();
    console.log(indexes);

    // Drop the problematic index
    try {
      await collection.dropIndex({ survey: 1, respondent: 1 });
      console.log('Dropped old unique index');
    } catch (error) {
      console.log('Index might not exist or already dropped:', error.message);
    }

    // Create the new partial unique index
    await collection.createIndex(
      { survey: 1, respondent: 1 },
      { 
        unique: true,
        partialFilterExpression: { respondent: { $ne: null } }
      }
    );
    console.log('Created new partial unique index');

    // Verify the new indexes
    console.log('\nNew indexes:');
    const newIndexes = await collection.indexes();
    console.log(newIndexes);

    console.log('\nIndex fix completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing index:', error);
    process.exit(1);
  }
}

fixSurveyIndex();