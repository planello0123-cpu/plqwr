// Notification and OTP Component for Planello
class NotificationManager {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.init();
    }

    async init() {
        await this.loadUserData();
        this.setupSocketConnection();
        this.requestNotificationPermission();
        this.createNotificationUI();
    }

    async loadUserData() {
        const token = localStorage.getItem('authToken');
        if (!token) {
            this.currentUser = null;
            return;
        }
        try {
            const response = await fetch('/api/user-profile', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
            } else {
                this.currentUser = null;
                localStorage.removeItem('authToken');
            }
        } catch (error) {
            this.currentUser = null;
            localStorage.removeItem('authToken');
            console.error('Error fetching user profile:', error);
        }
    }

    setupSocketConnection() {
        // Connect to Socket.IO server
    this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to notification server');
            if (this.currentUser) {
                this.socket.emit('join', this.currentUser.id);
            }
        });

        this.socket.on('notification', (data) => {
            this.showNotification(data.message, 'info');
        });

        this.socket.on('taskReminder', (data) => {
            if (data.oneMinute) {
                this.showNotification(`Task "${data.task}" is due in 1 minute!`, 'warning');
                if (Notification.permission === 'granted') {
                    new Notification('1 Minute Reminder', {
                        body: `Task "${data.task}" is due in 1 minute!`,
                        icon: '/favicon.ico'
                    });
                }
            } else {
                this.showNotification(`Task reminder: ${data.task} is due soon!`, 'info');
                if (Notification.permission === 'granted') {
                    new Notification('Task Reminder', {
                        body: `${data.task} is due soon!`,
                        icon: '/favicon.ico'
                    });
                }
            }
        });
    }

    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    createNotificationUI() {
        // Create notification button in the header
        const header = document.querySelector('.header-content');
        if (header) {
            const notificationBtn = document.createElement('button');
            notificationBtn.className = 'notification-btn';
            notificationBtn.innerHTML = '<i class="fas fa-bell"></i>';
            notificationBtn.onclick = () => this.showNotificationPanel();
            header.appendChild(notificationBtn);
        }

        // Add notification styles
        this.addNotificationStyles();
    }

    addNotificationStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .notification-btn {
                background: var(--primary-color);
                color: white;
                border: none;
                padding: 0.5rem;
                border-radius: 50%;
                cursor: pointer;
                margin-left: 1rem;
                transition: all 0.3s ease;
            }
            
            .notification-btn:hover {
                background: var(--primary-hover);
                transform: scale(1.1);
            }
            
            .notification-panel {
                position: fixed;
                top: 0;
                right: -400px;
                width: 400px;
                height: 100vh;
                background: var(--card-bg);
                box-shadow: -5px 0 15px rgba(0,0,0,0.1);
                transition: right 0.3s ease;
                z-index: 1000;
                overflow-y: auto;
            }
            
            .notification-panel.open {
                right: 0;
            }
            
            .notification-header {
                padding: 1rem;
                border-bottom: 1px solid var(--border-color);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .notification-content {
                padding: 1rem;
            }
            
            .otp-section {
                margin-bottom: 2rem;
                padding: 1rem;
                background: var(--bg-secondary);
                border-radius: 8px;
            }
            
            .otp-input {
                width: 100%;
                padding: 0.5rem;
                margin: 0.5rem 0;
                border: 1px solid var(--border-color);
                border-radius: 4px;
            }
            
            .otp-btn {
                background: var(--primary-color);
                color: white;
                border: none;
                padding: 0.5rem 1rem;
                border-radius: 4px;
                cursor: pointer;
                margin: 0.25rem;
            }
            
            .otp-btn:hover {
                background: var(--primary-hover);
            }
            
            .status-message {
                padding: 0.5rem;
                border-radius: 4px;
                margin: 0.5rem 0;
                font-size: 0.9rem;
            }
            
            .status-success {
                background: #d1fae5;
                color: #065f46;
            }
            
            .status-error {
                background: #fee2e2;
                color: #991b1b;
            }
            
            .status-info {
                background: #dbeafe;
                color: #1e40af;
            }
        `;
        document.head.appendChild(style);
    }

    showNotificationPanel() {
        // Create notification panel
        const panel = document.createElement('div');
        panel.className = 'notification-panel';
        panel.innerHTML = `
            <div class="notification-header">
                <h3><i class="fas fa-bell"></i> Notifications & OTP</h3>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
            </div>
            <div class="notification-content">
                <div class="otp-section">
                    <h4>Email Verification</h4>
                    <input type="email" id="emailOtpInput" class="otp-input" placeholder="Enter email" value="${this.currentUser?.email || ''}">
                    <button class="otp-btn" onclick="notificationManager.sendEmailOTP()">Send Email OTP</button>
                    <input type="text" id="emailOtpCode" class="otp-input" placeholder="Enter 6-digit code" maxlength="6">
                    <button class="otp-btn" onclick="notificationManager.verifyEmailOTP()">Verify Email</button>
                </div>
                
                <div class="otp-section">
                    <h4>WhatsApp Verification</h4>
                    <input type="tel" id="waOtpInput" class="otp-input" placeholder="Enter phone number" value="${this.currentUser?.phone || ''}">
                    <button class="otp-btn" onclick="notificationManager.sendWhatsAppOTP()">Send WhatsApp OTP</button>
                    <input type="text" id="waOtpCode" class="otp-input" placeholder="Enter 6-digit code" maxlength="6">
                    <button class="otp-btn" onclick="notificationManager.verifyWhatsAppOTP()">Verify WhatsApp</button>
                </div>
                
                <div class="otp-section">
                    <h4>Test Notifications</h4>
                    <button class="otp-btn" onclick="notificationManager.testEmailNotification()">Test Email</button>
                    <button class="otp-btn" onclick="notificationManager.testWhatsAppNotification()">Test WhatsApp</button>
                    <button class="otp-btn" onclick="notificationManager.testPushNotification()">Test Push</button>
                </div>
                
                <div id="notificationStatus"></div>
            </div>
        `;

        document.body.appendChild(panel);
        setTimeout(() => panel.classList.add('open'), 100);
    }

    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('notificationStatus');
        if (statusDiv) {
            statusDiv.className = `status-message status-${type}`;
            statusDiv.textContent = message;

            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = '';
            }, 5000);
        }

        // Also show browser notification
        if (Notification.permission === 'granted') {
            new Notification('Planello', {
                body: message,
                icon: '/favicon.ico'
            });
        }
    }

    async sendEmailOTP() {
        const email = document.getElementById('emailOtpInput').value;
        if (!email) {
            this.showStatus('Please enter your email address', 'error');
            return;
        }

        try {
            const response = await fetch('/api/send-email-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (data.success) {
                this.showStatus('Email OTP sent successfully! Check your inbox.', 'success');
            } else {
                this.showStatus(data.message || 'Failed to send email OTP', 'error');
            }
        } catch (error) {
            this.showStatus('Error sending email OTP', 'error');
            console.error('Error:', error);
        }
    }

    async verifyEmailOTP() {
        const email = document.getElementById('emailOtpInput').value;
        const otp = document.getElementById('emailOtpCode').value;
        if (!email || !otp) {
            this.showStatus('Please enter both email and OTP', 'error');
            return;
        }
        try {
            const response = await fetch('/api/verify-email-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp })
            });
            const data = await response.json();
            if (data.success) {
                this.showStatus('Email verified successfully!', 'success');
                if (data.token) {
                    localStorage.setItem('authToken', data.token);
                    await this.loadUserData();
                }
            } else {
                this.showStatus(data.message || 'Invalid OTP', 'error');
            }
        } catch (error) {
            this.showStatus('Error verifying email OTP', 'error');
            console.error('Error:', error);
        }
    }

    async sendWhatsAppOTP() {
        const phone = document.getElementById('waOtpInput').value;
        if (!phone) {
            this.showStatus('Please enter your phone number', 'error');
            return;
        }
        try {
            const response = await fetch('/api/send-whatsapp-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await response.json();
            if (data.success) {
                this.showStatus('WhatsApp OTP sent successfully! Check your WhatsApp.', 'success');
            } else {
                this.showStatus(data.message || 'Failed to send WhatsApp OTP', 'error');
            }
        } catch (error) {
            this.showStatus('Error sending WhatsApp OTP', 'error');
            console.error('Error:', error);
        }
    }

    async verifyWhatsAppOTP() {
        const phone = document.getElementById('waOtpInput').value;
        const otp = document.getElementById('waOtpCode').value;
        if (!phone || !otp) {
            this.showStatus('Please enter both phone number and OTP', 'error');
            return;
        }
        try {
            const response = await fetch('/api/verify-whatsapp-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, otp })
            });
            const data = await response.json();
            if (data.success) {
                this.showStatus('WhatsApp verified successfully!', 'success');
                if (data.token) {
                    localStorage.setItem('authToken', data.token);
                    await this.loadUserData();
                }
            } else {
                this.showStatus(data.message || 'Invalid OTP', 'error');
            }
        } catch (error) {
            this.showStatus('Error verifying WhatsApp OTP', 'error');
            console.error('Error:', error);
        }
    }

    async testEmailNotification() {
        if (!this.currentUser) {
            this.showStatus('Please log in first', 'error');
            return;
        }

        try {
            const response = await fetch('/api/send-notification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    userId: this.currentUser.id,
                    type: 'test',
                    message: 'This is a test email notification from Planello!'
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showStatus('Test email notification sent!', 'success');
            } else {
                this.showStatus('Failed to send test notification', 'error');
            }
        } catch (error) {
            this.showStatus('Error sending test notification', 'error');
            console.error('Error:', error);
        }
    }

    async testWhatsAppNotification() {
        if (!this.currentUser) {
            this.showStatus('Please log in first', 'error');
            return;
        }
        try {
            const response = await fetch('/api/send-notification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    userId: this.currentUser.id,
                    type: 'test',
                    message: 'This is a test WhatsApp notification from Planello!'
                })
            });
            const data = await response.json();
            if (data.success) {
                this.showStatus('Test WhatsApp notification sent!', 'success');
            } else {
                this.showStatus('Failed to send test notification', 'error');
            }
        } catch (error) {
            this.showStatus('Error sending test notification', 'error');
            console.error('Error:', error);
        }
    }

    testPushNotification() {
        if (!('Notification' in window)) {
            this.showStatus('Push notifications not supported in this browser', 'error');
            return;
        }

        if (Notification.permission === 'granted') {
            new Notification('Planello Test', {
                body: 'This is a test push notification!',
                icon: '/favicon.ico'
            });
            this.showStatus('Test push notification sent!', 'success');
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    this.testPushNotification();
                }
            });
        } else {
            this.showStatus('Push notification permission denied', 'error');
        }
    }
}

// Initialize notification manager when DOM is loaded
let notificationManager;
document.addEventListener('DOMContentLoaded', async () => {
    notificationManager = new NotificationManager();
    if (notificationManager.init) await notificationManager.init();
});
