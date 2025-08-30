const axios = require('axios');
const qs = require('qs');
require('dotenv').config();

// Configuration from environment variables
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_APP_NAME = process.env.GUPSHUP_APP_NAME;
const GUPSHUP_SENDER = process.env.GUPSHUP_SENDER;
const GUPSHUP_TEMPLATE_REMINDER = process.env.GUPSHUP_TEMPLATE_REMINDER;
const GUPSHUP_REMINDER_TEMPLATE_ID = process.env.GUPSHUP_REMINDER_TEMPLATE_ID;

// Test phone number - replace with your number in international format without '+' or '00'
const TEST_PHONE = '919059704960'; // Replace with your number

async function testWhatsAppNotification() {
  try {
    const url = 'https://api.gupshup.io/wa/api/v1/template/msg';
    
    // Prepare the form data
    const formData = {
      channel: 'whatsapp',
      source: GUPSHUP_SENDER,
      destination: TEST_PHONE,
      'src.name': GUPSHUP_APP_NAME,
      template: JSON.stringify({
        name: GUPSHUP_TEMPLATE_REMINDER,
        language: {
          code: 'en',
          policy: 'deterministic'
        },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Test User' },
              { type: 'text', text: 'Test Task' },
              { type: 'text', text: new Date().toLocaleDateString() },
              { type: 'text', text: new Date().toLocaleTimeString() }
            ]
          }
        ]
      })
    };

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'apikey': GUPSHUP_API_KEY,
      'Cache-Control': 'no-cache'
    };

    console.log('Sending test WhatsApp message...');
    console.log('To:', TEST_PHONE);
    console.log('Using template:', GUPSHUP_TEMPLATE_REMINDER);
    
    // Convert the form data to URL-encoded format
    const formDataString = qs.stringify(formData);
    
    const response = await axios.post(url, formDataString, { 
      headers,
      maxRedirects: 0
    });
    
    console.log('\n✅ WhatsApp API Response:');
    console.log('Status:', response.status);
    console.log('Data:', response.data);
    
  } catch (error) {
    console.error('\n❌ Error sending WhatsApp message:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

// Install the required package if not already installed
try {
  require('qs');
} catch (e) {
  console.log('Installing required package: qs');
  const { execSync } = require('child_process');
  execSync('npm install qs', { stdio: 'inherit' });
}

// Run the test
testWhatsAppNotification();
