// services/emailService.js - Fixed for Nodemailer v7+ with proper error handling
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initializeTransporter();
  }

  initializeTransporter() {
    try {
      console.log('🔧 Initializing email transporter (Nodemailer v7+)...');
      
      const smtpUser = process.env.SMTP_USER;
      const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpHost = process.env.SMTP_HOST;
      
      console.log(`SMTP_HOST: ${smtpHost ? '✅' : '❌'}`);
      console.log(`SMTP_USER: ${smtpUser ? '✅' : '❌'}`);
      console.log(`SMTP_PASSWORD: ${smtpPassword ? '✅' : '❌'}`);
      
      if (!smtpHost || !smtpUser || !smtpPassword) {
        console.warn('⚠️ Email service not configured. Missing SMTP environment variables.');
        return;
      }

      this.transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: smtpUser,
          pass: smtpPassword
        }
      });

      this.isConfigured = true;
      console.log('✅ Email service configured successfully');
      console.log(`📧 SMTP Host: ${smtpHost}`);
      console.log(`📧 SMTP User: ${smtpUser}`);

      this.verifyConnection();
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
      this.isConfigured = false;
    }
  }

  async verifyConnection() {
    if (!this.transporter) return;

    try {
      await this.transporter.verify();
      console.log('✅ Email server connection verified');
    } catch (error) {
      console.error('❌ Email server connection failed:', error.message);
      
      if (error.message.includes('Service not available')) {
        console.log('💡 Gmail SMTP might be temporarily unavailable. Try again in a few minutes.');
      } else if (error.message.includes('Invalid login')) {
        console.log('💡 Check your Gmail app password. Make sure:');
        console.log('   1. 2FA is enabled on your Gmail account');
        console.log('   2. You generated an app password (not your regular password)');
        console.log('   3. The app password is correctly set in SMTP_PASSWORD');
      }
      
      this.isConfigured = false;
    }
  }

  // FIXED: Main sendEmail method with proper parameter handling
  async sendEmail(options) {
    // Handle both object parameter and individual parameters
    let to, subject, html, text;
    
    if (typeof options === 'object' && !Array.isArray(options)) {
      // Called with object parameter: sendEmail({ to, subject, html, text })
      ({ to, subject, html, text } = options);
    } else {
      // Called with individual parameters: sendEmail(to, subject, html, text)
      // This is for backward compatibility
      to = arguments[0];
      subject = arguments[1];
      html = arguments[2];
      text = arguments[3];
    }

    if (!this.isConfigured) {
      console.warn('Email service not configured, skipping email send');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
      
      // Ensure we have valid content
      if (!html && !text) {
        console.error('❌ Email send error: No content provided (both html and text are empty)');
        return { 
          success: false, 
          error: 'No email content provided'
        };
      }
      
      // Generate text from HTML if text is not provided and html exists
      if (!text && html) {
        text = this.stripHtml(html);
      }
      
      const mailOptions = {
        from: `"ATU Alumni Network" <${fromEmail}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject || 'No Subject',
        html: html || `<p>${text}</p>`, // Fallback to text wrapped in <p> if no HTML
        text: text || this.stripHtml(html) || 'No content'
      };

      console.log(`📧 Sending email to ${to}...`);
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${to}:`, result.messageId);
      
      return { 
        success: true, 
        messageId: result.messageId,
        response: result.response 
      };
    } catch (error) {
      console.error('❌ Email send error:', error);
      return { 
        success: false, 
        error: error.message,
        code: error.code 
      };
    }
  }

  // Welcome email for new users
  async sendWelcomeEmail(user) {
    const subject = 'Welcome to ATU Alumni Network! 🎓';
    const html = this.getWelcomeEmailTemplate(user);
    return this.sendEmail({ to: user.email, subject, html });
  }

  // Email verification
  async sendEmailVerification(user, verificationToken) {
    const subject = 'Verify Your ATU Alumni Account';
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    const html = this.getEmailVerificationTemplate(user, verificationUrl);
    return this.sendEmail({ to: user.email, subject, html });
  }

  // Password reset email
  async sendPasswordResetEmail(user, resetToken) {
    const subject = 'Reset Your ATU Alumni Password';
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const html = this.getPasswordResetTemplate(user, resetUrl);
    return this.sendEmail({ to: user.email, subject, html });
  }

  // Event reminder email
  async sendEventReminder(user, event, reminderType = 'upcoming') {
    let subject, html;

    switch (reminderType) {
      case 'tomorrow':
        subject = `Reminder: ${event.title} - Tomorrow! 📅`;
        html = this.getEventReminderTemplate(user, event, 'tomorrow');
        break;
      case 'today':
        subject = `Today: ${event.title} 🎯`;
        html = this.getEventReminderTemplate(user, event, 'today');
        break;
      case 'registration_confirmed':
        subject = `Registration Confirmed: ${event.title} ✅`;
        html = this.getEventConfirmationTemplate(user, event);
        break;
      default:
        subject = `Upcoming Event: ${event.title}`;
        html = this.getEventReminderTemplate(user, event, 'upcoming');
    }

    return this.sendEmail({ to: user.email, subject, html });
  }

  // Job application notification
  async sendJobApplicationNotification(jobPoster, job, applicant) {
    const subject = `New Application for ${job.title} 💼`;
    const html = this.getJobApplicationNotificationTemplate(jobPoster, job, applicant);
    return this.sendEmail({ to: jobPoster.email, subject, html });
  }

  // Job application status update
  async sendJobApplicationStatusUpdate(applicant, job, status) {
    const subject = `Application Update: ${job.title}`;
    const html = this.getJobApplicationStatusTemplate(applicant, job, status);
    return this.sendEmail({ to: applicant.email, subject, html });
  }

  // Survey invitation
  async sendSurveyInvitation(user, survey) {
    const subject = `Your Input Needed: ${survey.title} 📋`;
    const html = this.getSurveyInvitationTemplate(user, survey);
    return this.sendEmail({ to: user.email, subject, html });
  }

  // Connection request notification
  async sendConnectionRequestNotification(recipient, requester) {
    const subject = `New Connection Request from ${requester.firstName} ${requester.lastName}`;
    const html = this.getConnectionRequestTemplate(recipient, requester);
    return this.sendEmail({ to: recipient.email, subject, html });
  }

  // Monthly newsletter
  async sendMonthlyNewsletter(user, newsletterData) {
    const subject = `ATU Alumni Monthly Update - ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    const html = this.getNewsletterTemplate(user, newsletterData);
    return this.sendEmail({ to: user.email, subject, html });
  }

  // Test email functionality
  async sendTestEmail(to = process.env.SMTP_USER) {
    const subject = 'ATU Alumni API - Email Service Test';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">Email Service Test ✅</h1>
        </div>
        <div style="padding: 30px; background: white;">
          <h2>Email Service Working!</h2>
          <p>This is a test email to verify that the ATU Alumni email service is configured and working correctly.</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
          <p><strong>From:</strong> ${process.env.SMTP_USER}</p>
          <p><strong>SMTP Host:</strong> ${process.env.SMTP_HOST}</p>
          <p><strong>Nodemailer Version:</strong> v7+</p>
          <p>If you received this email, the email service is working properly! 🎉</p>
        </div>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }

  // Email template methods
  getWelcomeEmailTemplate(user) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ATU Alumni</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white;">
          <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 40px 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Welcome to ATU Alumni Network! 🎓</h1>
          </div>
          
          <div style="padding: 40px 30px; background: white;">
            <h2 style="color: #1e3a8a; margin-bottom: 20px;">Hello ${user.firstName}!</h2>
            
            <p style="font-size: 16px; line-height: 1.6; color: #374151; margin-bottom: 20px;">
              Welcome to the ATU Alumni Network! We're absolutely thrilled to have you as part of our growing community of successful graduates.
            </p>
            
            <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #f59e0b;">
              <h3 style="color: #1e3a8a; margin-top: 0; margin-bottom: 15px;">🚀 Get Started Today:</h3>
              <ul style="color: #374151; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Complete your profile to connect with fellow alumni</li>
                <li>Explore upcoming events and networking opportunities</li>
                <li>Check out job postings from alumni companies</li>
                <li>Participate in our career development surveys</li>
                <li>Join professional groups in your field</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/profile" 
                 style="background: linear-gradient(135deg, #1e3a8a, #1e40af); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 12px rgba(30, 58, 138, 0.3);">
                Complete Your Profile 📝
              </a>
            </div>
            
            <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <p style="color: #065f46; margin: 0; font-weight: 500;">
                💡 <strong>Pro Tip:</strong> Alumni with complete profiles receive 3x more connection requests and job opportunities!
              </p>
            </div>
            
            <p style="font-size: 16px; line-height: 1.6; color: #374151;">
              If you have any questions or need assistance, our support team is here to help. Feel free to reach out to us anytime.
            </p>
            
            <p style="font-size: 16px; line-height: 1.6; color: #374151; margin-bottom: 30px;">
              Best regards,<br>
              <strong>The ATU Alumni Team</strong>
            </p>
          </div>
          
          <div style="background: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 14px; color: #6b7280; margin: 0; text-align: center;">
              This email was sent to ${user.email}. If you have any questions, contact us at 
              <a href="mailto:support@atu.edu.gh" style="color: #1e3a8a;">support@atu.edu.gh</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getEmailVerificationTemplate(user, verificationUrl) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify Your Email</h2>
          <p>Hi ${user.firstName},</p>
          <p>Please click the link below to verify your email address:</p>
          <a href="${verificationUrl}" style="display: inline-block; padding: 10px 20px; background: #1e3a8a; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p>If you didn't create an account, please ignore this email.</p>
        </body>
      </html>
    `;
  }

  getPasswordResetTemplate(user, resetUrl) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hi ${user.firstName},</p>
          <p>You requested to reset your password. Click the link below:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background: #1e3a8a; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
          <p>If you didn't request this, please ignore this email.</p>
        </body>
      </html>
    `;
  }

  getEventReminderTemplate(user, event, reminderType) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Event Reminder: ${event.title}</h2>
          <p>Hi ${user.firstName},</p>
          <p>This is a reminder about the upcoming event: ${event.title}</p>
          <p>Date: ${new Date(event.startDate).toLocaleDateString()}</p>
          <p>Location: ${event.location || 'TBA'}</p>
        </body>
      </html>
    `;
  }

  getEventConfirmationTemplate(user, event) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Registration Confirmed!</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your registration for ${event.title} has been confirmed.</p>
          <p>We look forward to seeing you there!</p>
        </body>
      </html>
    `;
  }

  getJobApplicationNotificationTemplate(jobPoster, job, applicant) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Job Application</h2>
          <p>Hi ${jobPoster.firstName},</p>
          <p>You have received a new application for the position: ${job.title}</p>
          <p>Applicant: ${applicant.firstName} ${applicant.lastName}</p>
        </body>
      </html>
    `;
  }

  getJobApplicationStatusTemplate(applicant, job, status) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Application Status Update</h2>
          <p>Hi ${applicant.firstName},</p>
          <p>Your application for ${job.title} has been updated.</p>
          <p>Status: ${status}</p>
        </body>
      </html>
    `;
  }

  getSurveyInvitationTemplate(user, survey) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Survey Invitation</h2>
          <p>Hi ${user.firstName},</p>
          <p>We'd love to hear your thoughts! Please take a moment to complete our survey:</p>
          <h3>${survey.title}</h3>
          <p>${survey.description || ''}</p>
        </body>
      </html>
    `;
  }

  getConnectionRequestTemplate(recipient, requester) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Connection Request</h2>
          <p>Hi ${recipient.firstName},</p>
          <p>${requester.firstName} ${requester.lastName} would like to connect with you on ATU Alumni Network.</p>
        </body>
      </html>
    `;
  }

  getNewsletterTemplate(user, newsletterData) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>ATU Alumni Monthly Newsletter</h2>
          <p>Hi ${user.firstName},</p>
          <p>Here's your monthly update from the ATU Alumni Network.</p>
        </body>
      </html>
    `;
  }

  // FIXED: Utility method with null check
  stripHtml(html) {
    // Handle null, undefined, or non-string values
    if (!html || typeof html !== 'string') {
      return '';
    }
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new EmailService();