const mongoose = require('mongoose');
const Task = require('./models/Task');
require('dotenv').config();

// Import the server to get access to the User model
require('./server');

// Get the User model after requiring the server
const User = mongoose.model('User');

async function enableWhatsAppAndCreateTestTask() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get all users
    const users = await User.find({});
    console.log(`Found ${users.length} users.`);

    // Enable WhatsApp notifications for all users
    const updateResult = await User.updateMany(
      {},
      { $set: { 'notificationSettings.whatsapp': true } }
    );
    console.log(`Updated ${updateResult.modifiedCount} users to enable WhatsApp notifications.`);

    // Get the first user to create a test task for
    const testUser = users[0];
    if (!testUser) {
      console.log('No users found in the database. Please create a user first.');
      process.exit(1);
    }

    // Create a test task due in 1 minute
    const now = new Date();
    const dueDate = new Date(now.getTime() + 1 * 60 * 1000); // 1 minute from now

    const testTask = new Task({
      userId: testUser._id,
      text: 'Test Reminder - Please ignore',
      priority: 'medium',
      completed: false,
      reminderSent: false,
      oneMinuteReminderSent: false,
      dueDate: dueDate,
      reminderTime: dueDate,
      category: 'test',
      createdAt: new Date()
    });

    await testTask.save();
    console.log('Created test task with the following details:');
    console.log({
      userId: testUser._id,
      phone: testUser.phone,
      task: testTask.text,
      dueDate: dueDate.toLocaleString(),
      _id: testTask._id
    });

    console.log('\nNext steps:');
    console.log(`1. Wait for the task to be due at ${dueDate.toLocaleTimeString()}`);
    console.log('2. Check the server logs for any reminder processing');
    console.log('3. The task should be found and a WhatsApp reminder should be sent');

    // Close the connection
    await mongoose.connection.close();
    console.log('\nConnection closed. You can now run your server to test the reminders.');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the function
enableWhatsAppAndCreateTestTask();
