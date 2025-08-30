const { MongoClient } = require('mongodb');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});
require('dotenv').config();

async function createTaskWithTime() {
  const uri = process.env.MONGO_URI;
  const client = new MongoClient(uri);

  try {
    // Get time input from user
    readline.question('Enter the time in 24-hour format (e.g., 13:09): ', async (timeInput) => {
      // Validate time format (HH:MM)
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(timeInput)) {
        console.error('❌ Invalid time format. Please use HH:MM format (e.g., 13:09)');
        process.exit(1);
      }

      // Parse hours and minutes
      const [hours, minutes] = timeInput.split(':').map(Number);
      
      // Create date object for today with the specified time
      const now = new Date();
      const dueDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
        0,
        0
      );

      // If the time has already passed today, set it for tomorrow
      if (dueDate <= now) {
        console.log('⚠️  The specified time has already passed today. Setting for tomorrow.');
        dueDate.setDate(dueDate.getDate() + 1);
      }

      try {
        // Connect to MongoDB
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db();
        const usersCollection = db.collection('users');
        
        // Get the first user
        const testUser = await usersCollection.findOne({});
        if (!testUser) {
          console.log('❌ No users found in the database. Please create a user first.');
          process.exit(1);
        }

        // Create the task
        const task = {
          userId: testUser._id,
          text: `Reminder set for ${timeInput}`,
          priority: 'medium',
          completed: false,
          reminderSent: false,
          oneMinuteReminderSent: false,
          dueDate: dueDate,
          reminderTime: dueDate,
          category: 'reminder',
          createdAt: new Date()
        };

        // Insert the task
        const tasksCollection = db.collection('tasks');
        const result = await tasksCollection.insertOne(task);
        
        console.log('\n🎉 Successfully created task:');
        console.log('----------------------------');
        console.log(`Task ID: ${result.insertedId}`);
        console.log(`Text: ${task.text}`);
        console.log(`Due Date: ${dueDate.toLocaleString()}`);
        console.log(`User: ${testUser.phone} (${testUser.name || 'No name'})`);
        console.log('\nℹ️  The task will trigger a reminder at the specified time.');
        
      } catch (error) {
        console.error('❌ Error:', error);
      } finally {
        await client.close();
        readline.close();
      }
    });
  } catch (error) {
    console.error('❌ Error:', error);
    await client.close();
    readline.close();
  }
}

// Run the function
console.log('📅 Task Creator - Set a reminder for a specific time');
console.log('------------------------------------------------');
createTaskWithTime();
