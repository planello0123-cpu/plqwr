const mongoose = require('mongoose');
require('dotenv').config();

// Configuration
const config = {
    mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/planello',
    mongoOptions: {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    },
};

// Connect to MongoDB
async function connectToDatabase() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(config.mongoUri, config.mongoOptions);
        console.log('Successfully connected to MongoDB');
        return true;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error.message);
        return false;
    }
}

// Define the User model
const userSchema = new mongoose.Schema({
    email: { type: String },
    phone: { type: String },
    name: { type: String },
    isVerified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Function to remove all users
async function removeAllUsers() {
    try {
        // Get count of users before deletion
        const count = await User.countDocuments();
        
        if (count === 0) {
            console.log('No users found in the database.');
            return { success: true, deletedCount: 0 };
        }
        
        // Ask for confirmation
        console.log(`\nWARNING: This will delete ALL ${count} users from the database.`);
        console.log('This action cannot be undone.\n');
        
        // Simulate a confirmation prompt
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        return new Promise((resolve) => {
            readline.question('Are you sure you want to continue? (yes/no): ', async (answer) => {
                readline.close();
                
                if (answer.toLowerCase() !== 'yes') {
                    console.log('Operation cancelled.');
                    resolve({ success: false, message: 'Operation cancelled by user' });
                    return;
                }
                
                // Proceed with deletion
                console.log('Deleting all users...');
                const result = await User.deleteMany({});
                
                console.log(`Successfully deleted ${result.deletedCount} users.`);
                resolve({ 
                    success: true, 
                    deletedCount: result.deletedCount 
                });
            });
        });
        
    } catch (error) {
        console.error('Error removing users:', error.message);
        return { success: false, error: error.message };
    }
}

// Main function
async function main() {
    const connected = await connectToDatabase();
    if (!connected) {
        process.exit(1);
    }
    
    try {
        await removeAllUsers();
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        // Close the connection
        await mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { removeAllUsers };
