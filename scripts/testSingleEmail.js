// scripts/testSingleEmail.js
require('dotenv').config();
const emailService = require('../services/emailService');

async function testSingleEmail() {
  console.log('📧 Testing single email to kuminewton@gmail.com...');
  console.log(`From: ${process.env.SMTP_USER}\n`);
  
  try {
    // Test welcome email
    const mockUser = {
      firstName: 'Newton',
      lastName: 'Kumi', 
      email: 'kuminewton@gmail.com'
    };
    
    console.log('Sending welcome email...');
    const result = await emailService.sendWelcomeEmail(mockUser);
    
    if (result.success) {
      console.log('✅ Email sent successfully!');
      console.log(`📧 Message ID: ${result.messageId}`);
      console.log('📥 Check kuminewton@gmail.com inbox');
    } else {
      console.log('❌ Email failed:', result.error);
    }
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    console.log('\n🔧 Check your .env file:');
    console.log('SMTP_HOST=smtp.gmail.com');
    console.log('SMTP_PORT=587');
    console.log('SMTP_SECURE=false');
    console.log('SMTP_USER=pewelconsult@gmail.com');
    console.log('SMTP_PASS=your-app-password');
    console.log('SMTP_FROM=pewelconsult@gmail.com');
    console.log('FRONTEND_URL=http://localhost:3000');
  }
}

testSingleEmail();