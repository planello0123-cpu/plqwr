const mongoose = require('mongoose');
require('dotenv').config();

async function checkTasks() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Get the database connection
    const db = mongoose.connection.db;
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    // Check if tasks collection exists
    const tasksCollection = collections.find(c => c.name === 'tasks');
    
    if (tasksCollection) {
      console.log('Tasks collection exists. Fetching tasks...');
      const tasks = await db.collection('tasks').find({}).toArray();
      console.log(`Found ${tasks.length} tasks in the database:`);
      console.log(JSON.stringify(tasks, null, 2));
      
      // Get users collection
      const users = await db.collection('users').find({}).toArray();
      console.log(`\nFound ${users.length} users in the database:`);
      console.log(JSON.stringify(users.map(u => ({
        _id: u._id,
        phone: u.phone,
        name: u.name,
        notificationSettings: u.notificationSettings
      })), null, 2));
    } else {
      console.log('Tasks collection does not exist.');
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error checking tasks:', error);
    process.exit(1);
  }
}

checkTasks();
