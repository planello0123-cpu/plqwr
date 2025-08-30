const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const uri = process.env.MONGO_URI;
  const client = new MongoClient(uri);

  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db();
    
    // Enable WhatsApp notifications for all users
    const usersCollection = db.collection('users');
    const updateResult = await usersCollection.updateMany(
      {},
      { $set: { 'notificationSettings.whatsapp': true } }
    );
    console.log(`Updated ${updateResult.modifiedCount} users to enable WhatsApp notifications.`);

    // Get the first user to create a test task for
    const testUser = await usersCollection.findOne({});
    if (!testUser) {
      console.log('No users found in the database. Please create a user first.');
      process.exit(1);
    }

    // Create a test task due in 1 minute
    const now = new Date();
    const dueDate = new Date(now.getTime() + 1 * 60 * 1000); // 1 minute from now

    const testTask = {
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
    };

    // Insert the test task
    const tasksCollection = db.collection('tasks');
    const insertResult = await tasksCollection.insertOne(testTask);
    
    console.log('\n✅ Successfully created test task with the following details:');
    console.log({
      userId: testUser._id,
      phone: testUser.phone,
      task: testTask.text,
      dueDate: dueDate.toLocaleString(),
      _id: insertResult.insertedId
    });

    console.log('\n📝 Next steps:');
    console.log(`1. The task is set to be due at: ${dueDate.toLocaleTimeString()}`);
    console.log('2. The cron job will check for due tasks every minute');
    console.log('3. Check your server logs for messages like "Found X tasks due soon"');
    console.log('4. If WhatsApp is configured, you should receive a reminder');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the function
main().catch(console.error);
