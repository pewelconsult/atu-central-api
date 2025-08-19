// services/smsService.js


class SMSService {
  constructor() {
    this.apiKey = process.env.SMS_API_KEY;
    this.username = 'kuminewton@gmail.com';
    this.senderId = 'ATU Alumni';
    this.baseUrl = 'https://frogapi.wigal.com.gh/api/v3';
    this.isConfigured = false;
    
    this.initialize();
  }

  initialize() {
    if (!this.apiKey) {
      console.warn('⚠️ SMS Service not configured. Missing SMS_API_KEY');
      return;
    }
    
    this.isConfigured = true;
    console.log('✅ SMS Service configured successfully');
    console.log(`📱 SMS Sender ID: ${this.senderId}`);
    
    // Check balance on initialization
    this.checkBalance();
  }

  async checkBalance() {
    if (!this.isConfigured) return null;

    try {
      const response = await fetch(`${this.baseUrl}/balance`, {
        method: 'GET',
        headers: {
          'API-KEY': this.apiKey,
          'USERNAME': this.username
        }
      });

      const data = await response.json();
      
      if (data.status === 'SUCCESS') {
        console.log(`📊 SMS Balance: ${data.data.bundles.SMS} SMS credits remaining`);
        console.log(`💰 Cash Balance: GHS ${data.data.cashbalance}`);
        return data.data;
      } else {
        console.error('Failed to check SMS balance:', data.message);
        return null;
      }
    } catch (error) {
      console.error('SMS balance check error:', error);
      return null;
    }
  }

  async sendSMS(phone, message, msgId = null) {
    if (!this.isConfigured) {
      console.warn('SMS Service not configured, skipping SMS send');
      return { success: false, error: 'SMS service not configured' };
    }

    try {
      // Clean phone number (remove spaces, dashes, etc)
      const cleanPhone = this.cleanPhoneNumber(phone);
      
      if (!this.isValidPhoneNumber(cleanPhone)) {
        return { 
          success: false, 
          error: 'Invalid phone number format' 
        };
      }

      const postData = {
        senderid: this.senderId,
        destinations: [{
          destination: cleanPhone,
          message: message,
          msgid: msgId || `MSG${Date.now()}`,
          smstype: 'text'
        }]
      };

      console.log(`📱 Sending SMS to ${cleanPhone}...`);

      const response = await fetch(`${this.baseUrl}/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-KEY': this.apiKey,
          'USERNAME': this.username
        },
        body: JSON.stringify(postData)
      });

      const data = await response.json();

      if (data.status === 'ACCEPTD' || data.status === 'SUCCESS') {
        console.log(`✅ SMS sent successfully to ${cleanPhone}`);
        return {
          success: true,
          messageId: postData.destinations[0].msgid,
          response: data
        };
      } else {
        console.error('SMS send failed:', data);
        return {
          success: false,
          error: data.message || 'SMS send failed',
          response: data
        };
      }
    } catch (error) {
      console.error('SMS send error:', error);
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  }

  async sendBulkSMS(recipients, message) {
    if (!this.isConfigured) {
      console.warn('SMS Service not configured, skipping bulk SMS');
      return { 
        success: false, 
        error: 'SMS service not configured',
        sent: 0,
        failed: recipients.length 
      };
    }

    const results = {
      sent: 0,
      failed: 0,
      details: []
    };

    try {
      // Prepare all SMS destinations
      const destinations = recipients
        .filter(recipient => recipient.phone)
        .map(recipient => {
          const cleanPhone = this.cleanPhoneNumber(recipient.phone);
          
          // Personalize message
          let personalizedMessage = message
            .replace(/{firstName}/g, recipient.firstName || '')
            .replace(/{lastName}/g, recipient.lastName || '')
            .replace(/{email}/g, recipient.email || '');

          return {
            destination: cleanPhone,
            message: personalizedMessage,
            msgid: `MSG${Date.now()}_${recipient._id}`,
            smstype: 'text',
            recipientId: recipient._id
          };
        })
        .filter(dest => this.isValidPhoneNumber(dest.destination));

      if (destinations.length === 0) {
        return {
          success: false,
          error: 'No valid phone numbers found',
          sent: 0,
          failed: recipients.length
        };
      }

      // Send in batches of 100 (adjust based on API limits)
      const batchSize = 100;
      const batches = [];
      
      for (let i = 0; i < destinations.length; i += batchSize) {
        batches.push(destinations.slice(i, i + batchSize));
      }

      console.log(`📱 Sending SMS to ${destinations.length} recipients in ${batches.length} batches...`);

      // Process each batch
      for (const batch of batches) {
        const postData = {
          senderid: this.senderId,
          destinations: batch.map(({ recipientId, ...dest }) => dest)
        };

        try {
          const response = await fetch(`${this.baseUrl}/sms/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'API-KEY': this.apiKey,
              'USERNAME': this.username
            },
            body: JSON.stringify(postData)
          });

          const data = await response.json();

          if (data.status === 'ACCEPTD' || data.status === 'SUCCESS') {
            results.sent += batch.length;
            batch.forEach(dest => {
              results.details.push({
                recipientId: dest.recipientId,
                phone: dest.destination,
                status: 'sent',
                messageId: dest.msgid
              });
            });
          } else {
            results.failed += batch.length;
            batch.forEach(dest => {
              results.details.push({
                recipientId: dest.recipientId,
                phone: dest.destination,
                status: 'failed',
                error: data.message || 'Send failed'
              });
            });
          }

          // Add delay between batches to avoid rate limiting
          if (batches.length > 1) {
            await this.delay(1000); // 1 second delay
          }

        } catch (error) {
          console.error('Batch send error:', error);
          results.failed += batch.length;
          batch.forEach(dest => {
            results.details.push({
              recipientId: dest.recipientId,
              phone: dest.destination,
              status: 'failed',
              error: error.message
            });
          });
        }
      }

      // Check remaining balance
      await this.checkBalance();

      return {
        success: results.sent > 0,
        sent: results.sent,
        failed: results.failed,
        details: results.details
      };

    } catch (error) {
      console.error('Bulk SMS error:', error);
      return {
        success: false,
        error: error.message,
        sent: 0,
        failed: recipients.length,
        details: []
      };
    }
  }

  // Utility methods
  cleanPhoneNumber(phone) {
    if (!phone) return '';
    
    // Remove all non-numeric characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle Ghana phone numbers
    if (cleaned.startsWith('233')) {
      // Already has country code
      return cleaned;
    } else if (cleaned.startsWith('0')) {
      // Local format, add country code
      return '233' + cleaned.substring(1);
    } else if (cleaned.length === 9) {
      // Missing leading 0, add country code
      return '233' + cleaned;
    }
    
    return cleaned;
  }

  isValidPhoneNumber(phone) {
    if (!phone) return false;
    
    // Ghana phone number validation
    // Should be 12 digits starting with 233
    const phoneRegex = /^233[0-9]{9}$/;
    return phoneRegex.test(phone);
  }

  formatPhoneNumber(phone) {
    if (!phone) return '';
    
    const cleaned = this.cleanPhoneNumber(phone);
    if (cleaned.length === 12 && cleaned.startsWith('233')) {
      // Format as +233 XX XXX XXXX
      return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    }
    
    return phone;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test SMS functionality
  async sendTestSMS(phone = '0542709440') {
    const testMessage = `Test SMS from ATU Alumni Network. Time: ${new Date().toLocaleString()}`;
    return this.sendSMS(phone, testMessage);
  }
}

module.exports = new SMSService();