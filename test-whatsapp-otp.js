require('dotenv').config();
const axios = require('axios');
const qs = require('qs');

async function testWhatsAppOTP() {
    const phoneNumber = '919008682703'; // Your phone number with country code (without +)
    const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP

    console.log('Testing WhatsApp OTP with the following details:');
    console.log('Phone:', phoneNumber);
    console.log('OTP:', otp);
    console.log('Gupshup API Key:', process.env.GUPSHUP_API_KEY ? '*****' + process.env.GUPSHUP_API_KEY.slice(-4) : 'Not set');
    console.log('Gupshup Sender:', process.env.GUPSHUP_SENDER);
    console.log('Environment:', process.env.NODE_ENV || 'development');

    const payload = qs.stringify({
        channel: 'whatsapp',
        source: process.env.GUPSHUP_SENDER || '917834811114',
        destination: phoneNumber,
        'src.name': 'Planello',
        template: JSON.stringify({
            name: 'otp',
            language: {
                code: 'en',
                policy: 'deterministic'
            },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: otp.toString() },
                        { type: 'text', text: '10' } // 10 minutes
                    ]
                }
            ]
        })
    });

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': process.env.GUPSHUP_API_KEY || 'g0jg9oesw9xoujqjdjduj3hx6ijfifhy',
        'Cache-Control': 'no-cache'
    };

    console.log('\nSending request to Gupshup API...');
    
    try {
        const response = await axios.post(
            'https://api.gupshup.io/wa/api/v1/template/msg',
            payload,
            { 
                headers,
                timeout: 10000
            }
        );
        
        console.log('\n✅ Success! Response from Gupshup:');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('\nIf you don\'t receive the OTP, check:');
        console.log('1. Is the phone number in international format (e.g., 91XXXXXXXXXX)?');
        console.log('2. Is the Gupshup account properly set up with a WhatsApp Business API?');
        console.log('3. Check Gupshup dashboard for message delivery status');
        
    } catch (error) {
        console.error('\n❌ Error sending WhatsApp OTP:');
        console.error('Error Message:', error.message);
        
        if (error.response) {
            console.error('Status Code:', error.response.status);
            console.error('Response Data:', error.response.data);
        } else if (error.request) {
            console.error('No response received from Gupshup API');
            console.error('Request:', error.request);
        }
        
        console.log('\nTroubleshooting steps:');
        console.log('1. Check your internet connection');
        console.log('2. Verify Gupshup API key and sender ID in .env file');
        console.log('3. Ensure your Gupshup account has sufficient balance/credits');
        console.log('4. Check if the template is approved in Gupshup dashboard');
    }
}

testWhatsAppOTP();
