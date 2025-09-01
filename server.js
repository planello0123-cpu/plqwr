// Unified server.js for Planello
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
const axios = require('axios');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const qs = require('qs');

// ========================================
// CONFIGURATION MANAGEMENT
// ========================================
const { exec } = require('child_process');

const config = {
    // Server Configuration
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',

    // MongoDB Configuration
    mongoUri: process.env.MONGO_URI,
    mongoOptions: {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    },

    // JWT Configuration
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',

    // Email Configuration (SendGrid)
    sendGrid: {
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@planello.com'
    },

    // SMS Configuration (MSG91)
    msg91: {
        authKey: process.env.MSG91_AUTHKEY,
        senderId: process.env.MSG91_SENDER_ID || 'PLANELO',
        otpTemplateId: process.env.MSG91_OTP_TEMPLATE_ID,
        notificationTemplateId: process.env.MSG91_NOTIFICATION_TEMPLATE_ID,
        countryCode: process.env.MSG91_COUNTRY_CODE || '91',
        route: process.env.MSG91_ROUTE || '4'
    },

    // WhatsApp Configuration (Alternative to SMS)
    whatsapp: {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0'
    },

    // Notification Settings
    notifications: {
        defaultEmail: process.env.DEFAULT_EMAIL_NOTIFICATIONS === 'true',
        defaultSms: process.env.DEFAULT_SMS_NOTIFICATIONS === 'true',
        defaultWhatsapp: process.env.DEFAULT_WHATSAPP_NOTIFICATIONS === 'true',
        defaultPush: process.env.DEFAULT_PUSH_NOTIFICATIONS !== 'false',
        reminderAdvanceTime: parseInt(process.env.REMINDER_ADVANCE_TIME) || 60, // minutes
        urgentReminderTime: parseInt(process.env.URGENT_REMINDER_TIME) || 1 // minutes
    },

    // App Configuration
    app: {
        name: process.env.APP_NAME || 'Planello',
        version: process.env.APP_VERSION || '1.0.0'
    }
};

// Validate required configuration
const validateConfig = () => {
    const required = [
        'sendGrid.apiKey'
        // Removed SMS requirements since we have alternatives
    ];

    const missing = required.filter(key => {
        const value = key.split('.').reduce((obj, k) => obj?.[k], config);
        return !value;
    });

    if (missing.length > 0) {
        console.warn('⚠️  Missing required environment variables:', missing.join(', '));
        console.warn('Please check your .env file and ensure all required variables are set.');
    }

    // Check for at least one OTP method
    const hasEmailOtp = config.sendGrid.apiKey;
    const hasSmsOtp = config.msg91.authKey && config.msg91.otpTemplateId;
    const hasWhatsappOtp = config.whatsapp.accessToken && config.whatsapp.phoneNumberId;

    if (!hasEmailOtp && !hasSmsOtp && !hasWhatsappOtp) {
        console.warn('⚠️  No OTP method configured! Please set up at least one:');
        console.warn('   - Email OTP: SENDGRID_API_KEY');
        console.warn('   - SMS OTP: MSG91_AUTHKEY + MSG91_OTP_TEMPLATE_ID');
        console.warn('   - WhatsApp OTP: WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID');
    }
};

validateConfig();

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS
app.use(cors());

// Serve the dashboard for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'existing-user-dashboard.html'));
});

// Global request logger for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST' || req.method === 'PUT') {
        console.log('Request body:', req.body);
    }
    next();
});

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// JSON parsing middleware is already added above
// app.use(express.json());  // This line is commented out as it's already present above

// =====================
// MODELS
// =====================
const userSchema = new mongoose.Schema({
    email: { type: String, required: false, unique: false },
    phone: { type: String },
    passwordHash: { type: String, required: false }, // Optional for OTP-only users
    name: { type: String },
    isVerified: { type: Boolean, default: false },
    emailOtp: { type: String },
    phoneOtp: { type: String },
    otpExpiry: { type: Date },
    notificationSettings: {
        email: { type: Boolean, default: config.notifications.defaultEmail },
        sms: { type: Boolean, default: config.notifications.defaultSms },
        whatsapp: {
            type: Boolean,
            default: true, // Always enable WhatsApp notifications by default
            required: true
        },
        push: { type: Boolean, default: config.notifications.defaultPush }
    },
    schedule: {
        type: {
            headers: { type: [String], default: [] },
            rows: { type: [Array], default: [] }
        },
        default: () => ({ headers: [], rows: [] })
    },
    createdAt: { type: Date, default: Date.now }
});

// Ensure WhatsApp notifications are enabled for all existing users
userSchema.pre('save', function(next) {
    // If notificationSettings is not set, initialize it
    if (!this.notificationSettings) {
        this.notificationSettings = {};
    }

    // Ensure whatsapp notifications are enabled
    if (this.notificationSettings.whatsapp === undefined) {
        this.notificationSettings.whatsapp = true;
    }

    next();
});

// Compile the User model if it doesn't exist
// Compile the User model if it doesn't exist
const User = mongoose.models.User || mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    category: { type: String, default: 'work' },
    completed: { type: Boolean, default: false },
    dueDate: { type: Date },
    reminderTime: { type: Date },
    reminderSent: { type: Boolean, default: false },
    oneMinuteReminderSent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const Task = mongoose.model('Task', taskSchema);

// =====================
// UTILITY FUNCTIONS
// =====================

/**
 * Validates if a phone number is in the 91XXXXXXXXXX format
 * @param {string} phone - The phone number to validate
 * @returns {boolean} - True if the phone number is valid, false otherwise
 */
function isValidPhoneNumber(phone) {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Check if it's exactly 12 digits starting with 91
    return /^91\d{10}$/.test(digits);
}

function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}
function formatPhoneNumber(phone) {
    // Remove all non-digit characters and leading + if any
    let digits = phone.replace(/\D/g, '');

    // Remove the country code if it exists (91 for India)
    if (digits.startsWith('91') && digits.length > 10) {
        digits = digits.substring(2);
    }

    // Ensure we have exactly 10 digits
    if (digits.length !== 10) {
        throw new Error('Invalid phone number. Must be 10 digits (after removing country code)');
    }

    // Ensure all characters are digits
    if (!/^\d{10}$/.test(digits)) {
        throw new Error('Phone number must contain only digits');
    }

    // Return in +91XXXXXXXXXX format
    return `+91${digits}`;
}

// =====================
// EMAIL SERVICES
// =====================
if (config.sendGrid.apiKey) {
    sgMail.setApiKey(config.sendGrid.apiKey);
}
async function sendEmailOTP(email, otp) {
    if (!config.sendGrid.apiKey) return false;
    const msg = {
        to: email,
        from: config.sendGrid.fromEmail,
        subject: `${config.app.name} - Your Verification Code`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><h2 style="color: #667eea;">${config.app.name} Verification</h2><p>Your verification code is:</p><h1 style="color: #667eea; font-size: 48px; text-align: center; letter-spacing: 8px;">${otp}</h1><p>This code will expire in 10 minutes.</p><p>If you didn't request this code, please ignore this email.</p></div>`
    };
    try {
        await sgMail.send(msg);
        return true;
    } catch (error) {
        console.error('❌ Email OTP error:', error);
        return false;
    }
}

// =====================
// SMS SERVICES (MSG91)
// =====================
async function sendSMSOTP(phone, otp) {
    if (!config.msg91.authKey || !config.msg91.otpTemplateId) return false;
    try {
        const formattedPhone = formatPhoneNumber(phone);
        const response = await axios.get(
            `https://api.msg91.com/api/v5/otp?template_id=${config.msg91.otpTemplateId}&mobile=${formattedPhone}&authkey=${config.msg91.authKey}&otp=${otp}&sender=${config.msg91.senderId}`
        );
        if (response.data && (response.data.type === 'success' || response.data.message === 'OTP sent successfully.')) {
            return true;
        } else {
            console.error('❌ MSG91 API error:', response.data);
            return false;
        }
    } catch (error) {
        console.error('❌ SMS OTP error:', error.response?.data || error.message);
        return false;
    }
}

// =====================
// WHATSAPP SERVICES (Gupshup)
// =====================
async function sendWhatsAppOTP(phone, otp) {
    const payload = qs.stringify({
        channel: 'whatsapp',
        source: process.env.GUPSHUP_SENDER,
        destination: phone.startsWith('91') ? phone : `91${phone}`,
        'src.name': 'Planello',
        template: JSON.stringify({
            id: process.env.GUPSHUP_TEMPLATE_ID,
            params: [otp]
        })
    });
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': process.env.GUPSHUP_API_KEY
    };
    try {
        const response = await axios.post('https://api.gupshup.io/wa/api/v1/template/msg', payload, { headers });
        return response.data && response.data.status === 'submitted';
    } catch (error) {
        console.error('❌ WhatsApp OTP error:', error.response?.data || error.message);
        return false;
    }
}

// WhatsApp Reminder via Gupshup using template messages
/**
 * Sends a WhatsApp reminder to the specified phone number
 * @param {string} phone - The recipient's phone number (with country code, e.g., '91XXXXXXXXXX')
 * @param {string} taskText - The task description
 * @param {string|Date} dueDate - The due date of the task (can be a Date object or ISO string)
 * @returns {Promise<boolean>} - True if the message was sent successfully, false otherwise
 */
async function sendWhatsAppReminder(phone, taskText, dueDate) {
    // Log the incoming parameters for debugging (masking sensitive data)
    console.log('📩 sendWhatsAppReminder called with:', {
        phone: phone ? `${phone.toString().substring(0, 2)}...${phone.toString().substring(phone.toString().length - 2)}` : 'undefined',
        taskText: taskText ? `${taskText.substring(0, 20)}${taskText.length > 20 ? '...' : ''}` : 'undefined',
        dueDate: dueDate ? `[${typeof dueDate}] ${dueDate}` : 'undefined'
    });

    // Log the call stack to see where this was called from
    console.log('📞 Function call stack:', new Error().stack.split('\n').slice(1, 4).join('\n'));

    try {
        // Add validation for required parameters
        if (!phone) {
            console.error('❌ Phone number is required for WhatsApp reminder');
            return false;
        }

        // Set default value for optional parameter
        const safeTaskText = taskText || 'Your task';

        // Format the due date to show only the time
        let safeDueDate = 'Not specified';
        console.log('📅 Raw dueDate:', {
            value: dueDate,
            type: typeof dueDate,
            isDate: dueDate instanceof Date,
            isString: typeof dueDate === 'string',
            isInvalid: dueDate === null || dueDate === undefined || dueDate === ''
        });

        if (dueDate) {
            try {
                const dueDateObj = new Date(dueDate);
                console.log('📆 Parsed dueDate:', {
                    input: dueDate,
                    parsed: dueDateObj.toString(),
                    isValid: !isNaN(dueDateObj.getTime())
                });

                if (!isNaN(dueDateObj.getTime())) {
                    // Format as "HH:MM AM/PM" (time only)
                    safeDueDate = dueDateObj.toLocaleString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                    console.log('✅ Formatted time only:', safeDueDate);
                } else {
                    // If it's already a time string, try to parse it
                    const timeMatch = String(dueDate).match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i);
                    if (timeMatch) {
                        safeDueDate = timeMatch[0];
                        console.log('⏱️ Extracted time from string:', safeDueDate);
                    } else {
                        safeDueDate = String(dueDate);
                        console.log('ℹ️ Using string dueDate as is (could not parse time):', safeDueDate);
                    }
                }
            } catch (dateError) {
                console.warn('⚠️ Error formatting date, using as is', {
                    dueDate,
                    type: typeof dueDate,
                    error: dateError.message,
                    stack: dateError.stack
                });
                safeDueDate = String(dueDate || 'Not specified');
            }
        } else {
            console.log('ℹ️ No dueDate provided, using default');
        }

        // Clean and validate the phone number
        console.log('📞 Raw phone input:', phone, typeof phone);

        // Remove all non-digit characters and leading zeros
        let cleanPhone = String(phone).replace(/\D/g, '').replace(/^0+/, '');
        console.log('🧹 After initial cleaning:', cleanPhone);

        // Ensure phone number has country code (91 for India)
        if (!cleanPhone.startsWith('91')) {
            cleanPhone = '91' + cleanPhone;
            console.log('➕ Added 91 country code:', cleanPhone);
        }

        // Validate phone number format (12 digits with 91 prefix)
        if (cleanPhone.length !== 12) {
            console.error(`❌ Invalid phone number format: ${phone} (cleaned: ${cleanPhone}). Expected 10 digits after adding 91.`);
            return false;
        }

        // Final formatted phone number (with 91 prefix)
        const formattedPhone = cleanPhone;
        console.log('✅ Final formatted phone (with country code):', formattedPhone);

        // Get the template ID and name from environment variables
        const templateId = process.env.GUPSHUP_REMINDER_TEMPLATE_ID;
        const templateName = process.env.GUPSHUP_TEMPLATE_REMINDER;

        if (!templateId || !templateName) {
            console.error('❌ WhatsApp Template ID or Name not configured in environment variables');
            return false;
        }

        // Prepare template parameters as an array in the correct order for Gupshup
        // The order of these parameters must match the template placeholders in Gupshup
        // {{1}} = task text
        // {{2}} = due date
        const templateParams = [
            safeTaskText,   // This will be {{1}} in the template
            safeDueDate     // This will be {{2}} in the template
        ];

        // Log the final template parameters that will be sent to Gupshup
        console.log('📝 Sending WhatsApp with parameters:', {
            to: formattedPhone,
            templateId,
            templateName,
            task: safeTaskText,
            dueDate: safeDueDate
        });

        const payload = qs.stringify({
            channel: 'whatsapp',
            source: process.env.GUPSHUP_SENDER,
            destination: formattedPhone,
            'src.name': 'Planello',
            template: JSON.stringify({
                id: templateId,
                params: templateParams  // Send as an array, not an object
            })
        });

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apikey': process.env.GUPSHUP_API_KEY,
            'Cache-Control': 'no-cache'
        };

        console.log('📤 Sending WhatsApp reminder:', {
            to: formattedPhone,
            task: safeTaskText,
            dueDate: safeDueDate,
            templateId,
            templateName
        });

        // Log the sending attempt
        console.log('Sending WhatsApp message to:', formattedPhone);

        try {
            const response = await axios.post(
                'https://api.gupshup.io/wa/api/v1/template/msg',
                payload,
                {
                    headers,
                    timeout: 10000
                }
            );

            console.log('✅ WhatsApp Template API Response:', {
                status: response.status,
                data: response.data
            });

            return response.data && response.data.status === 'submitted';
        } catch (error) {
            console.error('❌ WhatsApp API Error:', {
                message: error.message,
                response: error.response?.data || 'No response data',
                status: error.response?.status,
                headers: error.response?.headers
            });
            return false;
        }
    } catch (error) {
        console.error('❌ WhatsApp Template API Error:', {
            message: error.message,
            response: error.response?.data || error.message,
            stack: error.stack
        });
        return false;
    }
}

// =====================
// GET ALL WEEKLY TASKS
// =====================
app.get('/api/schedule/tasks', async (req, res) => {
    try {
        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }

        // Find user by phone number
        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Check if user has a schedule in either schedule or weeklySchedule field
        const scheduleData = user.weeklySchedule || user.schedule;

        if (!scheduleData || !scheduleData.rows || scheduleData.rows.length === 0) {
            return res.json({
                success: true,
                message: 'No tasks found in schedule',
                tasks: [],
                scheduleType: 'none',
                availableFields: Object.keys(user.toObject())
            });
        }

        // Process tasks
        const tasksByDay = {
            'Monday': [],
            'Tuesday': [],
            'Wednesday': [],
            'Thursday': [],
            'Friday': [],
            'Saturday': [],
            'Sunday': []
        };

        // Check if it's the new format (rows as objects)
        const isNewFormat = scheduleData.rows.length > 0 &&
            typeof scheduleData.rows[0] === 'object' &&
            'day' in scheduleData.rows[0];

        console.log('Processing schedule data:', JSON.stringify(scheduleData, null, 2));

        if (isNewFormat) {
            // New format: rows are objects with day, time, task
            scheduleData.rows.forEach((row, index) => {
                if (row.day && row.time && row.task) {
                    const day = row.day.charAt(0).toUpperCase() + row.day.slice(1).toLowerCase();
                    if (tasksByDay[day]) {
                        tasksByDay[day].push({
                            time: row.time,
                            task: row.task,
                            rawTime: row.time
                        });
                        console.log(`Added task: ${day} ${row.time} - ${row.task}`);
                    }
                } else {
                    console.log('Skipping row - missing required fields:', row);
                }
            });
        } else {
            // Old format: rows are arrays
            const timeSlots = scheduleData.headers || [];
            console.log('Processing legacy format with time slots:', timeSlots);

            scheduleData.rows.forEach((row, rowIndex) => {
                if (!Array.isArray(row) || row.length <= 1) {
                    console.log('Skipping invalid row:', row);
                    return;
                }

                const day = row[0];
                console.log(`Processing day: ${day}, row data:`, row);

                // Skip if day is not valid
                if (!day || !tasksByDay[day]) {
                    console.log(`Skipping invalid day: ${day}`);
                    return;
                }

                // Process each time slot (skip first column which is the day)
                for (let col = 1; col < row.length; col++) {
                    const taskText = row[col];
                    const timeSlot = timeSlots[col - 1]; // Adjust index since we skipped day column

                    if (taskText && taskText.trim() !== '' && timeSlot) {
                        tasksByDay[day].push({
                            time: timeSlot,
                            task: taskText,
                            rawTime: timeSlot
                        });
                        console.log(`Added task: ${day} ${timeSlot} - ${taskText}`);
                    }
                }
            });
        }

        // Sort tasks by time within each day
        Object.keys(tasksByDay).forEach(day => {
            tasksByDay[day].sort((a, b) => {
                // Simple string comparison for sorting times
                return a.rawTime.localeCompare(b.rawTime);
            });
        });

        // Convert to array format for response
        const allTasks = [];
        Object.entries(tasksByDay).forEach(([day, tasks]) => {
            if (tasks.length > 0) {
                tasks.forEach(task => {
                    allTasks.push({
                        day,
                        time: task.time,
                        task: task.task
                    });
                });
            }
        });

        res.json({
            success: true,
            scheduleType: isNewFormat ? 'new' : 'legacy',
            totalTasks: allTasks.length,
            tasks: allTasks,
            tasksByDay: tasksByDay
        });

    } catch (error) {
        console.error('Error fetching schedule tasks:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch schedule tasks',
            details: error.message
        });
    }
});

// =====================
// DEBUG FUNCTION TO DISPLAY TASKS BY DAY
// =====================
async function debugDisplayTasksByDay(phone, checkTriggers = false) {
    try {
        // Initialize days of week first
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        // Initialize tasksByDay object with empty arrays for each day
        const tasksByDay = {};
        daysOfWeek.forEach(day => {
            tasksByDay[day] = [];
        });

        // Get user data
        const user = await User.findOne({ phone });
        if (!user) {
            console.log('❌ User not found');
            return;
        }

        // Get current time for trigger checking
        const now = new Date();
        const nextMinute = new Date(now.getTime() + 60000);
        const currentDay = daysOfWeek[now.getDay()];
        const nextMinuteDay = daysOfWeek[nextMinute.getDay()];

        // Format the target time for comparison (HH:MM AM/PM)
        const targetTime = nextMinute.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).toUpperCase().replace(/ /g, '');

        let tasksToTrigger = [];

        // First, log all available user data for debugging
        console.log('🔍 All user data fields:', Object.keys(user.toObject()));

        // Check for schedule data in different possible locations
        let schedule = user.weeklySchedule || user.schedule;

        // If we have a weeklySchedule object with a rows property, use that
        if (schedule && typeof schedule === 'object' && !Array.isArray(schedule) && schedule.rows) {
            console.log('ℹ️ Found schedule in weeklySchedule.rows');
        }
        // If we have a direct array of tasks
        else if (Array.isArray(schedule)) {
            console.log('ℹ️ Found direct array of tasks');
        }
        // If we have a schedule object with rows
        else if (schedule && schedule.rows) {
            console.log('ℹ️ Found schedule in schedule.rows');
        }
        // Check for schedule in other possible locations
        else if (user.schedule) {
            console.log('ℹ️ Found schedule in user.schedule');
            schedule = user.schedule;
        } else {
            console.log('❌ No valid schedule data found in any expected location');
            console.log('Available data:', JSON.stringify({
                hasWeeklySchedule: !!user.weeklySchedule,
                hasSchedule: !!user.schedule,
                weeklyScheduleType: user.weeklySchedule ? typeof user.weeklySchedule : 'none',
                scheduleType: user.schedule ? typeof user.schedule : 'none'
            }, null, 2));
            return;
        }

        console.log('📋 Schedule data structure:', JSON.stringify(schedule, null, 2));

        // Check if it's the new format (direct array of tasks)
        const isNewFormat = Array.isArray(schedule);

        if (!isNewFormat && (!schedule.rows || !Array.isArray(schedule.rows) || schedule.rows.length === 0)) {
            console.log('ℹ️ No valid schedule rows found');
            return;
        }

        console.log('\n📅 ===== TASKS BY DAY =====');
        console.log(`👤 User: ${user.name || 'No name'} (${user.phone})`);
        console.log(`📆 Last Updated: ${new Date().toLocaleString()}\n`);

        console.log(`📊 Format: ${isNewFormat ? 'New format (array of tasks)' : 'Legacy format (with headers and rows)'}`);

        if (isNewFormat) {
            // New format processing - direct array of tasks
            console.log('🔄 Processing new format schedule (array of tasks)...');
            schedule.forEach((task, index) => {
                if (task.day && task.time && task.task) {
                    const day = task.day.charAt(0).toUpperCase() + task.day.slice(1).toLowerCase();
                    if (daysOfWeek.includes(day)) {
                        tasksByDay[day].push({
                            time: task.time,
                            task: task.task
                        });
                        console.log(`   ✅ Added task: ${day} at ${task.time} - ${task.task}`);
                    } else {
                        console.log(`   ⚠️ Invalid day '${task.day}' in task ${index + 1}`);
                    }
                } else {
                    console.log(`   ⚠️ Incomplete task at index ${index}:`, JSON.stringify(task));
                }
            });
        } else {
            // Legacy format processing (with headers and rows)
            console.log(`📋 Number of rows: ${schedule.rows.length}`);
            console.log('📝 First row sample:', JSON.stringify(schedule.rows[0]));
            // Legacy format processing
            const timeSlots = schedule.headers || [];
            schedule.rows.forEach((row, rowIndex) => {
                if (Array.isArray(row) && row.length > 0) {
                    const day = row[0];
                    if (daysOfWeek.includes(day)) {
                        // Process all columns including the first one
                        for (let i = 0; i < row.length; i++) {
                            const taskText = row[i];
                            // For first column, use 'All Day' as time
                            const timeSlot = i === 0 ? 'All Day' : (timeSlots[i - 1] || 'No time');

                            if (taskText && taskText.trim() !== '' && (i > 0 || day !== taskText.trim())) {
                                // Skip if it's the day name cell and matches the day exactly
                                if (i === 0 && day === taskText.trim()) {
                                    continue;
                                }

                                tasksByDay[day].push({
                                    time: timeSlot,
                                    task: taskText
                                });
                            }
                        }
                    }
                }
            });
        }

        // Display tasks for each day
        daysOfWeek.forEach(day => {
            if (tasksByDay[day].length > 0) {
                console.log(`\n📌 ${day.toUpperCase()}`);
                console.log('─'.repeat(80));

                // Sort tasks by time
                tasksByDay[day].sort((a, b) => {
                    return a.time.localeCompare(b.time);
                });

                // Display each task
                tasksByDay[day].forEach((task, index) => {
                    let taskLine = `⏰ ${task.time.padEnd(8)} - ${task.task}`;

                    // Check if this task would be triggered in the next minute
                    if (checkTriggers && day === nextMinuteDay) {
                        // Format the task time for comparison (convert to 24h format)
                        const taskTime = task.time.toUpperCase();
                        const isMatch = taskTime === targetTime;

                        if (isMatch) {
                            taskLine += ` \x1b[32m[TRIGGERING NOW]\x1b[0m`;
                            tasksToTrigger.push({
                                day,
                                time: task.time,
                                task: task.task
                            });
                        }
                    }

                    console.log(taskLine);
                });
            } else {
                console.log(`\n📌 ${day.toUpperCase()} - No tasks scheduled`);
            }
        });

        // Show which tasks would be triggered now
        if (checkTriggers) {
            console.log('\n🔔 Trigger Check:');
            console.log('─'.repeat(80));
            console.log(`Current time: ${now.toLocaleTimeString()}`);
            console.log(`Checking for tasks at: ${nextMinute.toLocaleTimeString()}`);
            console.log(`Target time: ${targetTime}`);

            if (tasksToTrigger.length > 0) {
                console.log('\n🚀 Tasks that would trigger at this time:');
                tasksToTrigger.forEach((task, index) => {
                    console.log(`   ${index + 1}. ${task.time} - ${task.task}`);
                });
            } else {
                console.log('\nℹ️ No tasks are scheduled to trigger at this time');
            }
        }

        console.log('\n✨ Total tasks found:',
            Object.values(tasksByDay).reduce((sum, tasks) => sum + tasks.length, 0)
        );

    } catch (error) {
        console.error('❌ Error in debugDisplayTasksByDay:', error);
    }
}

// =====================
// TEMPORARY DEBUG ENDPOINT - INSPECT USER DATA
// =====================
app.get('/api/debug/user', async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({
                error: 'Phone number is required',
                example: '/api/debug/user?phone=919876543210'
            });
        }

        console.log(`\n🔍 Fetching user data for: ${phone}`);

        // Find user without excluding any fields
        const user = await User.findOne({ phone });

        if (!user) {
            console.log('❌ User not found');
            return res.status(404).json({ error: 'User not found' });
        }

        // Convert to plain object and remove sensitive data
        const userData = user.toObject();
        delete userData.password;
        delete userData.tokens;

        console.log('📋 User data structure:', JSON.stringify({
            _id: userData._id,
            name: userData.name,
            phone: userData.phone,
            hasWeeklySchedule: !!userData.weeklySchedule,
            hasSchedule: !!userData.schedule,
            weeklyScheduleKeys: userData.weeklySchedule ? Object.keys(userData.weeklySchedule) : null,
            scheduleKeys: userData.schedule ? Object.keys(userData.schedule) : null
        }, null, 2));

        res.json({
            success: true,
            user: userData
        });

    } catch (error) {
        console.error('Error in /api/debug/user:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user data',
            details: error.message
        });
    }
});

// =====================
// DEBUG ENDPOINT TO DISPLAY TASKS BY DAY
// =====================
app.get('/api/debug/tasks', async (req, res) => {
    try {
        const { phone, check } = req.query;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required as a query parameter',
                example: '/api/debug/tasks?phone=919876543210&check=1'
            });
        }

        const checkTriggers = check === '1' || check === 'true';

        console.log(`\n🔍 Displaying tasks for phone: ${phone}`);
        if (checkTriggers) {
            console.log('🔔 Checking which tasks would trigger in the next minute...');
        }

        // Call the debug function
        await debugDisplayTasksByDay(phone, checkTriggers);

        res.json({
            success: true,
            message: checkTriggers
                ? 'Check server console for task details and trigger status'
                : 'Check server console for task details',
            phone: phone,
            checkTriggers: checkTriggers
        });

    } catch (error) {
        console.error('Error in /api/debug/tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to display tasks',
            error: error.message
        });
    }
});

// =====================
// ENDPOINT TO VIEW COMPLETE SCHEDULE AS HTML TABLE
// =====================
app.get('/api/schedule/view', async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).send('Phone number is required. Example: /api/schedule/view?phone=919876543210');
        }

        // Ensure MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            await startMongoDB();
        }

        // Find user
        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).send('User not found');
        }

        // Get schedule data (try weeklySchedule first, then schedule)
        let schedule = user.weeklySchedule || user.schedule;
        if (!schedule) {
            return res.send('No schedule data found for this user');
        }

        // Extract rows based on schedule format
        let rows = [];
        if (Array.isArray(schedule)) {
            rows = schedule;
        } else if (schedule.rows && Array.isArray(schedule.rows)) {
            rows = schedule.rows;
        } else {
            return res.send('Unsupported schedule format');
        }

        // Process rows into a more usable format
        const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const scheduleByDay = {};

        // Initialize empty arrays for each day
        daysOrder.forEach(day => {
            scheduleByDay[day] = [];
        });

        // Process each row
        rows.forEach(row => {
            // Handle different property name cases
            const day = (row.day || row.Day || '').toString().trim();
            const time = (row.time || row.Time || '').toString().trim();
            const task = (row.task || row.Task || row.text || row.Text || '').toString().trim();

            if (!day || !time || !task) return; // Skip invalid entries

            // Format day (capitalize first letter)
            const formattedDay = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();

            // Only add if it's a valid day
            if (daysOrder.includes(formattedDay)) {
                scheduleByDay[formattedDay].push({
                    time: time,
                    task: task
                });
            }
        });

        // Sort tasks by time within each day
        Object.keys(scheduleByDay).forEach(day => {
            scheduleByDay[day].sort((a, b) => {
                // Simple time string comparison (works for same format times)
                return a.time.localeCompare(b.time);
            });
        });

        // Generate HTML table
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Weekly Schedule for ${user.name || phone}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; text-align: center; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background-color: #f2f2f2; position: sticky; top: 0; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                tr:hover { background-color: #f1f1f1; }
                .time-col { width: 100px; }
                .task-col { width: auto; }
                .day-header { background-color: #4CAF50 !important; color: white; font-weight: bold; }
                .no-tasks { color: #888; font-style: italic; }
                .container { max-width: 1200px; margin: 0 auto; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Weekly Schedule for ${user.name || phone}</h1>
                <p>Last updated: ${new Date().toLocaleString()}</p>
        `;

        // Add a table for each day
        daysOrder.forEach(day => {
            const tasks = scheduleByDay[day] || [];

            html += `
            <h2>${day}</h2>
            <table>
                <thead>
                    <tr>
                        <th class="time-col">Time</th>
                        <th class="task-col">Task</th>
                    </tr>
                </thead>
                <tbody>
            `;

            if (tasks.length === 0) {
                html += `
                <tr>
                    <td colspan="2" class="no-tasks">No tasks scheduled</td>
                </tr>
                `;
            } else {
                tasks.forEach(task => {
                    html += `
                    <tr>
                        <td>${task.time}</td>
                        <td>${task.task}</td>
                    </tr>
                    `;
                });
            }

            html += `
                </tbody>
            </table>
            `;
        });

        // Close HTML
        html += `
            </div>
        </body>
        </html>
        `;

        res.send(html);

    } catch (error) {
        console.error('Error in /api/schedule/view:', error);
        res.status(500).send(`Error generating schedule view: ${error.message}`);
    }
});

// =====================
// DEBUG ENDPOINT TO INSPECT SCHEDULE DATA
// =====================
app.get('/api/debug/schedule-data', async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required',
                example: '/api/debug/schedule-data?phone=919876543210'
            });
        }

        console.log(`\n🔍 Fetching schedule data for: ${phone}`);

        // Find user with all fields
        const user = await User.findOne({ phone });

        if (!user) {
            console.log('❌ User not found');
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get schedule data from all possible locations
        const scheduleData = {
            hasWeeklySchedule: !!user.weeklySchedule,
            hasSchedule: !!user.schedule,
            weeklyScheduleType: user.weeklySchedule ? typeof user.weeklySchedule : 'none',
            scheduleType: user.schedule ? typeof user.schedule : 'none',
            weeklyScheduleKeys: user.weeklySchedule ? Object.keys(user.weeklySchedule.toObject ? user.weeklySchedule.toObject() : {}) : [],
            scheduleKeys: user.schedule ? Object.keys(user.schedule.toObject ? user.schedule.toObject() : {}) : []
        };

        // Get sample data (first few items if array, or the whole object)
        if (user.weeklySchedule) {
            if (Array.isArray(user.weeklySchedule)) {
                scheduleData.weeklyScheduleSample = user.weeklySchedule.slice(0, 3);
                scheduleData.weeklyScheduleLength = user.weeklySchedule.length;
            } else if (user.weeklySchedule.rows && Array.isArray(user.weeklySchedule.rows)) {
                scheduleData.weeklyScheduleSample = user.weeklySchedule.rows.slice(0, 3);
                scheduleData.weeklyScheduleLength = user.weeklySchedule.rows.length;
            } else {
                scheduleData.weeklyScheduleSample = user.weeklySchedule;
            }
        }

        if (user.schedule) {
            if (Array.isArray(user.schedule)) {
                scheduleData.scheduleSample = user.schedule.slice(0, 3);
                scheduleData.scheduleLength = user.schedule.length;
            } else if (user.schedule.rows && Array.isArray(user.schedule.rows)) {
                scheduleData.scheduleSample = user.schedule.rows.slice(0, 3);
                scheduleData.scheduleLength = user.schedule.rows.length;
            } else {
                scheduleData.scheduleSample = user.schedule;
            }
        }

        console.log('📋 Schedule data structure:', JSON.stringify(scheduleData, null, 2));

        res.json({
            success: true,
            ...scheduleData
        });

    } catch (error) {
        console.error('Error in /api/debug/schedule-data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch schedule data',
            details: error.message
        });
    }
});

// =====================
// DEBUG ENDPOINT TO CHECK CURRENT TIME
// =====================
app.get('/api/debug/time', (req, res) => {
    const now = new Date();
    const nextMinute = new Date(now.getTime() + 60000);
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    const response = {
        currentTime: {
            iso: now.toISOString(),
            local: now.toString(),
            dayOfWeek: daysOfWeek[now.getDay()],
            hours: now.getHours(),
            minutes: now.getMinutes(),
            seconds: now.getSeconds()
        },
        nextMinute: {
            iso: nextMinute.toISOString(),
            local: nextMinute.toString(),
            dayOfWeek: daysOfWeek[nextMinute.getDay()],
            hours: nextMinute.getHours(),
            minutes: nextMinute.getMinutes()
        },
        serverTimeOffset: now.getTimezoneOffset() / -60, // in hours
        systemTime: new Date().toLocaleString('en-US', { timeZoneName: 'short' })
    };

    console.log('Time debug info:', JSON.stringify(response, null, 2));
    res.json(response);
});

// =====================
// TEST ENDPOINT TO CHECK SCHEDULE DATA
// =====================
app.get('/api/debug/schedule', async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[DEBUG] User ${phone} schedule data:`, JSON.stringify(user.schedule, null, 2));

        // Format the response with better structure
        const response = {
            phone: user.phone,
            name: user.name,
            hasSchedule: !!user.schedule,
            schedule: user.schedule || {},
            scheduleType: user.schedule ?
                (Array.isArray(user.schedule.rows) && user.schedule.rows.length > 0 &&
                typeof user.schedule.rows[0] === 'object' && 'day' in user.schedule.rows[0] ?
                    'new' : 'legacy') : 'none',
            rowsCount: user.schedule && user.schedule.rows ? user.schedule.rows.length : 0,
            sampleRow: user.schedule && user.schedule.rows && user.schedule.rows[0]
                ? user.schedule.rows[0]
                : null
        };

        res.json(response);
    } catch (error) {
        console.error('Error in /api/debug/schedule:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// =====================
// TEST ENDPOINT FOR WHATSAPP REMINDER DEBUGGING
// =====================
app.get('/api/test-whatsapp-reminder', async (req, res) => {
    const { phone, name = 'Test User', taskText = 'Test Reminder', dueDate = 'Now' } = req.query;

    if (!phone) {
        return res.status(400).json({
            success: false,
            message: 'Phone number is required as a query parameter',
            example: 'http://localhost:3001/api/test-whatsapp-reminder?phone=919876543210'
        });
    }

    console.log('📱 Test WhatsApp request received for phone:', phone);

    try {
        const result = await sendWhatsAppReminder(phone, name, taskText, dueDate);
        if (result) {
            return res.json({
                success: true,
                message: 'WhatsApp message sent successfully',
                details: {
                    phone,
                    name,
                    taskText,
                    dueDate
                }
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Failed to send WhatsApp message',
                details: { phone }
            });
        }
    } catch (error) {
        console.error('❌ Test WhatsApp error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error sending WhatsApp message',
            error: error.message,
            details: error.response?.data || {}
        });
    }
});

// Original test endpoint (POST)
app.post('/api/test-whatsapp-reminder-original', async (req, res) => {
    const { phone, name = 'Test User', taskText = 'Test Reminder', dueDate = 'Now' } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    console.log('📱 Test WhatsApp request received for phone:', phone);

    try {
        const result = await sendWhatsAppReminder(phone, name, taskText, dueDate);
        if (result) {
            return res.json({
                success: true,
                message: 'WhatsApp message sent successfully',
                details: {
                    phone,
                    name,
                    taskText,
                    dueDate
                }
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Failed to send WhatsApp message',
                details: { phone }
            });
        }
    } catch (error) {
        console.error('❌ Test WhatsApp error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error sending WhatsApp message',
            error: error.message,
            details: error.response?.data || {}
        });
    }
});

// Simple test endpoint to check if server is running
app.get('/api/test', (req, res) => {
    res.json({
        status: 'Server is running',
        time: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Test endpoint to verify Gupshup credentials and send a test message
app.get('/api/test-gupshup', async (req, res) => {
    try {
        if (!process.env.GUPSHUP_API_KEY || !process.env.GUPSHUP_SENDER) {
            throw new Error('Gupshup credentials not configured');
        }

        // Try to send a test message to verify the credentials
        const testPhone = req.query.phone || '918XXXXXXXXX'; // Replace with a test number
        const testMessage = '🚀 Test message from Planello - Gupshup API is working!';

        const payload = qs.stringify({
            channel: 'whatsapp',
            source: process.env.GUPSHUP_SENDER,
            destination: testPhone.replace(/\D/g, '').replace(/^0+/, ''),
            'src.name': 'Planello',
            message: testMessage
        });

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apikey': process.env.GUPSHUP_API_KEY
        };

        try {
            const response = await axios.post('https://api.gupshup.io/wa/api/v1/msg', payload, {
                headers,
                timeout: 10000
            });

            res.json({
                success: true,
                message: 'Test message sent successfully',
                gupshupConfigured: true,
                sender: process.env.GUPSHUP_SENDER,
                templateId: process.env.GUPSHUP_REMINDER_TEMPLATE_ID,
                apiKeyPresent: true,
                response: response.data
            });
        } catch (error) {
            console.error('Gupshup API Error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to send test message',
                error: error.message,
                gupshupConfigured: false,
                sender: process.env.GUPSHUP_SENDER,
                templateId: process.env.GUPSHUP_REMINDER_TEMPLATE_ID,
                apiKeyPresent: !!process.env.GUPSHUP_API_KEY,
                response: error.response?.data
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            gupshupConfigured: false
        });
    }
});

// Original test endpoint
app.post('/api/test-whatsapp-reminder-original', async (req, res) => {
    const { phone, taskText, dueDate } = req.body;
    if (!phone || !taskText || !dueDate) {
        return res.status(400).json({ success: false, message: 'Missing phone, taskText, or dueDate' });
    }
    try {
        const success = await sendWhatsAppReminder(phone, taskText, dueDate);
        if (success) {
            return res.json({ success: true, message: 'WhatsApp reminder sent successfully!' });
        } else {
            return res.status(500).json({ success: false, message: 'Failed to send WhatsApp reminder' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error sending WhatsApp reminder', error: error.message });
    }
});
// =====================
// NOTIFICATION SERVICE (Unified)
// =====================
async function sendNotification(user, type, message, taskId = null) {
    let sent = false;
    const results = { email: false, sms: false, whatsapp: false, push: false };
    if (user.notificationSettings.email && user.email) {
        if (type === 'otp') {
            results.email = await sendEmailOTP(user.email, message);
        }
        sent = sent || results.email;
    }
    if (user.notificationSettings.whatsapp && user.phone) {
        if (type === 'otp') {
            results.whatsapp = await sendWhatsAppOTP(user.phone, message);
        }
        sent = sent || results.whatsapp;
    }
    if (user.notificationSettings.push) {
        io.to(user._id.toString()).emit('notification', { userId: user._id, type, message, taskId, timestamp: new Date() });
        results.push = true;
        sent = true;
    }
    return { sent, results };
}

// =====================
// API ROUTES
// =====================
// (All endpoints from nodeserver.js/server.js, including register, login, OTP, tasks, notifications, config, etc.)
// ...
// (For brevity, not repeating all endpoints here, but in your actual file, paste all the endpoint logic from nodeserver.js/server.js)
// ...

// Find user by phone (for existing user login)
app.post('/api/find-user-by-phone', async (req, res) => {
    try {
        let { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }
        // Normalize phone number to always start with '91'
        phone = phone.replace(/^\+?91/, '');
        phone = '91' + phone;
        console.log('Checking phone:', phone);
        const user = await User.findOne({ phone });
        console.log('User found:', user);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        // Optionally, generate a JWT for the user
        const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: '7d' });
        res.json({ success: true, user, token });
    } catch (error) {
        console.error('❌ Find user by phone error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// WhatsApp OTP verification endpoint
app.post('/api/verify-whatsapp-otp', async (req, res) => {
    try {
        let { phone, otp, name } = req.body;
        console.log('Verifying OTP for phone:', phone, 'with name:', name);

        // Normalize phone number by removing all non-digit characters
        let normalizedPhone = phone.replace(/\D/g, '');

        // Ensure phone number starts with 91 if it's 10 digits
        if (normalizedPhone.length === 10) {
            normalizedPhone = '91' + normalizedPhone;
        } else if (normalizedPhone.startsWith('0')) {
            normalizedPhone = '91' + normalizedPhone.substring(1);
        }

        console.log('Normalized phone:', normalizedPhone);

        // Try to find user with different phone number formats
        const user = await User.findOne({
            $or: [
                { phone: normalizedPhone },
                { phone: `+${normalizedPhone}` },
                { phone: `91${normalizedPhone}` },
                { phone: `+91${normalizedPhone}` },
                { phone: normalizedPhone.replace(/^91/, '') },
                { phone: normalizedPhone.replace(/^\+?91/, '') }
            ]
        });

        if (!user) {
            console.log(`User not found for phone: ${phone} (normalized: ${normalizedPhone})`);
            return res.status(404).json({ success: false, message: 'User not found. Please register first.' });
        }

        console.log('Found user:', {
            _id: user._id,
            phone: user.phone,
            currentName: user.name,
            isVerified: user.isVerified
        });
        if (user.phoneOtp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }
        if (new Date() > user.otpExpiry) {
            return res.status(400).json({ success: false, message: 'OTP expired' });
        }

        // Update user's name if provided and different from current name
        if (name && name.trim() !== '') {
            const trimmedName = name.trim();
            if (trimmedName !== user.name) {
                console.log(`Updating name for user ${user.phone} from '${user.name}' to '${trimmedName}'`);
                user.name = trimmedName;
            }
        } else {
            console.log(`No name provided for user ${user.phone}, current name: '${user.name}'`);
        }

        // Mark user as verified and clear OTP data
        user.isVerified = true;
        user.phoneOtp = null;
        user.otpExpiry = null;
        user.lastLogin = new Date();

        // Add validation before saving
        if (!user.name || user.name.trim() === '') {
            console.error('Attempting to save user with empty name:', user.phone);
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        await user.save();
        console.log(`User ${user.phone} verified successfully. Name: '${user.name}', isVerified: ${user.isVerified}`);
        res.json({
            success: true,
            message: 'WhatsApp verified successfully',
            phone: user.phone // Return the formatted phone number
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Verification failed', error: error.message });
    }
});

// Send WhatsApp OTP endpoint with detailed logging
app.post('/api/send-whatsapp-otp', async (req, res) => {
    try {
        let { phone, name } = req.body;

        // Validate inputs
        if (!phone) {
            console.error('No phone provided');
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        if (!name || name.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Please enter your name',
                requiresName: true
            });
        }

        // Normalize phone number by removing all non-digit characters and leading 0s
        const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');

        // Ensure phone number has exactly 10 digits (without country code)
        if (normalizedPhone.length < 10) {
            return res.status(400).json({ success: false, message: 'Invalid phone number. Must be at least 10 digits' });
        }

        // Take last 10 digits in case more digits are provided
        const last10Digits = normalizedPhone.slice(-10);
        // Store with country code 91
        const formattedPhone = `91${last10Digits}`;

        // Clean up name
        name = name.trim();

        // Find or create user with consistent phone format
        let user = await User.findOne({
            $or: [
                { phone: formattedPhone },
                { phone: `+${formattedPhone}` },
                { phone: formattedPhone.replace(/^91/, '') }
            ]
        });

        if (!user) {
            // Create new user if not exists with consistent phone format
            user = new User({
                phone: formattedPhone, // Store as 91XXXXXXXXXX (exactly 12 digits)
                name,
                notificationSettings: {
                    whatsapp: true,
                    email: false,
                    sms: false,
                    push: false
                }
            });
        } else {
            // Update name if it has changed
            if (user.name !== name) {
                user.name = name;
            }
            // Ensure phone number is stored consistently
            if (user.phone !== formattedPhone) {
                user.phone = `91${normalizedPhone.replace(/^91/, '')}`;
            }
        }
        const otp = generateOTP();
        user.phoneOtp = otp;
        user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();

        // Prepare form-urlencoded payload for Gupshup
        const payload = qs.stringify({
            channel: 'whatsapp',
            source: process.env.GUPSHUP_SENDER,
            destination: phone,
            'src.name': 'Planello',
            template: JSON.stringify({
                id: process.env.GUPSHUP_TEMPLATE_ID,
                params: [otp]
            })
        });
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'apikey': process.env.GUPSHUP_API_KEY
        };
        try {
            const response = await axios.post('https://api.gupshup.io/wa/api/v1/template/msg', payload, { headers });
            console.log('Gupshup response:', response.data);
            if (response.data && response.data.status === 'submitted') {
                return res.json({ success: true, message: 'WhatsApp OTP sent successfully!' });
            } else {
                console.error('Gupshup error:', response.data);
                return res.status(500).json({ success: false, message: 'Failed to send WhatsApp OTP', details: response.data });
            }
        } catch (err) {
            console.error('Gupshup API error:', err.response?.data || err.message);
            return res.status(500).json({ success: false, message: 'Gupshup API error', error: err.response?.data || err.message });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ success: false, message: 'Failed to send WhatsApp OTP', error: error.message });
    }
});

// --- MongoDB-backed per-user task API ---
// Get all tasks for a user
app.get('/api/tasks', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.isVerified) return res.status(403).json({ error: 'Please verify your phone number first' });

    const tasks = await Task.find({ userId: user._id });
    res.json(tasks);
});
// Add a new task for a user
app.post('/api/tasks', async (req, res) => {
    try {
        console.log('Received task creation request:', req.body);

        const { phone, text, priority = 'medium', reminderTime, dueDate: dueDateStr } = req.body;

        if (!phone || !text) {
            console.log('Missing required fields - phone:', !!phone, 'text:', !!text);
            return res.status(400).json({ error: 'Phone and text are required' });
        }

        const user = await User.findOne({ phone });
        if (!user) {
            console.log('User not found for phone:', phone);
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (!user.isVerified) {
            console.log('User not verified:', phone);
            return res.status(403).json({ error: 'Please verify your phone number before creating tasks' });
        }

        // Parse due date from either reminderTime or dueDate
        let dueDate = null;
        const dateToParse = reminderTime || dueDateStr;

        if (dateToParse) {
            try {
                dueDate = new Date(dateToParse);
                if (isNaN(dueDate.getTime())) {
                    console.log('Invalid date format:', dateToParse);
                    dueDate = null;
                }
            } catch (e) {
                console.error('Error parsing date:', e);
                dueDate = null;
            }
        }

        const task = new Task({
            userId: user._id,
            text: text.trim(),
            priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
            completed: false,
            createdAt: new Date(),
            dueDate: dueDate,
            reminderTime: dueDate,
            reminderSent: false,
            oneMinuteReminderSent: false
        });

        console.log('Saving task:', task); // Debug log
        await task.save();

        // Populate user data in the response
        const savedTask = await Task.findById(task._id).populate('userId', 'name phone notificationSettings');

        console.log('Task saved successfully:', savedTask); // Debug log
        res.json(savedTask);

    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({
            error: 'Failed to create task',
            details: error.message
        });
    }
});
// Update a task (e.g., mark as completed)
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { completed, text, priority } = req.body;
        const update = {};

        if (typeof completed === 'boolean') update.completed = completed;
        if (typeof text === 'string') update.text = text;
        if (priority && ['low', 'medium', 'high'].includes(priority)) {
            update.priority = priority;
        }

        const task = await Task.findByIdAndUpdate(id, update, { new: true });
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: 'Failed to update task' });
    }
});
// Delete a task
app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    await Task.findByIdAndDelete(id);
    res.json({ success: true });
});

// --- MongoDB-backed per-user schedule API ---
// Add 'schedule' field to User schema if not present
if (!userSchema.paths.schedule) {
    userSchema.add({ schedule: { type: Object, default: {} } });
}
// Activate notifications for a user's schedule
app.post('/api/schedule/notify', async (req, res) => {
    const { phone, schedule } = req.body;
    console.log('--- /api/schedule/notify called ---');
    console.log('Request body:', req.body);
    if (!phone) {
        console.log('No phone provided');
        return res.status(400).json({ error: 'Phone is required' });
    }
    
    const user = await User.findOne({ phone });
    if (!user) {
        console.log('User not found:', phone);
        return res.status(404).json({ error: 'User not found. Please register and verify first.' });
    }
    
    if (!user.isVerified) {
        console.log('User not verified:', phone);
        return res.status(403).json({ error: 'Please verify your phone number before updating schedule' });
    }
    user.schedule = schedule;
    await user.save();
    // --- Immediate notification logic ---
    const now = new Date();
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = daysOfWeek[now.getDay()];
    let scheduledTimes = schedule[today];
    console.log('Today:', today, 'Scheduled times:', scheduledTimes);
    let notificationSent = false;
    if (scheduledTimes && Array.isArray(scheduledTimes)) {
        for (const scheduledTime of scheduledTimes) {
            if (!scheduledTime) continue;
            const [hour, minute] = scheduledTime.split(":").map(Number);
            if (isNaN(hour) || isNaN(minute)) continue;
            const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
            const diffMs = scheduledDate - now;
            console.log('Scheduled date:', scheduledDate, 'Current date:', now, 'Diff ms:', diffMs);
            if (diffMs > 0 && diffMs <= 60 * 1000) {
                const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                const incompleteTasks = await Task.find({
                    userId: user._id,
                    completed: false,
                    dueDate: { $gte: startOfDay, $lte: endOfDay }
                });
                console.log('Incomplete tasks found:', incompleteTasks.length);
                if (incompleteTasks.length > 0) {
                    let taskList = incompleteTasks.map((t, idx) => `${idx + 1}. ${t.text}${t.dueDate ? ` (Due: ${new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}`).join('\n');
                    const taskText = `You have ${incompleteTasks.length} pending task(s) for ${today} at ${scheduledTime}:\n${taskList}`;
                    const dueDateStr = scheduledDate.toLocaleDateString() + " " + scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    console.log('Sending WhatsApp reminder to:', user.phone);
                    const success = await sendWhatsAppReminder(user.phone, taskText, dueDateStr);
                    notificationSent = success;
                    console.log('WhatsApp reminder sent:', success);
                } else {
                    console.log('No incomplete tasks for today.');
                }
            } else {
                console.log('Not within 1 minute window before scheduled time.');
            }
        }
    } else if (scheduledTimes && typeof scheduledTimes === 'string') {
        // Fallback for single time string
        const [hour, minute] = scheduledTimes.split(":").map(Number);
        if (!isNaN(hour) && !isNaN(minute)) {
            const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
            const diffMs = scheduledDate - now;
            console.log('Scheduled date:', scheduledDate, 'Current date:', now, 'Diff ms:', diffMs);
            if (diffMs > 0 && diffMs <= 60 * 1000) {
                const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                const incompleteTasks = await Task.find({
                    userId: user._id,
                    completed: false,
                    dueDate: { $gte: startOfDay, $lte: endOfDay }
                });
                console.log('Incomplete tasks found:', incompleteTasks.length);
                if (incompleteTasks.length > 0) {
                    const name = user.name || "User";
                    let taskList = incompleteTasks.map((t, idx) => `${idx + 1}. ${t.text}${t.dueDate ? ` (Due: ${new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}`).join('\n');
                    const taskText = `You have ${incompleteTasks.length} pending task(s) for ${today} at ${scheduledTimes}:\n${taskList}`;
                    const dueDateStr = scheduledDate.toLocaleDateString() + " " + scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    console.log('Sending WhatsApp reminder to:', user.phone);
                    const success = await sendWhatsAppReminder(user.phone, name, taskText, dueDateStr);
                    notificationSent = success;
                    console.log('WhatsApp reminder sent:', success);
                } else {
                    console.log('No incomplete tasks for today.');
                }
            } else {
                console.log('Not within 1 minute window before scheduled time.');
            }
        }
    } else {
        console.log('No scheduled time for today in schedule object.');
    }
    res.json({ success: true, message: notificationSent ? 'WhatsApp notification sent!' : 'Notifications activated for your schedule!' });
});
// Save or update schedule for a user
app.post('/api/schedule', async (req, res) => {
    try {
        console.log('=== Received Schedule Update Request ===');
        console.log('Phone:', req.body.phone);
        console.log('Name:', req.body.name);
        console.log('Schedule Headers:', req.body.schedule?.headers || []);
        console.log('Schedule Rows:', req.body.schedule?.rows || []);
        console.log('======================================');

        let { phone, schedule, name } = req.body;
        
        // Validate and normalize phone number first
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required.'
            });
        }
        
        // Normalize phone to 91XXXXXXXXXX format
        const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
        const phoneWithCountryCode = normalizedPhone.length === 10 ? `91${normalizedPhone}` : normalizedPhone;
        
        // Find user by any phone number format
        const user = await User.findOne({
            $or: [
                { phone: phoneWithCountryCode },
                { phone: phoneWithCountryCode.replace(/^91/, '') },
                { phone: `+${phoneWithCountryCode}` },
                { phone: `+91${phoneWithCountryCode.replace(/^91/, '')}` }
            ]
        });
        
        if (!user) {
            console.error('User not found for phone:', phone);
            return res.status(404).json({
                success: false,
                message: 'User not found. Please complete verification first.'
            });
        }
        
        if (!user.isVerified) {
            console.error('User not verified:', phone);
            return res.status(403).json({
                success: false,
                message: 'Please verify your phone number before saving a schedule.'
            });
        }

        // Remove all non-digit characters and leading z

        // Ensure we have exactly 10 digits after removing non-digits
        if (normalizedPhone.length !== 10) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number. Must be exactly 10 digits (excluding country code)'
            });
        }

        // Format as 91XXXXXXXXXX
        phone = `91${normalizedPhone}`;

        // Additional validation for the final format
        if (!isValidPhoneNumber(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format. Must be in 91XXXXXXXXXX format'
            });
        }

        console.log('Normalized phone number for schedule update:', phone);

        // Validate schedule data
        if (!schedule) {
            return res.status(400).json({
                success: false,
                error: 'Schedule data is required'
            });
        }

        // Transform the schedule data to the expected format
        const transformedSchedule = {
            headers: Array.isArray(schedule.headers)
                ? schedule.headers.map(h => String(h || '').trim())
                : [],
            rows: []
        };

        // Convert 2D array to array of objects with day, time, task
        if (Array.isArray(schedule.rows)) {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

            transformedSchedule.rows = schedule.rows.flatMap((row, rowIndex) => {
                const day = days[rowIndex];
                if (!day) return [];

                return row.map((task, colIndex) => {
                    const time = transformedSchedule.headers[colIndex] || '';
                    return {
                        day,
                        time,
                        task: String(task || '').trim()
                    };
                }).filter(item => item.task); // Remove empty tasks
            });
        }

        // Log the transformed schedule
        console.log('Transformed Schedule Rows:');
        transformedSchedule.rows.forEach((row, idx) => {
            console.log(`  Row ${idx + 1}:`, JSON.stringify(row));
        });

        // Use the verified phone number from the user document
        const verifiedPhone = user.phone;
        console.log('Using verified phone number for schedule update:', verifiedPhone);

        // Update the user's schedule
        const updateData = {
            'schedule': transformedSchedule,
            'notificationSettings.whatsapp': true
        };

        // Only update name if it's provided and different
        if (name && name.trim() && name.trim() !== user.name) {
            updateData.name = name.trim();
        }

        // Update the user's schedule using their _id to be absolutely sure we're updating the right user
        const updatedUser = await User.findOneAndUpdate(
            { _id: user._id },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            throw new Error('Failed to update user schedule');
        }
        console.log('Schedule updated for user:', {
            phone: updatedUser.phone,
            name: updatedUser.name,
            scheduleCount: updatedUser.schedule?.rows?.length || 0
        });

        res.json({
            success: true,
            message: 'Schedule saved successfully',
            schedule: transformedSchedule,
            name: updatedUser.name
        });
    } catch (error) {
        console.error('Error saving schedule:', error);
        res.status(500).json({
            error: 'Failed to save schedule',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Clear schedule for a user
app.get('/api/schedule/clear', async (req, res) => {
    let { p: phone } = req.query;  // p is the phone parameter in the URL

    // Validate phone number format
    if (!phone) {
        return res.status(400).json({
            success: false,
            error: 'Phone number is required'
        });
    }

    // Normalize phone number to 91XXXXXXXXXX format
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (normalizedPhone.length !== 10) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone number format. Must be 10 digits (excluding country code)'
        });
    }
    phone = `91${normalizedPhone}`;

    // Additional validation for the final format
    if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone number format. Must be in 91XXXXXXXXXX format'
        });
    }

    try {
        const user = await User.findOneAndUpdate(
            { phone },
            { $set: { schedule: { headers: [], rows: [] } } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`Schedule cleared for user: ${phone}`);
        res.json({ success: true, message: 'Schedule cleared successfully' });
    } catch (error) {
        console.error('Error clearing schedule:', error);
        res.status(500).json({ error: 'Failed to clear schedule' });
    }
});

// Get schedule for a user
app.get('/api/schedule', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    const user = await User.findOne({ phone });

    // Log the schedule data being sent in the response
    console.log('=== Sending Schedule Data ===');
    console.log('For phone:', phone);
    if (user?.schedule?.rows) {
        console.log('Schedule Rows:');
        user.schedule.rows.forEach((row, idx) => {
            console.log(`  Row ${idx + 1}:`, JSON.parse(JSON.stringify(row)));
        });
    } else {
        console.log('No schedule data found for this user');
    }
    console.log('===========================');

    res.json({ schedule: user?.schedule || {} });
});

// --- User Profile API ---
app.get('/api/user-profile', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        let user = await User.findOne({ phone });
        if (!user) {
            // Only create a new user if the phone number is valid
            if (!isValidPhoneNumber(phone)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid phone number format. Must be in 91XXXXXXXXXX format'
                });
            }

            user = new User({
                phone,
                name: name || 'User',
                notificationSettings: {
                    whatsapp: true
                }
            });
            await user.save();
            console.log(`Created new user profile for phone: ${phone}`);
        }

        res.json({
            name: user.name || '',
            email: user.email || '',
            phone: user.phone || '',
            bio: user.bio || '',
            avatar: user.avatar || null,
            stats: user.stats || {},
            joinDate: user.createdAt,
            lastLogin: user.lastLogin || user.createdAt
        });
    } catch (error) {
        console.error('Error in /api/user-profile:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});
app.post('/api/user-profile', async (req, res) => {
    const { phone, name, email, bio, avatar, stats, lastLogin } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    let user = await User.findOne({ phone });
    if (!user) user = new User({ phone });
    user.name = name;
    user.email = email;
    user.bio = bio;
    user.avatar = avatar;
    user.stats = stats;
    user.lastLogin = lastLogin || new Date();
    await user.save();
    res.json({ success: true });
});
// --- Focus API ---
app.get('/api/focus', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    const user = await User.findOne({ phone });
    res.json({ focus: user?.focus || { text: '', completed: false } });
});
app.post('/api/focus', async (req, res) => {
    const { phone, focus } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    let user = await User.findOne({ phone });
    if (!user) user = new User({ phone });
    user.focus = focus;
    await user.save();
    res.json({ success: true });
});

// =====================
// SOCKET.IO CONNECTION HANDLING
// =====================
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.join(userId);
    });
});

// =====================
// SCHEDULE ENDPOINTS
// =====================
app.get('/api/schedule/clear', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.schedule = {};  // Clear the schedule
        await user.save();

        res.json({ success: true, message: 'Schedule cleared successfully' });
    } catch (error) {
        console.error('Error clearing schedule:', error);
        res.status(500).json({ error: 'Failed to clear schedule' });
    }
});

// =====================
// TASK LISTING ENDPOINT
// =====================
app.get('/api/tasks/list', async (req, res) => {
    console.log('🔍 /api/tasks/list called with query:', req.query);

    try {
        const { phone } = req.query;

        if (!phone) {
            console.log('❌ No phone number provided');
            return res.status(400).json({
                success: false,
                error: 'Phone number is required',
                receivedQuery: req.query
            });
        }

        console.log('🔎 Looking up user with phone:', phone);
        // Find user by phone and populate tasks
        const user = await User.findOne({ phone });
        if (!user) {
            console.log('❌ User not found for phone:', phone);
            return res.status(404).json({
                success: false,
                error: 'User not found',
                phone: phone
            });
        }

        console.log('👤 User found:', {
            userId: user._id,
            name: user.name,
            hasSchedule: !!user.schedule,
            scheduleType: user.schedule ? (Array.isArray(user.schedule.rows) ? 'array' : typeof user.schedule.rows) : 'none'
        });

        // Array to store all tasks
        let allTasks = [];
        let scheduleTasks = []; // Initialize scheduleTasks array

        // 1. First, check for tasks in the user's schedule (from the schedule field)
        if (user.schedule && user.schedule.rows && user.schedule.rows.length > 0) {
            console.log('📅 Found user schedule with', user.schedule.rows.length, 'rows');

            // Check if it's the new format (rows as objects with day, time, task)
            const isNewFormat = user.schedule.rows.every(row =>
                typeof row === 'object' && row !== null && 'day' in row && 'time' in row
            );

            if (isNewFormat) {
                console.log('🔍 Processing schedule in new format (rows as objects)');
                user.schedule.rows.forEach(row => {
                    if (row.day && row.time) {
                        const task = {
                            day: row.day,
                            time: row.time,
                            task: row.task || `Scheduled at ${row.time}`,
                            id: `${row.day}-${row.time}`.toLowerCase().replace(/\s+/g, '-'),
                            source: 'user_schedule'
                        };
                        allTasks.push(task);
                        scheduleTasks.push(task);
                    }
                });
            } else {
                console.log('🔍 Processing schedule in legacy format (rows as arrays)');
                const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

                user.schedule.rows.forEach((row, rowIndex) => {
                    if (!Array.isArray(row)) return;

                    row.forEach((task, colIndex) => {
                        if (task && user.schedule.headers && user.schedule.headers[colIndex]) {
                            const time = user.schedule.headers[colIndex];
                            const day = days[rowIndex % 7]; // Wrap around if more than 7 rows
                            const taskObj = {
                                day: day,
                                time: time,
                                task: (typeof task === 'object' ? (task.task || task.text) : task) || `Scheduled at ${time}`,
                                id: `${day}-${time}`.toLowerCase().replace(/\s+/g, '-'),
                                source: 'user_schedule_legacy'
                            };
                            allTasks.push(taskObj);
                            scheduleTasks.push(taskObj);
                        }
                    });
                });
            }
        } else {
            console.log('ℹ️ No schedule found in user document');
        }

        // 2. Check for tasks in the Task collection
        try {
            const tasks = await Task.find({ userId: user._id });
            console.log(`📋 Found ${tasks.length} tasks in Task collection`);

            tasks.forEach(task => {
                if (task.text && task.dueDate) {
                    const dueDate = new Date(task.dueDate);
                    const day = dueDate.toLocaleDateString('en-US', { weekday: 'long' });
                    const time = dueDate.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });

                    allTasks.push({
                        day: day,
                        time: time,
                        task: task.text,
                        id: task._id.toString(),
                        source: 'task_collection',
                        dueDate: task.dueDate,
                        priority: task.priority || 'medium',
                        completed: task.completed || false
                    });
                }
            });
        } catch (error) {
            console.error('❌ Error fetching tasks from Task collection:', error);
        }

        console.log(`✅ Found total of ${allTasks.length} tasks from all sources`);

        // Function to extract time from a date string
        const extractTime = (timeStr) => {
            try {
                if (!timeStr) return '';
                // Check if it's already in HH:MM format
                const timeMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
                if (timeMatch) {
                    let [_, hours, minutes, period] = timeMatch;
                    hours = parseInt(hours, 10);

                    // Convert to 12-hour format if needed
                    if (!period) {
                        period = hours >= 12 ? 'PM' : 'AM';
                        hours = hours % 12 || 12; // Convert 0 to 12 for 12 AM
                    }
                    return `${hours}:${minutes} ${period.toUpperCase()}`.trim();
                }
                return timeStr; // Return as is if we can't parse it
            } catch (e) {
                console.log('⚠️ Error parsing time:', timeStr, e.message);
                return timeStr || '';
            }
        };

        // Sort tasks by day and time
        const dayOrder = {
            "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3,
            "Thursday": 4, "Friday": 5, "Saturday": 6
        };

        allTasks.sort((a, b) => {
            if (dayOrder[a.day] !== dayOrder[b.day]) {
                return dayOrder[a.day] - dayOrder[b.day];
            }
            // Simple time comparison (works for same format times)
            return a.time.localeCompare(b.time);
        });

        // Remove duplicates based on day and time
        const uniqueTasks = [];
        const seen = new Set();

        allTasks.forEach(task => {
            const key = `${task.day}-${task.time}`.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                uniqueTasks.push(task);
            }
        });

        const response = {
            success: true,
            tasks: uniqueTasks,
            count: uniqueTasks.length,
            sources: [...new Set(uniqueTasks.map(t => t.source))],
            debug: {
                scheduleTasksCount: scheduleTasks.length,
                taskCollectionCount: allTasks.length - scheduleTasks.length,
                uniqueTasksCount: uniqueTasks.length,
                hasSchedule: !!user.schedule,
                scheduleType: user.schedule?.rows ? 'schedule_with_rows' : 'no_schedule'
            }
        };

        console.log(`📊 Task counts - Schedule: ${scheduleTasks.length}, Task Collection: ${allTasks.length - scheduleTasks.length}, Unique: ${uniqueTasks.length}`);
        console.log('📤 Sending response with tasks');

        return res.json(response);

    } catch (error) {
        console.error('❌ Error in /api/tasks/list:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch tasks',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});


// =====================
// SCHEDULED TASK REMINDERS
// =====================
cron.schedule('0 * * * *', async () => {
    // Hourly reminders logic
});
cron.schedule('* * * * *', async () => {
    // 1-minute reminders logic
});
// Function to validate and fix schedule format
async function validateAndFixSchedule(user) {
    if (!user.schedule) {
        console.log(`[${new Date().toISOString()}] No schedule found for user ${user.phone}`);
        return false;
    }

    const schedule = user.schedule;
    let needsUpdate = false;

    // Ensure headers exist and are in the correct format
    if (!schedule.headers || !Array.isArray(schedule.headers) || schedule.headers.length === 0) {
        console.log(`[${new Date().toISOString()}] Fixing missing/empty headers for user ${user.phone}`);
        schedule.headers = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];
        needsUpdate = true;
    }

    // Ensure rows exist and are in the correct format
    if (!schedule.rows || !Array.isArray(schedule.rows) || schedule.rows.length === 0) {
        console.log(`[${new Date().toISOString()}] Fixing missing/empty rows for user ${user.phone}`);
        schedule.rows = Array(7).fill().map(() => Array(schedule.headers.length).fill(''));
        needsUpdate = true;
    }

    // Ensure notification settings exist and WhatsApp is enabled by default
    if (!user.notificationSettings) {
        user.notificationSettings = { whatsapp: true };
        needsUpdate = true;
    } else if (user.notificationSettings.whatsapp !== true) {
        user.notificationSettings.whatsapp = true;
        needsUpdate = true;
    }

    // Save updates if any were made
    if (needsUpdate) {
        try {
            await user.save();
            console.log(`[${new Date().toISOString()}] Updated schedule format for user ${user.phone}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error updating user ${user.phone}:`, error);
            return false;
        }
    }

    return true;
}

// Scheduled job: Check for tasks in the next minute and send WhatsApp reminders
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const nextMinute = new Date(now.getTime() + 60000); // 1 minute from now
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = daysOfWeek[now.getDay()];
    const targetDay = currentDay; // Only check current day's row
    const targetHour = nextMinute.getHours();
    const targetMinute = nextMinute.getMinutes();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    console.log(`\n[${now.toISOString()}] ===== STARTING SCHEDULED TASK CHECK =====`);
    console.log(`[${now.toISOString()}] Current time: ${currentDay} ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`);
    console.log(`[${now.toISOString()}] Checking for tasks in ${currentDay}'s row at: ${targetHour.toString().padStart(2, '0')}:${targetMinute.toString().padStart(2, '0')}`);

    try {
        // Log cron job is starting
        console.log(`[${now.toISOString()}] Cron job started. Node version: ${process.version}`);

        // First, get all users with phone numbers
        console.log(`\n[${now.toISOString()}] Fetching all users...`);
        const allUsers = await User.find({});

        // Log basic user info
        console.log(`[${now.toISOString()}] Found ${allUsers.length} total users in database`);

        // Log detailed user info for debugging
        allUsers.forEach((user, index) => {
            console.log(`[${now.toISOString()}] User ${index + 1}/${allUsers.length}:`);
            console.log(`  Phone: ${user.phone}`);
            console.log(`  Name: ${user.name || 'Not set'}`);
            console.log(`  Verified: ${user.isVerified ? 'Yes' : 'No'}`);
            console.log(`  WhatsApp Notifications: ${user.notificationSettings?.whatsapp !== false ? 'Enabled' : 'Disabled'}`);
            console.log(`  Has Schedule: ${!!user.schedule}`);
            if (user.schedule) {
                console.log(`  Schedule Rows: ${user.schedule.rows?.length || 0}`);
                if (user.schedule.rows?.length > 0) {
                    console.log('  First 2 schedule items:');
                    user.schedule.rows.slice(0, 2).forEach((row, i) => {
                        console.log(`    ${i + 1}. Day: ${row.day || 'N/A'}, Time: ${row.time || 'N/A'}, Task: ${row.task || 'N/A'}`);
                    });
                    if (user.schedule.rows.length > 2) {
                        console.log(`    ...and ${user.schedule.rows.length - 2} more`);
                    }
                }
            }
            console.log(''); // Add empty line between users
        });

        // Filter for verified users with phone numbers
        const verifiedUsers = allUsers.filter(user => {
            const hasPhone = user.phone && user.phone.trim() !== '';
            const isVerified = user.isVerified === true;

            if (!hasPhone) {
                console.log(`[${now.toISOString()}] User ${user._id} excluded - No phone number`);
                return false;
            }
            if (!isVerified) {
                console.log(`[${now.toISOString()}] User ${user.phone} excluded - Not verified`);
                return false;
            }
            return true;
        });

        console.log(`[${now.toISOString()}] Found ${verifiedUsers.length} verified users with phone numbers:`);

        verifiedUsers.forEach((user, index) => {
            console.log(`  ${index + 1}. ${user.phone} (${user.name || 'No name'}) - WhatsApp: ${user.notificationSettings?.whatsapp !== false ? 'Enabled' : 'Disabled'}`);
        });

        // Filter users with valid schedules and WhatsApp enabled
        console.log(`\n[${now.toISOString()}] Checking for users with valid schedules...`);
        const users = [];

        verifiedUsers.forEach(user => {
            // Check if WhatsApp notifications are enabled (default to true if not set)
            const whatsappEnabled = user.notificationSettings?.whatsapp !== false;
            let hasValidSchedule = false;
            let scheduleInfo = [];

            // Check if user has a valid schedule
            if (!user.schedule) {
                scheduleInfo.push('No schedule object');
            } else {
                // Check if the schedule is in the new format (with rows as objects)
                const isNewFormat = user.schedule.rows && user.schedule.rows.length > 0 &&
                    typeof user.schedule.rows[0] === 'object' &&
                    'day' in user.schedule.rows[0];

                if (isNewFormat) {
                    // New format: rows are objects with day, time, task
                    const validRows = user.schedule.rows.filter(row => row.day && row.time && row.task);
                    if (validRows.length === 0) {
                        scheduleInfo.push('No valid schedule rows (missing day, time, or task)');
                    } else {
                        const daysWithTasks = [...new Set(validRows.map(row => row.day))];
                        scheduleInfo.push(`${validRows.length} valid tasks across ${daysWithTasks.length} days`);
                        hasValidSchedule = true;
                    }
                } else {
                    // Old format: rows are arrays
                    if (!user.schedule.headers || !Array.isArray(user.schedule.headers)) {
                        scheduleInfo.push('Missing or invalid headers');
                    } else if (user.schedule.headers.length === 0) {
                        scheduleInfo.push('Empty headers array');
                    }

                    if (!user.schedule.rows || !Array.isArray(user.schedule.rows)) {
                        scheduleInfo.push('Missing or invalid rows');
                    } else if (user.schedule.rows.length === 0) {
                        scheduleInfo.push('Empty rows array');
                    } else {
                        // For old format, we'll still try to process it
                        hasValidSchedule = true;
                        scheduleInfo.push('Legacy schedule format detected');
                    }
                }
            }

            const status = [];
            if (!whatsappEnabled) status.push('WhatsApp disabled');
            if (!hasValidSchedule) status.push('No valid schedule');

            if (whatsappEnabled && hasValidSchedule) {
                users.push(user);
                console.log(`[${now.toISOString()}] ✓ User ${user.phone} (${user.name || 'No name'}) has valid schedule (${scheduleInfo.join(', ')})`);
            } else {
                const statusMessages = [...status];
                if (scheduleInfo.length > 0) {
                    statusMessages.push(`Schedule issues: ${scheduleInfo.join('; ')}`);
                }
                console.log(`[${now.toISOString()}] ✗ User ${user.phone} (${user.name || 'No name'}): ${statusMessages.join(' | ')}`);
            }
        });

        console.log(`\n[${now.toISOString()}] Found ${users.length} users with valid schedules and WhatsApp enabled`);

        if (users.length === 0) {
            console.log(`[${now.toISOString()}] No users with valid schedules found`);
            return;
        }

        // Log current day's tasks for each user in the desired format
        console.log(`\n[${now.toISOString()}] ===== CURRENT DAY'S TASKS =====`);
        console.log(`[${now.toISOString()}] Current day: ${currentDay}`);

        if (users.length === 0) {
            console.log(`[${now.toISOString()}] No users with valid schedules found`);
        }

        users.forEach(user => {
            console.log(`\n[${now.toISOString()}] User: ${user.phone} (${user.name || 'No name'}) - ${currentDay}'s Tasks:`);

            const schedule = user.schedule || {};
            const currentDayTasks = [];

            // Debug: Log schedule structure
            console.log(`[${now.toISOString()}] Schedule structure:`, {
                hasRows: Array.isArray(schedule.rows),
                rowsCount: schedule.rows?.length || 0,
                hasHeaders: Array.isArray(schedule.headers),
                headersCount: schedule.headers?.length || 0
            });

            // Process tasks for the current day
            if (schedule.rows && Array.isArray(schedule.rows)) {
                // Check for new format (rows as objects with day, time, task)
                const isNewFormat = schedule.rows.length > 0 &&
                    typeof schedule.rows[0] === 'object' &&
                    'day' in schedule.rows[0];

                console.log(`[${now.toISOString()}] Processing schedule in ${isNewFormat ? 'new' : 'legacy'} format`);

                if (isNewFormat) {
                    // New format processing
                    schedule.rows.forEach((row, index) => {
                        const rowDay = (row.day || '').charAt(0).toUpperCase() + (row.day || '').slice(1).toLowerCase();
                        console.log(`[${now.toISOString()}] Row ${index}:`, { rowDay, currentDay, matches: rowDay === currentDay, time: row.time, task: row.task });

                        if (rowDay === currentDay && row.time && row.task) {
                            currentDayTasks.push({
                                time: row.time,
                                task: row.task
                            });
                        }
                    });
                } else if (schedule.headers && Array.isArray(schedule.headers) && schedule.rows.length > 0) {
                    // Legacy format processing - find current day's row
                    console.log(`[${now.toISOString()}] Processing legacy format schedule`);

                    schedule.rows.forEach((row, rowIndex) => {
                        const rowDay = (row[0] || '').toString().trim();
                        console.log(`[${now.toISOString()}] Row ${rowIndex}: ${rowDay}`);
                    });

                    const dayRow = schedule.rows.find(row => {
                        const rowDay = (row[0] || '').toString().trim();
                        return rowDay && rowDay.toLowerCase() === currentDay.toLowerCase();
                    });

                    if (dayRow) {
                        console.log(`[${now.toISOString()}] Found row for ${currentDay}:`, dayRow);

                        // Process each time column
                        schedule.headers.forEach((time, colIndex) => {
                            if (colIndex > 0 && dayRow[colIndex]) { // Skip day column and empty cells
                                console.log(`[${now.toISOString()}] Adding task at ${time}: ${dayRow[colIndex]}`);
                                currentDayTasks.push({
                                    time: time,
                                    task: dayRow[colIndex]
                                });
                            }
                        });
                    } else {
                        console.log(`[${now.toISOString()}] No row found for ${currentDay}`);
                    }
                }

                // Debug: Log the complete schedule structure
                console.log('\n=== DEBUG: SCHEDULE STRUCTURE ===');
                console.log('Headers:', schedule.headers);
                console.log('Rows:', schedule.rows);
                console.log('Current Day Tasks:', currentDayTasks);
                console.log('===============================\n');

                // Display the schedule with the same row count as saved schedule's columns
                if (currentDayTasks.length > 0) {
                    console.log(`\n=== ${currentDay.toUpperCase()} ===`);
                    console.log(`User: ${user.name || 'No name'} (${user.phone})`);
                    console.log('='.repeat(50));

                    // For legacy format (with headers as times)
                    if (schedule.headers && Array.isArray(schedule.headers)) {
                        const dayRow = schedule.rows.find(row => {
                            const rowDay = (row[0] || '').toString().trim();
                            return rowDay && rowDay.toLowerCase() === currentDay.toLowerCase();
                        });

                        if (dayRow) {
                            // Calculate how many rows we need (one row per column)
                            const numColumns = schedule.headers.length - 1; // Exclude day column

                            // Print each row
                            for (let i = 0; i < numColumns; i++) {
                                const time = schedule.headers[i + 1] || ''; // +1 to skip day column
                                const task = dayRow[i + 1] || ''; // +1 to skip day column
                                console.log(`${time.padEnd(10)} | ${task}`);
                            }
                        }
                    }
                    // For new format (with time in the row)
                    else {
                        // Sort tasks by time
                        currentDayTasks.sort((a, b) => {
                            const timeA = a.time ? a.time.toLowerCase().replace(/[^0-9:apm]/gi, '') : '';
                            const timeB = b.time ? b.time.toLowerCase().replace(/[^0-9:apm]/gi, '') : '';
                            return timeA.localeCompare(timeB);
                        });

                        // Print each task on its own row
                        currentDayTasks.forEach((task, index) => {
                            console.log(`${task.time.padEnd(10)} | ${task.task}`);
                        });
                    }
                } else {
                    console.log(`[${now.toISOString()}] No tasks found for ${currentDay} in the schedule`);
                }
            } else {
                console.log(`[${now.toISOString()}] No valid schedule data available for user`);
            }
        });

        // Log detailed schedule for each user
        console.log(`\n[${now.toISOString()}] ===== USER SCHEDULES =====`);
        users.forEach(user => {
            console.log(`\n[${now.toISOString()}] User: ${user.phone} (${user.name || 'No name'})`);

            // Log all scheduled tasks for the week
            const schedule = user.schedule;
            if (schedule && schedule.rows && Array.isArray(schedule.rows)) {
                const daysMap = {};

                // Group tasks by day
                schedule.rows.forEach(row => {
                    if (row.day && row.time && row.task) {
                        if (!daysMap[row.day]) {
                            daysMap[row.day] = [];
                        }
                        daysMap[row.day].push({
                            time: row.time,
                            task: row.task
                        });
                    }
                });

                // Log schedule structure and extract current day's tasks
                console.log('\n=== SCHEDULE STRUCTURE (Row # = Day of Week) ===');
                const currentDayTasks = [];
                const currentDayIndex = new Date().getDay(); // Get current day index (0=Sunday, 1=Monday, etc.)

                // Define days of the week with correct row numbers (Row 1: Monday, ..., Row 7: Sunday)
                const rowToDayMap = [
                    'Monday',    // Row 1 (index 0)
                    'Tuesday',   // Row 2 (index 1)
                    'Wednesday', // Row 3 (index 2)
                    'Thursday',  // Row 4 (index 3)
                    'Friday',    // Row 5 (index 4)
                    'Saturday',
                    'Sunday'// Row 6 (index 5)
                ];

                // Process each row (each row represents a day)
                schedule.rows.forEach((row, index) => {
                    const dayName = rowToDayMap[index] || `Day ${index+1}`;
                    const isCurrentDay = (currentDayIndex === 0 && index === 6) || // Sunday is row 7
                        (index === currentDayIndex - 1); // Other days are rows 1-6
                    const currentMarker = isCurrentDay ? ' [CURRENT DAY]' : '';

                    console.log(`\nRow ${index + 1}: ${dayName}${currentMarker}`);

                    if (!row) {
                        console.log('  No data');
                        return;
                    }

                    if (row.time && row.task) {
                        // Single task format
                        console.log(`  • ${row.time} - ${row.task}`);
                        if (isCurrentDay) {
                            currentDayTasks.push({
                                time: row.time,
                                task: row.task
                            });
                        }
                    } else if (Array.isArray(row)) {
                        // Array format with multiple tasks
                        row.forEach((task, taskIndex) => {
                            if (task) { // Only process if task exists
                                // For first column (index 0), use the first time from headers
                                const time = schedule.headers && schedule.headers[taskIndex] ?
                                    schedule.headers[taskIndex] :
                                    (taskIndex === 0 ? '00:00' : `Task ${taskIndex}`);

                                console.log(`  • ${time} - ${task}`);

                                if (isCurrentDay) {
                                    currentDayTasks.push({
                                        time: time,
                                        task: task
                                    });
                                }
                            }
                        });
                    } else {
                        console.log('  No tasks found');
                    }
                });

                // Log current day's tasks
                if (currentDayTasks.length > 0) {
                    console.log('\n=== CURRENT DAY TASKS ===');
                    currentDayTasks.forEach(task => {
                        console.log(`  • ${task.time} - ${task.task}`);
                    });

                    // Store current day's tasks in the user object for later use
                    user.currentDayTasks = currentDayTasks;
                } else {
                    console.log('\nNo tasks found for current day');
                    user.currentDayTasks = [];
                }
            } else {
                console.log(`  No schedule data available`);
            }
        });

        console.log(`\n[${now.toISOString()}] ===== CHECKING FOR DUE TASKS =====`);

        const targetDay = daysOfWeek[nextMinute.getDay()];
        const targetHour = nextMinute.getHours();
        const targetMinute = nextMinute.getMinutes();

        // Process each user
        for (const currentUser of users) {
            try {
                console.log(`[${now.toISOString()}] Processing user: ${currentUser.phone} (${currentUser.name || 'No name'})`);

                // Check both schedule and weeklySchedule fields
                let schedule = currentUser.weeklySchedule || currentUser.schedule;
                if (!schedule) {
                    console.log(`[${now.toISOString()}] No schedule found in weeklySchedule or schedule field`);
                    continue;  // Changed from return to continue since we're in a for...of loop
                }

                // If weeklySchedule is an array, convert it to the expected format
                if (Array.isArray(schedule)) {
                    console.log(`[${now.toISOString()}] Found array schedule with ${schedule.length} items`);
                    schedule = {
                        rows: schedule,
                        headers: [] // Add empty headers to match expected format
                    };
                } else if (schedule.rows && !Array.isArray(schedule.rows)) {
                    // If rows exists but isn't an array, convert it
                    console.log(`[${now.toISOString()}] Converting non-array rows to array`);
                    schedule.rows = [schedule.rows];
                } else if (!schedule.rows) {
                    // If no rows array, create one with the schedule object
                    console.log(`[${now.toISOString()}] No rows array found, creating one`);
                    schedule.rows = [schedule];
                }

                if (!schedule.rows || !Array.isArray(schedule.rows) || schedule.rows.length === 0) {
                    console.log(`[${now.toISOString()}] No valid schedule rows found`);
                    continue;
                }

                console.log(`[${now.toISOString()}] Processing schedule with ${schedule.rows.length} rows`);
                console.log(`[${now.toISOString()}] First row:`, JSON.stringify(schedule.rows[0]));

                // Process schedule rows as tasks
                let tasks = [];
                const daysMap = {};

                // Define days of week mapping (0=Sunday, 1=Monday, etc.)
                const dayToRowMap = [
                    0, // Monday = row 1
                    1, // Tuesday = row 2
                    2, // Wednesday = row 3
                    3, // Thursday = row 4
                    4, // Friday = row 5
                    5,  // Saturday = row 6
                    6
                ];

                // Get current day of week (0=Sunday, 1=Monday, etc.)
                const currentDayIndex = nextMinute.getDay();
                const targetRowIndex = dayToRowMap[currentDayIndex];

                // Check if schedule has rows and determine the format
                let isNewFormat = false;
                let currentDayRow = null;

                if (schedule && Array.isArray(schedule.rows) && schedule.rows.length > 0) {
                    // Get the row for the current day (0-based index)
                    currentDayRow = schedule.rows[targetRowIndex] || schedule.rows[0];

                    isNewFormat = typeof currentDayRow === 'object' &&
                        ('day' in currentDayRow ||
                            'Day' in currentDayRow ||
                            (currentDayRow.Time && currentDayRow.Task));

                    console.log(`[${now.toISOString()}] Using row ${targetRowIndex + 1} (${targetDay}) for tasks`);
                    console.log(`[${now.toISOString()}] Row data:`, JSON.stringify(currentDayRow));
                } else {
                    console.log(`[${now.toISOString()}] No valid schedule rows found for user ${currentUser.phone}`);
                    continue; // Skip to next user if no valid schedule rows
                }

                console.log(`[${now.toISOString()}] Format: ${isNewFormat ? 'New format' : 'Legacy format'}`);

                if (isNewFormat) {
                    console.log(`[${now.toISOString()}] Processing schedule in new format (${schedule.rows.length} rows)`);

                    // Process tasks from the current day's row
                    console.log(`[${now.toISOString()}] Processing tasks for ${targetDay} (row ${targetRowIndex + 1})`);

                    // Clear any previous tasks
                    tasks = [];

                    // If the row is an object with time and task properties
                    if (currentDayRow.time && currentDayRow.task) {
                        tasks.push({
                            day: targetDay,
                            time: currentDayRow.time,
                            task: currentDayRow.task
                        });
                    }
                    // If the row is an array of tasks (legacy format)
                    else if (Array.isArray(currentDayRow)) {
                        currentDayRow.forEach((task, index) => {
                            if (index > 0 && task) { // Skip first column (day name)
                                tasks.push({
                                    day: targetDay,
                                    time: schedule.headers && schedule.headers[index] ?
                                        schedule.headers[index] : `Task ${index}`,
                                    task: task
                                });
                            }
                        });
                    }
                    // Handle case sensitivity for property names
                    const day = (row.day || row.Day || '').charAt(0).toUpperCase() +
                        (row.day || row.Day || '').slice(1).toLowerCase();
                    const time = row.time || row.Time;
                    const task = row.task || row.Task || row.text || row.Text;

                    // Update row with normalized property names
                    row.day = day;
                    row.time = time;
                    row.task = task;

                    if (!day || !time || !task) {
                        console.log(`[${now.toISOString()}] Skipping incomplete row ${index}:`, JSON.stringify(row));
                        return false;
                    }
                    console.log(`[${now.toISOString()}] Processing row ${index + 1}:`, JSON.stringify(row));

                    // Check if we have all required fields with case-insensitive check
                    const hasDay = row.day || row.Day;
                    const hasTime = row.time || row.Time;
                    const hasTask = row.task || row.Task || row.text || row.Text;

                    if (!hasDay || !hasTime || !hasTask) {
                        console.log(`[${now.toISOString()}] Skipping row ${index + 1} due to missing fields:`, {
                            day: hasDay ? 'found' : 'missing',
                            time: hasTime ? 'found' : 'missing',
                            task: hasTask ? 'found' : 'missing'
                        });
                        return false;
                    }

                    // Check if this is for the target day
                    const isTargetDay = row.day.toLowerCase() === targetDay.toLowerCase();
                    console.log(`[${now.toISOString()}] Row ${index + 1} - Day check: ${row.day} ${isTargetDay ? '==' : '!='} ${targetDay}`);
                    if (!isTargetDay) return false;

                    try {
                        // Parse the time from the row
                        let timePart = row.time.trim();
                        let period = '';

                        // Handle different time formats
                        const periodMatch = timePart.match(/([0-9:]+)\s*([AP]M?)/i);
                        if (periodMatch) {
                            timePart = periodMatch[1].trim();
                            period = periodMatch[2].toUpperCase();
                            if (period === 'P') period = 'PM';
                            if (period === 'A') period = 'AM';
                            console.log(`[${now.toISOString()}] Row ${index + 1} - Extracted time: ${timePart}, period: ${period}`);
                        }

                        // Parse hours and minutes
                        const [hoursStr, minutesStr] = timePart.split(':');
                        let hours = parseInt(hoursStr, 10);
                        const minutes = parseInt(minutesStr || '0', 10);

                        if (isNaN(hours) || isNaN(minutes)) {
                            console.log(`[${now.toISOString()}] ❌ Invalid time format: ${row.time}`);
                            return false;
                        }

                        // Convert 12-hour to 24-hour format if needed
                        if (period) {
                            if (period === 'PM' && hours < 12) hours += 12;
                            if (period === 'AM' && hours === 12) hours = 0;
                        }

                        // Format time to match the target format (HH:MM)
                        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                        const targetTime = `${targetHour.toString().padStart(2, '0')}:${targetMinute.toString().padStart(2, '0')}`;

                        console.log(`[${now.toISOString()}] Row ${index + 1} - Time check: ${row.time} -> ${formattedTime} vs target ${targetTime}`);

                        // Check if the time matches the target time
                        const timeMatches = formattedTime === targetTime;
                        console.log(`[${now.toISOString()}] Row ${index + 1} - Time ${timeMatches ? 'matches' : 'does not match'}`);

                        if (timeMatches) {
                            // Check if this time exists in the current day's tasks
                            const currentDayTasks = tasks.filter(t => t.day.toLowerCase() === targetDay.toLowerCase());
                            const timeExists = currentDayTasks.some(task => {
                                const taskTime = task.time.split(' ')[0]; // Remove AM/PM if exists
                                const [taskHour, taskMinute] = taskTime.split(':').map(Number);
                                return taskHour === hours && taskMinute === minutes;
                            });

                            if (!timeExists) {
                                console.log(`[${now.toISOString()}] ❌ Time ${formattedTime} not found in current day's tasks`);
                                return false;
                            }
                            console.log(`[${now.toISOString()}] ✓ Time ${formattedTime} found in current day's tasks`);
                        }

                        return timeMatches;
                    } catch (error) {
                        console.error(`[${now.toISOString()}] Error parsing time '${row.time}':`, error);
                        return false;
                    }


                    // Build the daysMap for logging and log all tasks
                    const daysWithTasks = new Set();
                    console.log(`[${now.toISOString()}] All tasks for ${user.phone}:`);

                    schedule.rows.forEach((row, index) => {
                        if (row.day && row.time && row.task) {
                            if (!daysMap[row.day]) {
                                daysMap[row.day] = [];
                            }
                            const taskInfo = {
                                time: row.time,
                                task: row.task,
                                rowIndex: index
                            };
                            daysMap[row.day].push(taskInfo);
                            daysWithTasks.add(row.day);

                            // Log each task with its details
                            console.log(`[${now.toISOString()}] Task ${index + 1}: ${row.day} ${row.time} - ${row.task}`);
                        }
                    });

                    // Log summary of tasks by day
                    console.log(`[${now.toISOString()}] Task summary for ${user.phone}:`);
                    console.log(`- Total tasks: ${schedule.rows.length}`);
                    console.log(`- Days with tasks: ${Array.from(daysWithTasks).join(', ')}`);
                    daysWithTasks.forEach(day => {
                        console.log(`- ${day}: ${daysMap[day].length} tasks`);
                    });

                    // Log tasks due at the target time
                    if (tasks.length > 0) {
                        console.log(`\n[${now.toISOString()}] ✅ Found ${tasks.length} tasks due at ${targetHour}:${targetMinute.toString().padStart(2, '0')}:`);
                        tasks.forEach((task, i) => {
                            console.log(`  ${i + 1}. ${task.day} ${task.time} - ${task.task}`);
                        });
                    } else {
                        console.log(`\n[${now.toISOString()}] ℹ️ No tasks found due at ${targetHour}:${targetMinute.toString().padStart(2, '0')}`);
                    }
                } else {
                    console.log(`[${now.toISOString()}] Processing schedule in legacy format (rows as arrays)`);
                    // Keep the old processing logic for backward compatibility
                    // ... (existing code for old format)
                }

                console.log(`\n[${now.toISOString()}] === ALL TASKS FOR USER ${currentUser.phone} ===`);

                // Initialize daysMap with all days of the week
                const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                daysOrder.forEach(day => {
                    if (!daysMap[day]) {
                        daysMap[day] = [];
                    }
                });

                // Debug log the schedule structure
                console.log(`[${now.toISOString()}] Schedule structure:`, JSON.stringify({
                    hasRows: !!schedule.rows,
                    rowsCount: schedule.rows ? schedule.rows.length : 0,
                    firstFewRows: schedule.rows ? schedule.rows.slice(0, 3) : 'no rows',
                    scheduleKeys: Object.keys(schedule)
                }, null, 2));

                // Process all tasks from the schedule
                if (schedule.rows && Array.isArray(schedule.rows)) {
                    console.log(`[${now.toISOString()}] Found ${schedule.rows.length} rows in schedule`);

                    // Log the structure of all rows to understand the data format
                    console.log(`[${now.toISOString()}] All rows structure:`);
                    schedule.rows.forEach((row, index) => {
                        console.log(`[${now.toISOString()}] Row ${index}:`, {
                            keys: Object.keys(row),
                            values: row
                        });
                    });

                    schedule.rows.forEach((row, index) => {
                        // Try different possible field names for task data
                        const taskText = row.task || row.Task || row.text || row.Text || row[2] || '';
                        const dayValue = row.day || row.Day || row[0] || '';
                        const timeValue = row.time || row.Time || row[1] || '';

                        const hasDay = !!dayValue;
                        const hasTime = !!timeValue;
                        const hasTask = !!taskText;

                        if (hasDay && hasTime && hasTask) {
                            // Format day (capitalize first letter)
                            const day = dayValue.toString().charAt(0).toUpperCase() +
                                dayValue.toString().slice(1).toLowerCase();

                            if (!daysMap[day]) {
                                daysMap[day] = [];
                            }

                            const taskObj = {
                                time: timeValue.toString().trim(),
                                task: taskText.toString().trim(),
                                rowIndex: index
                            };

                            daysMap[day].push(taskObj);
                            console.log(`[${now.toISOString()}] Added task: ${day} ${taskObj.time} - ${taskObj.task}`);
                        }
                    });
                } else {
                    console.log(`[${now.toISOString()}] No valid rows found in schedule`);
                    console.log(`[${now.toISOString()}] Schedule structure:`, {
                        hasRows: !!schedule.rows,
                        rowsIsArray: Array.isArray(schedule.rows),
                        rowsCount: schedule.rows ? schedule.rows.length : 0
                    });
                }
                // Schedule tasks processing (logging removed as requested)

                // Map day names to row indices (0 = Monday, 1 = Tuesday, ..., 6 = Sunday)
                const dayToRowIndex = {
                    'monday': 0,
                    'tuesday': 1,
                    'wednesday': 2,
                    'thursday': 3,
                    'friday': 4,
                    'saturday': 5,
                    'sunday': 6
                };

                // Get the row index for the target day (case-insensitive)
                const targetDayLower = targetDay.toLowerCase();
                const rowIndex = dayToRowIndex[targetDayLower];

                if (rowIndex === undefined || rowIndex >= schedule.rows.length) {
                    console.log(`[${now.toISOString()}] Day '${targetDay}' is not found or out of range for user ${currentUser.phone}`);
                    continue;
                }

                const daySchedule = schedule.rows[rowIndex];
                if (!Array.isArray(daySchedule)) {
                    console.log(`[${now.toISOString()}] Day schedule for ${targetDay} is not an array for user ${currentUser.phone}`);
                    continue;
                }

                // Debug: Log the schedule structure
                console.log(`[${now.toISOString()}] Debug - Schedule structure for ${currentUser.phone}:`, {
                    headers: schedule.headers,
                    rows: schedule.rows,
                    targetDay,
                    rowIndex,
                    daySchedule: daySchedule,
                    dayScheduleLength: daySchedule.length,
                    allDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                });

                // First, process all time slots to ensure we don't miss any
                const timeSlots = [];

                // Parse all time slots first
                for (let col = 0; col < schedule.headers.length; col++) {
                    const timeString = schedule.headers[col];
                    if (!timeString) continue;

                    try {
                        // Parse the time (format: "HH:MM AM/PM" or "HH:MM" or "H:MM" or "H:MM AM/PM")
                        let timePart = timeString.trim();
                        let period = '';

                        // Check if we have AM/PM indicator
                        const periodMatch = timePart.match(/([0-9:]+)\s*([AP]M?)/i);
                        if (periodMatch) {
                            timePart = periodMatch[1].trim();
                            period = periodMatch[2].toUpperCase();
                            // Handle both 'PM' and 'P' formats
                            if (period === 'P') period = 'PM';
                            if (period === 'A') period = 'AM';
                        }

                        // Parse hours and minutes
                        const [hoursStr, minutesStr] = timePart.split(':');
                        let hours = parseInt(hoursStr, 10);
                        const minutes = parseInt(minutesStr || '0', 10);

                        // Convert 12-hour to 24-hour format if needed
                        if (period) {
                            if (period === 'PM' && hours < 12) hours += 12;
                            if (period === 'AM' && hours === 12) hours = 0;
                        } else if (hours <= 12) {
                            // Handle ambiguous times without AM/PM
                            if (hoursStr.length <= 2) {
                                // Assume 24-hour format for 1-2 digit hours without AM/PM
                                // No conversion needed
                            }
                        }

                        // Validate hours and minutes
                        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                            console.log(`[${now.toISOString()}] Invalid time format: ${timeString} for user ${currentUser.phone}`);
                            continue;
                        }

                        const taskText = (daySchedule[col] || '').toString().trim();
                        timeSlots.push({
                            col,
                            hours,
                            minutes,
                            timeString: timeString.trim(),
                            hasTask: !!taskText,
                            taskText: taskText || 'NO TASK'
                        });

                        // Debug log for each time slot
                        console.log(`[${now.toISOString()}] Time slot ${timeString.trim()} - Task: "${taskText || 'EMPTY'}"`);
                    } catch (error) {
                        console.error(`[${now.toISOString()}] Error parsing time slot ${timeString} for user ${currentUser.phone}:`, error);
                    }
                }

                // Sort time slots by time to ensure correct order
                timeSlots.sort((a, b) => {
                    if (a.hours !== b.hours) return a.hours - b.hours;
                    return a.minutes - b.minutes;
                });

                try {
                    // Process each time slot in order
                    for (const slot of timeSlots) {
                        const {col, hours, minutes, timeString} = slot;

                        // Check if this time matches the target time (next minute)
                        if (hours === targetHour && minutes === targetMinute) {
                            const taskText = (daySchedule[col] || '').toString().trim();
                            const timeStr = `${hours}:${minutes < 10 ? '0' + minutes : minutes}`;

                            if (taskText) {
                                console.log(`[${now.toISOString()}] Sending reminder to ${currentUser.phone} for task at ${timeStr}: ${taskText}`);
                            } else {
                                console.log(`[${now.toISOString()}] Time slot ${timeStr} is empty for user ${currentUser.phone}`);
                                continue; // Skip empty tasks
                            }

                            // Set due time to 1 minute from now
                            const dueTime = new Date();
                            dueTime.setMinutes(dueTime.getMinutes() + 1);

                            const dueTimeStr = dueTime.toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                            });
                            const dueDateStr = dueTime.toLocaleDateString();
                            const triggeredDateTime = `${dueDateStr} at ${dueTimeStr}`;

                            // Send the reminder using the template with current time
                            const success = await sendWhatsAppReminder(
                                currentUser.phone,
                                taskText,
                                triggeredDateTime
                            );

                            if (success) {
                                console.log(`[${now.toISOString()}] WhatsApp reminder sent to ${currentUser.phone} for ${timeStr}`);
                            } else {
                                console.error(`[${now.toISOString()}] Failed to send WhatsApp reminder to ${currentUser.phone}`);
                            }
                        } else {
                            // Debug log to show why a time slot was skipped
                            console.log(`[${now.toISOString()}] Time slot ${hours}:${minutes < 10 ? '0' + minutes : minutes} does not match target time ${targetHour}:${targetMinute < 10 ? '0' + targetMinute : targetMinute}`);
                        }
                    }
                } catch (timeError) {
                    console.error(`[${now.toISOString()}] Error processing time slot for user ${currentUser?.phone || 'unknown'}:`, timeError);
                }
            } catch (userError) {
                console.error(`[${now.toISOString()}] Error processing user ${currentUser?.phone || 'unknown'}:`, userError);
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in schedule reminder job:`, error);
    }

});

// =====================
// MONGODB CONNECTION HANDLER
// =====================
const startMongoDB = () => {
    console.log('🔌 Attempting to connect to MongoDB...');

    mongoose.connect(config.mongoUri, config.mongoOptions)
        .then(() => {
            console.log('✅ MongoDB connected successfully');
        })
        .catch(err => {
            console.error('❌ MongoDB connection error:', err.message);
            console.log('🔄 Attempting to start MongoDB service...');

            // Try to start MongoDB service
            exec('net start MongoDB', (error) => {
                if (error) {
                    console.error('❌ Failed to start MongoDB service:', error.message);
                    console.log('\n📌 Please start MongoDB manually by following these steps:');
                    console.log('1. Open Command Prompt as Administrator');
                    console.log('2. Run this command:');
                    console.log('   "C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe" --dbpath="C:\\Program Files\\MongoDB\\Server\\7.0\\data\\db"');
                    console.log('3. Keep the Command Prompt window open while using MongoDB\n');
                } else {
                    console.log('✅ MongoDB service started successfully');
                    // Retry connection after service starts
                    setTimeout(startMongoDB, 2000);
                }
            });
        });
};

// Handle MongoDB connection events
mongoose.connection.on('connecting', () => {
    console.log(' Connecting to MongoDB...');
});

mongoose.connection.on('connected', () => {
    console.log(' MongoDB connected successfully');
    // Run migration after successful connection
    runMigration().catch(console.error);
});

// Migration function to update task references
async function runMigration() {
    try {
        const tasksToMigrate = await Task.find({ userId: { $exists: false }, userPhone: { $exists: true } });
        let migratedCount = 0;

        if (tasksToMigrate.length > 0) {
            console.log(`Found ${tasksToMigrate.length} tasks to migrate...`);

            for (const task of tasksToMigrate) {
                const user = await User.findOne({phone: task.userPhone});
                if (user) {
                    task.userId = user._id;
                    task.userPhone = undefined;
                    await task.save();
                    migratedCount++;
                }
            }
            console.log(`✅ Migration complete. ${migratedCount} tasks updated.`);
        } else {
            console.log('No tasks needed migration.');
        }
    } catch (error) {
        console.error('❌ Migration failed:', error);
    }
}

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('\n🔧 Troubleshooting steps:');
    console.log('1. Make sure MongoDB is running in a separate terminal window');
    console.log('2. If not, start it with this command:');
    console.log('   "C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe" --dbpath="C:\\data\\db"');
    console.log('3. Check if the connection URL is correct:', config.mongoUri);
    console.log('4. If you changed the default port, update the MONGO_URI in .env file');
    console.log('5. Make sure the MongoDB service is running and accessible\n');
});

// Serve the dashboard for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'existing-user-dashboard.html'));
});

// Start MongoDB connection when server starts
startMongoDB();

// Start the server
server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n=== ${config.app.name} v${config.app.version} ===`);
    console.log(`✅ Server running on port ${config.port}`);
    console.log('==============================\n');
    console.log('Available endpoints:');
    console.log(`- http://localhost:${config.port}/`);
    console.log(`- http://localhost:${config.port}/dashboard`);
    console.log(`- http://localhost:${config.port}/api/status`);
    console.log('==============================\n');

    // Run migration after server starts
    if (mongoose.connection.readyState === 1) {
        runMigration();
    }
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${config.port} is already in use.`);
        console.log('Please close the program using this port or use a different port.');
        console.log('You can find and kill the process using these commands:');
        console.log('1. Find the process ID:');
        console.log(`   netstat -ano | findstr :${config.port}`);
        console.log('2. Kill the process (replace PID):');
        console.log('   taskkill /F /PID <PID>\n');
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server has been stopped.');
        process.exit(0);
    });
});
