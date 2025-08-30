const express = require('express');
const router = express.Router();
const User = require('./models/User');

// Debug endpoint to check task data
router.get('/debug/task', async (req, res) => {
    try {
        const { phone, time } = req.query;
        
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const schedule = user.weeklySchedule || user.schedule;
        if (!schedule) {
            return res.status(404).json({ error: 'No schedule found for user' });
        }

        // Get current day of week (0=Sunday, 1=Monday, etc.)
        const now = new Date();
        const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const currentDay = daysOfWeek[now.getDay()];
        
        // Find the current day's row
        const dayRow = schedule.rows.find(row => 
            (row.day || row.Day || '').toLowerCase() === currentDay.toLowerCase()
        );

        if (!dayRow) {
            return res.json({
                success: false,
                message: `No schedule found for ${currentDay}`,
                currentDay,
                scheduleKeys: Object.keys(schedule),
                rowsCount: schedule.rows ? schedule.rows.length : 0
            });
        }

        // If time is provided, find the task at that time
        let taskInfo = null;
        if (time) {
            const [hours, minutes] = time.split(':').map(Number);
            const timeSlots = [];
            
            // Process time slots from headers
            if (schedule.headers) {
                schedule.headers.forEach((header, index) => {
                    if (header) {
                        const [h, m] = header.split(':').map(Number);
                        timeSlots.push({
                            col: index,
                            hours: h,
                            minutes: m || 0,
                            timeString: header
                        });
                    }
                });
            }

            // Find matching time slot
            const slot = timeSlots.find(slot => 
                slot.hours === hours && slot.minutes === minutes
            );

            if (slot && dayRow[slot.col] !== undefined) {
                taskInfo = {
                    time: `${hours}:${minutes < 10 ? '0' + minutes : minutes}`,
                    text: dayRow[slot.col],
                    column: slot.col
                };
            }
        }

        res.json({
            success: true,
            currentTime: now.toISOString(),
            currentDay,
            taskInfo,
            dayRow,
            scheduleHeaders: schedule.headers,
            timeSlots: schedule.headers ? schedule.headers.map((h, i) => ({
                header: h,
                column: i,
                value: dayRow[i]
            })) : []
        });

    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
