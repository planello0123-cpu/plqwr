// Add escapeHtml as a global utility function
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- MongoDB-backed TaskManager ---
class TaskManager {
    async saveEdit() {
        if (!this.editingTaskId) return;
        const newText = this.editTaskInput.value.trim();
        const newPriority = this.editPrioritySelect ? this.editPrioritySelect.value : 'medium';
        if (!newText) return;
        // Update on server
        const res = await fetch(`/api/tasks/${this.editingTaskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText, priority: newPriority })
        });
        const updatedTask = await res.json();
        this.tasks = this.tasks.map(t => t._id === this.editingTaskId ? updatedTask : t);
        this.closeEditModal();
        this.renderTasks();
        this.updateStats();
    }
    editTask(id) {
        const task = this.tasks.find(t => t._id === id);
        if (!task) return;
        this.editingTaskId = id;
        this.editTaskInput.value = task.text;
        if (this.editPrioritySelect) this.editPrioritySelect.value = task.priority || 'medium';
        this.showEditModal();
    }
    constructor() {
        this.phone = localStorage.getItem('currentUserPhone') || null;
        this.tasks = [];
        this.initializeElements();
        this.bindEvents();
        this.loadTasks();
    }
    // Persist tasks to localStorage (for offline support and better UX)
    saveTasks() {
        try {
            const tasksToSave = this.tasks.map(task => ({
                _id: task._id,
                text: task.text,
                priority: task.priority,
                completed: task.completed,
                dueDate: task.dueDate,
                reminderTime: task.reminderTime,
                createdAt: task.createdAt
            }));

            // Save to localStorage with a timestamp
            const saveData = {
                tasks: tasksToSave,
                lastUpdated: new Date().toISOString(),
                phone: this.phone
            };

            localStorage.setItem('planello_tasks', JSON.stringify(saveData));
            console.log('Tasks saved to localStorage');

        } catch (err) {
            console.error('Error saving tasks to localStorage:', err);
            // Try to save a minimal version as fallback
            try {
                localStorage.setItem('planello_tasks_backup', JSON.stringify({
                    tasks: this.tasks.map(t => ({
                        _id: t._id,
                        text: t.text,
                        completed: t.completed
                    })),
                    lastUpdated: new Date().toISOString()
                }));
            } catch (e) {
                console.error('Could not save backup tasks:', e);
            }
        }
    }

    async loadTasks() {
        if (!this.phone) {
            console.log('No phone number found, skipping task load');
            return;
        }

        try {
            console.log('Loading tasks for phone:', this.phone);
            const res = await fetch(`/api/tasks?phone=${encodeURIComponent(this.phone)}`);

            if (!res.ok) {
                const errorText = await res.text();
                console.error('Failed to load tasks:', res.status, errorText);
                this.showNotification('Error loading tasks. Please refresh the page.', 'error');
                return;
            }

            const tasks = await res.json();
            console.log('Loaded tasks:', tasks);

            // Ensure we have a valid array of tasks
            if (Array.isArray(tasks)) {
                this.tasks = tasks;
                this.renderTasks();
                this.updateStats();
            } else {
                console.error('Invalid tasks data received:', tasks);
                this.showNotification('Error: Invalid task data received', 'error');
            }

        } catch (err) {
            console.error('Error loading tasks:', err);
            this.showNotification('Failed to load tasks. Please check your connection.', 'error');

            // Try to load from localStorage as fallback
            try {
                const localTasks = localStorage.getItem('planello_tasks');
                if (localTasks) {
                    this.tasks = JSON.parse(localTasks);
                    this.renderTasks();
                    this.showNotification('Using locally saved tasks', 'warning');
                }
            } catch (localErr) {
                console.error('Error loading from localStorage:', localErr);
            }
        }
    }

    async addTask(text, priority = 'medium', reminderTime = null) {
        if (!this.phone) {
            this.showNotification('Please log in to add tasks', 'error');
            return;
        }

        // Basic validation
        if (!text || !text.trim()) {
            this.showNotification('Task text cannot be empty', 'error');
            return;
        }

        // Prepare the task data
        const taskData = {
            phone: this.phone,
            text: text.trim(),
            priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium'
        };

        // Add due date if provided
        if (reminderTime) {
            taskData.dueDate = new Date(reminderTime).toISOString();
            console.log('Setting due date:', taskData.dueDate);
        }

        try {
            console.log('Sending task data:', taskData); // Debug log

            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });

            const responseData = await res.json();

            if (!res.ok) {
                const errorMsg = responseData.error || responseData.message || 'Unknown error';
                console.error('Task add error:', errorMsg, responseData);
                this.showNotification(`Error adding task: ${errorMsg}`, 'error');
                return;
            }

            console.log('Task added successfully:', responseData);

            // Add the new task to the local tasks array
            this.tasks.push(responseData);
            this.renderTasks(responseData._id);
            this.updateStats();
            this.showNotification('Task added successfully!', 'success');

            // Clear input fields
            if (this.taskInput) this.taskInput.value = '';
            if (this.prioritySelect) this.prioritySelect.value = 'medium';
            if (this.reminderInput) this.reminderInput.value = '';
            if (this.taskInput) this.taskInput.focus();

        } catch (err) {
            console.error('Task add exception:', err);
            this.showNotification('Failed to add task. Please try again.', 'error');
        }
    }

    async completeTask(id) {
        const res = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: true })
        });
        const updatedTask = await res.json();
        this.tasks = this.tasks.map(t => t._id === id ? updatedTask : t);
        this.renderTasks();
        this.updateStats();
    }

    async deleteTask(id) {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        this.tasks = this.tasks.filter(t => t._id !== id);
        this.renderTasks();
        this.updateStats();
    }

    initializeElements() {
        this.taskInput = document.getElementById('taskInput');
        this.addBtn = document.getElementById('addTaskBtn');
        this.prioritySelect = document.getElementById('prioritySelect');
        this.reminderInput = document.getElementById('reminderInput'); // new input for reminder time
        this.searchInput = document.getElementById('searchInput');
        this.filterBtns = document.querySelectorAll('.filter-btn');
        this.tasksList = document.getElementById('tasksList');
        this.emptyState = document.getElementById('emptyState');
        this.todayTasks = document.getElementById('todayTasks');
        this.completedTasks = document.getElementById('completedTasks');
        this.upcomingTasks = document.getElementById('upcomingTasks');
        this.productivityScore = document.getElementById('productivityScore');
        // Action buttons
        this.clearCompletedBtn = document.getElementById('clearCompletedBtn');
        this.exportBtn = document.getElementById('exportBtn');
        // Modal elements
        this.editModal = document.getElementById('editModal');
        this.editTaskInput = document.getElementById('editTaskInput');
        this.editPrioritySelect = document.getElementById('editPrioritySelect');
        this.saveEditBtn = document.getElementById('saveEditBtn');
        this.cancelEditBtn = document.getElementById('cancelEditBtn');
        this.closeModal = document.getElementById('closeModal');
        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
        this.suggestionsBox = document.getElementById('suggestionsBox');

        // If table body doesn't exist, create a basic table structure
        if (!this.tasksList && document.getElementById('dashboardTable')) {
            const table = document.getElementById('dashboardTable');
            if (table) {
                // Create thead if it doesn't exist
                let thead = table.querySelector('thead');
                if (!thead) {
                    thead = document.createElement('thead');
                    table.appendChild(thead);
                }

                // Create header row if it doesn't exist
                this.headerRow = document.getElementById('headerRow');
                if (!this.headerRow) {
                    this.headerRow = document.createElement('tr');
                    this.headerRow.id = 'headerRow';
                    const daysHeader = document.createElement('th');
                    daysHeader.textContent = 'Days/Time';
                    this.headerRow.appendChild(daysHeader);
                    thead.appendChild(this.headerRow);
                }

                // Create tbody if it doesn't exist
                this.tasksList = document.getElementById('tasksList');
                if (!this.tasksList) {
                    this.tasksList = document.createElement('tbody');
                    this.tasksList.id = 'tasksList';
                    table.appendChild(this.tasksList);
                }
            }
        }
    }

    bindEvents() {
        // Add task events
        if (this.addBtn) {
            this.addBtn.addEventListener('click', () => {
                const text = this.taskInput.value.trim();
                const priority = this.prioritySelect.value;
                const reminderTime = this.reminderInput ? this.reminderInput.value : null;
                if (text) this.addTask(text, priority, reminderTime);
            });
        }
        if (this.taskInput) {
            this.taskInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const text = this.taskInput.value.trim();
                    const priority = this.prioritySelect.value;
                    const reminderTime = this.reminderInput ? this.reminderInput.value : null;
                    if (text) this.addTask(text, priority, reminderTime);
                }
            });
        }

        // Filter events
        if (this.filterBtns) {
            this.filterBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.setFilter(e.target.closest('.filter-btn').dataset.filter);
                });
            });
        }

        // Action events
        if (this.clearCompletedBtn) {
            this.clearCompletedBtn.addEventListener('click', () => this.showClearCompletedConfirmModal());
        }
        if (this.exportBtn) {
            this.exportBtn.addEventListener('click', () => this.exportTasks());
        }

        // Modal events
        if (this.saveEditBtn) {
            this.saveEditBtn.addEventListener('click', () => this.saveEdit());
        }
        if (this.cancelEditBtn) {
            this.cancelEditBtn.addEventListener('click', () => this.closeEditModal());
        }
        if (this.closeModal) {
            this.closeModal.addEventListener('click', () => this.closeEditModal());
        }

        // Close modal when clicking outside
        if (this.editModal) {
            this.editModal.addEventListener('click', (e) => {
                if (e.target === this.editModal) this.closeEditModal();
            });
        }

        // Search input event
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => {
                this.renderTasks();
            });
        }

        if (this.undoBtn) this.undoBtn.addEventListener('click', () => this.undo());
        if (this.redoBtn) this.redoBtn.addEventListener('click', () => this.redo());

        // Smart suggestions
        if (this.taskInput && this.suggestionsBox) {
            this.taskInput.addEventListener('input', (e) => this.showSuggestions());
            this.taskInput.addEventListener('keydown', (e) => this.suggestionKeydown(e));
            document.addEventListener('click', (e) => {
                if (!this.suggestionsBox.contains(e.target) && e.target !== this.taskInput) {
                    this.suggestionsBox.style.display = 'none';
                }
            });
        }

        // Automatically update motivational quote every hour
        setInterval(() => this.updateMotivationalQuote(), 60 * 60 * 1000);

        // If demo button exists, update motivational quote on click
        const demoBtn = document.getElementById('demoBtn');
        if (demoBtn) {
            demoBtn.addEventListener('click', () => this.updateMotivationalQuote());
        }
    }

    renderTasks(newTaskId = null) {
        const filteredTasks = this.getFilteredTasks();
        if (filteredTasks.length === 0) {
            this.tasksList.style.display = 'none';
            this.emptyState.style.display = 'block';
        } else {
            this.tasksList.style.display = 'flex';
            this.emptyState.style.display = 'none';
            this.tasksList.innerHTML = filteredTasks.map(task => this.createTaskHTML(task)).join('');
            // Animate only the newly added task if provided
            if (newTaskId) {
                const newTaskEl = this.tasksList.querySelector(`.task-item[data-id="${newTaskId}"]`);
                if (newTaskEl) {
                    newTaskEl.classList.add('task-item-animate');
                    setTimeout(() => newTaskEl.classList.remove('task-item-animate'), 600);
                }
            }
            // Bind task-specific events
            this.bindTaskEvents();
        }
    }

    getFilteredTasks() {
        let filtered = this.tasks;
        // Filter by current filter
        if (this.currentFilter === 'pending') {
            filtered = filtered.filter(t => !t.completed);
        } else if (this.currentFilter === 'completed') {
            filtered = filtered.filter(t => t.completed);
        } else if (this.currentFilter === 'high') {
            filtered = filtered.filter(t => t.priority === 'high');
        }
        // Filter by search query
        if (this.searchInput && this.searchInput.value.trim() !== '') {
            const q = this.searchInput.value.trim().toLowerCase();
            filtered = filtered.filter(t => t.text.toLowerCase().includes(q));
        }
        return filtered;
    }

    createTaskHTML(task) {
        const completedClass = task.completed ? 'completed' : '';
        const checkedClass = task.completed ? 'checked' : '';
        const date = new Date(task.createdAt).toLocaleDateString();

        return `
            <div class="task-item ${completedClass}" data-id="${task._id}">
                <div class="task-checkbox ${checkedClass}" onclick="taskManager.toggleTask('${task._id}')">
                    ${task.completed ? '<i class="fas fa-check"></i>' : ''}
                </div>
                <div class="task-content">
                    <div class="task-text">${escapeHtml(task.text)}</div>
                    <div class="task-meta">
                        <span class="task-priority ${task.priority}">${task.priority}</span>
                        <span class="task-date">${date}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="action-btn edit-btn" onclick="taskManager.editTask(${task._id})" title="Edit task">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete-btn" onclick="taskManager.deleteTask(${task._id})" title="Delete task">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    bindTaskEvents() {
        // Remove previous listeners to avoid duplicates
        if (this.tasksList) {
            this.tasksList.removeEventListener('click', this._taskListHandler);
            this._taskListHandler = (e) => {
                const editBtn = e.target.closest('.edit-btn');
                const deleteBtn = e.target.closest('.delete-btn');
                if (editBtn) {
                    const taskItem = editBtn.closest('.task-item');
                    if (taskItem) {
                        const id = taskItem.getAttribute('data-id');
                        this.editTask(id);
                    }
                } else if (deleteBtn) {
                    const taskItem = deleteBtn.closest('.task-item');
                    if (taskItem) {
                        const id = taskItem.getAttribute('data-id');
                        this.deleteTask(id);
                    }
                }
            };
            this.tasksList.addEventListener('click', this._taskListHandler);
        }
    }

    updateStats() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.completed).length;
        const pending = total - completed;
        const productivity = total > 0 ? Math.round((completed / total) * 100) : 0;

        this.todayTasks.textContent = total;
        this.completedTasks.textContent = completed;
        this.upcomingTasks.textContent = pending;
        this.productivityScore.textContent = `${productivity}%`;

        // Show/hide clear completed button
        this.clearCompletedBtn.style.display = completed > 0 ? 'flex' : 'none';

        // --- Analytics & Insights ---
        const streak = this.updateStreak();
        this.updateBestDay();
        this.updateCompletionChart();
        this.updateMotivationalQuote();
        this.updateCategoryPieChart();
        this.updateAvgTasks();
        this.updateWeeklyProgress();
        this.updateCategoryStats();
        this.updateProductivityTrends();
        this.updateAchievements();
    }

    // --- Streak Counter ---
    updateStreak() {
        const streakEl = document.getElementById('streakCounter');
        // Get unique days with at least one completed task
        const days = this.tasks.filter(t => t.completed).map(t => t.createdAt.split('T')[0]);
        const uniqueDays = Array.from(new Set(days)).sort();
        // Calculate streak
        let streak = 0;
        let d = new Date();
        for (let i = uniqueDays.length - 1; i >= 0; i--) {
            if (uniqueDays[i] === d.toISOString().split('T')[0]) {
                streak++;
                d.setDate(d.getDate() - 1);
            } else {
                break;
            }
        }
        if (streakEl) {
            streakEl.textContent = streak + ' day' + (streak === 1 ? '' : 's');
        }
        return streak;
    }

    // --- Best Day ---
    updateBestDay() {
        const bestDayEl = document.getElementById('bestDay');
        if (!bestDayEl) return;
        const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const counts = [0,0,0,0,0,0,0];
        this.tasks.forEach(t => {
            if (t.completed) {
                const d = new Date(t.createdAt);
                counts[d.getDay()]++;
            }
        });
        const max = Math.max(...counts);
        if (max === 0) {
            bestDayEl.textContent = '-';
        } else {
            const idx = counts.indexOf(max);
            bestDayEl.textContent = dayNames[idx] + ' (' + max + ' tasks)';
        }
    }

    // --- Completion Rate Chart (last 7 days) ---
    updateCompletionChart() {
        const canvas = document.getElementById('completionChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        // Get last 7 days
        let days = [];
        let now = new Date();
        for (let i=6; i>=0; i--) {
            let d = new Date(now);
            d.setDate(now.getDate()-i);
            days.push(d.toISOString().split('T')[0]);
        }
        // Count completed per day
        let counts = days.map(day => this.tasks.filter(t => t.completed && t.createdAt.startsWith(day)).length);
        let max = Math.max(1, ...counts);
        // Draw bars
        let w = canvas.width/7, h = canvas.height;
        ctx.fillStyle = '#667eea';
        for (let i=0; i<7; i++) {
            let barH = (counts[i]/max)*(h-10);
            ctx.fillRect(i*w+8, h-barH-8, w-16, barH);
        }
        // Draw day initials
        ctx.font = '12px Poppins, Inter, sans-serif';
        ctx.fillStyle = '#888';
        for (let i=0; i<7; i++) {
            ctx.fillText(['S','M','T','W','T','F','S'][i], i*w+12, canvas.height-2);
        }
    }

    // --- Motivational Quote ---
    updateMotivationalQuote() {
        const quotes = [
            'You can do it!',
            'Small steps every day.',
            'Stay focused and never give up.',
            'Progress, not perfection.',
            'Dream big, work hard.',
            'Success is a series of small wins.',
            'Your future is created by what you do today.',
            'Every expert was once a beginner.',
            'The only way to do great work is to love what you do.',
            'Believe you can and you\'re halfway there.',
            'Don\'t watch the clock; do what it does. Keep going.',
            'The harder you work, the luckier you get.',
            'Success is not final, failure is not fatal.',
            'It always seems impossible until it\'s done.',
            'The best way to predict the future is to create it.',
            'Your time is limited, don\'t waste it living someone else\'s life.',
            'The journey of a thousand miles begins with one step.',
            'What you get by achieving your goals is not as important as what you become.',
            'The only limit to our realization of tomorrow is our doubts of today.',
            'Act as if what you do makes a difference. It does.'
        ];
        const quoteEl = document.getElementById('motivationalQuote');
        if (!quoteEl) return;

        // Change quote based on current time (hour, minute, second) for more frequent changes
        const now = new Date();
        const timeIndex = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) % quotes.length;
        const dayIndex = now.getDate() % quotes.length;
        const combinedIndex = (timeIndex + dayIndex) % quotes.length;

        quoteEl.textContent = quotes[combinedIndex];

        // Add a subtle animation to show the quote is updating
        quoteEl.style.opacity = '0.7';
        setTimeout(() => {
            quoteEl.style.opacity = '1';
        }, 200);
    }

    // --- Task Distribution Pie Chart ---
    updateCategoryPieChart() {
        const canvas = document.getElementById('categoryPieChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        // Count by category
        const cats = {};
        this.tasks.forEach(t => {
            const cat = t.category || 'other';
            cats[cat] = (cats[cat]||0)+1;
        });
        const colors = ['#667eea','#f093fb','#48bb78','#ed8936','#e53e3e','#764ba2','#38a169'];
        const keys = Object.keys(cats);
        const total = keys.reduce((a,k)=>a+cats[k],0);
        // Fallback: No tasks
        if (total === 0) {
            ctx.font = '14px Poppins, Inter, sans-serif';
            ctx.fillStyle = '#888';
            ctx.textAlign = 'center';
            ctx.fillText('No tasks to display', canvas.width/2, canvas.height/2);
            return;
        }
        // Fallback: Only one category
        if (keys.length === 1) {
            ctx.beginPath();
            ctx.arc(canvas.width/2, canvas.height/2, canvas.width/2-8, 0, 2*Math.PI);
            ctx.closePath();
            ctx.fillStyle = colors[0];
            ctx.fill();
            ctx.font = '13px Poppins, Inter, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(keys[0].charAt(0).toUpperCase()+keys[0].slice(1), canvas.width/2, canvas.height/2+5);
            return;
        }
        // Normal pie chart
        let start=0;
        keys.forEach((k,i) => {
            const val = cats[k];
            const angle = (val/total)*2*Math.PI;
            ctx.beginPath();
            ctx.moveTo(canvas.width/2,canvas.height/2);
            ctx.arc(canvas.width/2,canvas.height/2,canvas.width/2-8,start,start+angle);
            ctx.closePath();
            ctx.fillStyle = colors[i%colors.length];
            ctx.fill();
            // Draw label
            const midAngle = start + angle/2;
            const labelX = canvas.width/2 + Math.cos(midAngle)*(canvas.width/4);
            const labelY = canvas.height/2 + Math.sin(midAngle)*(canvas.height/4);
            ctx.font = '12px Poppins, Inter, sans-serif';
            ctx.fillStyle = '#222';
            ctx.textAlign = 'center';
            ctx.fillText(k.charAt(0).toUpperCase()+k.slice(1), labelX, labelY);
            start += angle;
        });
    }

    // --- Average Tasks Per Day ---
    updateAvgTasks() {
        const avgEl = document.getElementById('avgTasks');
        if (!avgEl) return;
        if (this.tasks.length === 0) { avgEl.textContent = '0'; return; }
        // Get unique days
        const days = Array.from(new Set(this.tasks.map(t => t.createdAt.split('T')[0])));
        const avg = (this.tasks.length / days.length).toFixed(1);
        avgEl.textContent = avg;
    }

    // --- Weekly Progress ---
    updateWeeklyProgress() {
        const progressBar = document.getElementById('weeklyProgress');
        const progressText = document.getElementById('progressText');
        if (!progressBar || !progressText) return;
        // Get last 7 days' tasks
        let now = new Date();
        let weekTasks = [];
        for (let i=0; i<7; i++) {
            let d = new Date(now);
            d.setDate(now.getDate()-i);
            weekTasks.push(d.toISOString().split('T')[0]);
        }
        const tasks7d = this.tasks.filter(t => weekTasks.includes(t.createdAt.split('T')[0]));
        const completed7d = tasks7d.filter(t => t.completed).length;
        const percent = tasks7d.length > 0 ? Math.round((completed7d / tasks7d.length) * 100) : 0;
        progressBar.style.width = percent + '%';
        progressText.textContent = percent + '% Complete';
    }

    // --- Task Categories ---
    updateCategoryStats() {
        const statsEl = document.getElementById('categoryStats');
        if (!statsEl) return;
        const cats = {};
        this.tasks.forEach(t => {
            const cat = t.category || 'other';
            cats[cat] = (cats[cat]||0)+1;
        });
        statsEl.innerHTML = '';
        Object.entries(cats).forEach(([cat, count]) => {
            statsEl.innerHTML += `<div class="category-stat"><span class="category-name">${cat.charAt(0).toUpperCase()+cat.slice(1)}</span><span class="category-count">${count}</span></div>`;
        });
    }

    // --- Productivity Trends ---
    updateProductivityTrends() {
        const trendEl = document.getElementById('trendChart');
        if (!trendEl) return;
        // Get last 7 days
        let now = new Date();
        let days = [];
        for (let i=6; i>=0; i--) {
            let d = new Date(now);
            d.setDate(now.getDate()-i);
            days.push(d.toISOString().split('T')[0]);
        }
        // Count completed per day
        let counts = days.map(day => this.tasks.filter(t => t.completed && t.createdAt.startsWith(day)).length);
        // Render as bars
        trendEl.innerHTML = '';
        const max = Math.max(1, ...counts);
        counts.forEach((count, i) => {
            const bar = document.createElement('div');
            bar.className = 'trend-bar';
            bar.style.height = (count/max*100+10) + 'px';
            bar.title = `${['S','M','T','W','T','F','S'][i]}: ${count} completed`;
            trendEl.appendChild(bar);
        });
    }

    // --- Achievements ---
    updateAchievements() {
        const achEl = document.getElementById('achievements');
        if (!achEl) return;
        const completed = this.tasks.filter(t => t.completed).length;
        const streak = document.getElementById('streakCounter')?.textContent || '';
        let achievements = [];
        if (completed >= 10) achievements.push({icon:'fa-medal',text:'10 Tasks Completed!'});
        if (completed >= 25) achievements.push({icon:'fa-trophy',text:'25 Tasks Completed!'});
        if (completed >= 50) achievements.push({icon:'fa-crown',text:'50 Tasks Completed!'});
        if (streak.startsWith('5')) achievements.push({icon:'fa-fire',text:'5 Day Streak!'});
        if (streak.startsWith('7')) achievements.push({icon:'fa-bolt',text:'7 Day Streak!'});
        if (this.tasks.length >= 20) achievements.push({icon:'fa-star',text:'20+ Tasks Added!'});
        achEl.innerHTML = achievements.length ? achievements.map(a => `<div class="achievement"><i class="fas ${a.icon}"></i><span class="achievement-text">${a.text}</span></div>`).join('') : '<div class="achievement-text">No achievements yet. Keep going!</div>';
    }

    exportTasks() {
        if (this.tasks.length === 0) {
            this.showNotification('No tasks to export!', 'error');
            return;
        }

        // Create shareable text format for sharing
        const shareableText = this.createShareableText();

        // Only open the share modal (no file downloads)
        this.showShareableTextModal(shareableText);
    }

    createShareableText() {
        const completedTasks = this.tasks.filter(t => t.completed);
        const pendingTasks = this.tasks.filter(t => !t.completed);

        let text = `📋 PLANELLO TASK LIST\n`;
        text += `📅 Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n`;
        text += `📊 Summary: ${this.tasks.length} total tasks (${completedTasks.length} completed, ${pendingTasks.length} pending)\n\n`;

        if (pendingTasks.length > 0) {
            text += `⏳ PENDING TASKS:\n`;
            pendingTasks.forEach((task, index) => {
                const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
                const category = task.category || 'other';
                text += `${index + 1}. ${priority} ${task.text} (${category})\n`;
            });
            text += `\n`;
        }

        if (completedTasks.length > 0) {
            text += `✅ COMPLETED TASKS:\n`;
            completedTasks.forEach((task, index) => {
                const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
                const category = task.category || 'other';
                text += `${index + 1}. ${priority} ${task.text} (${category})\n`;
            });
            text += `\n`;
        }

        text += `📈 Progress: ${Math.round((completedTasks.length / this.tasks.length) * 100)}% complete\n`;
        text += `\n---\nGenerated by Planello Task Manager`;

        return text;
    }

    showShareableTextModal(shareableText) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('shareableTextModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'shareableTextModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>📤 Share Your Tasks</h3>
                        <button class="close-btn" id="closeShareableModal">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="share-options">
                            <div class="share-option">
                                <button id="shareNativeBtn" class="share-btn native-share">
                                    <i class="fas fa-share-alt"></i>
                                    Share Directly
                                </button>
                                <small>Share to WhatsApp, Email, etc.</small>
                            </div>
                            <div class="share-option">
                                <button id="shareEmailBtn" class="share-btn email-share">
                                    <i class="fas fa-envelope"></i>
                                    Send via Email
                                </button>
                                <small>Open email client</small>
                            </div>
                            <div class="share-option">
                                <button id="shareWhatsAppBtn" class="share-btn whatsapp-share">
                                    <i class="fab fa-whatsapp"></i>
                                    WhatsApp Web
                                </button>
                                <small>Open WhatsApp Web</small>
                            </div>
                            <div class="share-option">
                                <button id="shareAppLinkBtn" class="share-btn app-link-share">
                                    <i class="fas fa-link"></i>
                                    Share App Link
                                </button>
                                <small>Share a link to Planello</small>
                            </div>
                            <div class="share-option">
                                <button id="sharePdfBtn" class="share-btn pdf-share">
                                    <i class="fas fa-file-pdf"></i>
                                    Share as PDF
                                </button>
                                <small>Download/Share PDF</small>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button id="closeShareableBtn" class="cancel-btn">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Bind events
            document.getElementById('closeShareableModal').addEventListener('click', () => this.closeShareableTextModal());
            document.getElementById('closeShareableBtn').addEventListener('click', () => this.closeShareableTextModal());
            document.getElementById('shareNativeBtn').addEventListener('click', () => this.shareNative(shareableText));
            document.getElementById('shareEmailBtn').addEventListener('click', () => this.shareViaEmail(shareableText));
            document.getElementById('shareWhatsAppBtn').addEventListener('click', () => this.shareViaWhatsApp(shareableText));
            document.getElementById('shareAppLinkBtn').addEventListener('click', () => this.shareAppLink());
            document.getElementById('sharePdfBtn').addEventListener('click', () => this.shareAsPdf(shareableText));

            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeShareableTextModal();
            });
        }
        // Show modal
        modal.classList.add('show');
    }

    closeShareableTextModal() {
        const modal = document.getElementById('shareableTextModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    copyShareableText() {
        const textArea = document.getElementById('shareableTextArea');
        textArea.select();
        textArea.setSelectionRange(0, 99999); // For mobile devices

        try {
            document.execCommand('copy');
            this.showNotification('Text copied to clipboard! Ready to paste in WhatsApp/Email', 'success');
        } catch (err) {
            // Fallback for modern browsers
            navigator.clipboard.writeText(textArea.value).then(() => {
                this.showNotification('Text copied to clipboard! Ready to paste in WhatsApp/Email', 'success');
            }).catch(() => {
                this.showNotification('Please manually copy the text', 'error');
            });
        }
    }

    async shareNative(text) {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My Planello Tasks',
                    text: text,
                    url: window.location.href
                });
                this.showNotification('Shared successfully!', 'success');
            } catch (err) {
                if (err.name !== 'AbortError') {
                    this.showNotification('Sharing failed. Please copy manually.', 'error');
                }
            }
        } else {
            this.showNotification('Direct sharing not supported. Please copy manually.', 'error');
        }
    }

    shareViaEmail(text) {
        const subject = encodeURIComponent('My Planello Task List');
        const body = encodeURIComponent(text);
        const mailtoLink = `mailto:?subject=${subject}&body=${body}`;

        // Try to open email client
        const emailWindow = window.open(mailtoLink, '_blank');

        if (emailWindow) {
            this.showNotification('Email client opened!', 'success');
        } else {
            // Fallback: copy email content
            const emailContent = `Subject: My Planello Task List\n\n${text}`;
            navigator.clipboard.writeText(emailContent).then(() => {
                this.showNotification('Email content copied! Paste in your email app.', 'success');
            }).catch(() => {
                this.showNotification('Please copy the text manually for email.', 'error');
            });
        }
    }

    shareViaWhatsApp(text) {
        const whatsappText = encodeURIComponent(text);
        const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

        // Open WhatsApp Web
        const whatsappWindow = window.open(whatsappUrl, '_blank');

        if (whatsappWindow) {
            this.showNotification('WhatsApp Web opened!', 'success');
        } else {
            // Fallback: copy WhatsApp content
            navigator.clipboard.writeText(text).then(() => {
                this.showNotification('Text copied! Paste in WhatsApp.', 'success');
            }).catch(() => {
                this.showNotification('Please copy the text manually for WhatsApp.', 'error');
            });
        }
    }

    shareAppLink() {
        const appUrl = window.location.origin || 'https://planello.app';
        const message = `Check out Planello Task Manager! Organize and share your tasks easily. Try it here: ${appUrl}`;
        if (navigator.share) {
            navigator.share({
                title: 'Planello Task Manager',
                text: message,
                url: appUrl
            }).then(() => {
                this.showNotification('App link shared!', 'success');
            }).catch(() => {
                this.showNotification('Sharing failed. Please copy manually.', 'error');
            });
        } else {
            // Fallback: open mail client
            const mailto = `mailto:?subject=Try Planello Task Manager&body=${encodeURIComponent(message)}`;
            window.open(mailto, '_blank');
        }
    }

    async shareAsPdf(shareableText) {
        // Dynamically load jsPDF if not present
        if (typeof window.jspdf === 'undefined') {
            await this.loadJsPdf();
        }
        const doc = new window.jspdf.jsPDF();
        const lines = doc.splitTextToSize(shareableText, 180);
        doc.text(lines, 10, 20);
        const fileName = `planello-tasks-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
        doc.save(fileName);
        this.showNotification('PDF downloaded! You can now share it.', 'success');
    }

    loadJsPdf() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
        });
    }

    showEditModal() {
        this.editModal.classList.add('show');
        this.editTaskInput.focus();
    }

    closeEditModal() {
        this.editModal.classList.remove('show');
        this.editingTaskId = null;
        this.editTaskInput.value = '';
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;

        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 500;
            animation: slideInRight 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    pushUndo() {
        this.undoStack.push(JSON.stringify(this.tasks));
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.updateUndoRedoButtons();
    }
    pushRedo() {
        this.redoStack.push(JSON.stringify(this.tasks));
        if (this.redoStack.length > 50) this.redoStack.shift();
        this.updateUndoRedoButtons();
    }
    updateUndoRedoButtons() {
        if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
        if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.pushRedo();
        this.tasks = JSON.parse(this.undoStack.pop());
        this.saveTasks();
        this.renderTasks();
        this.updateStats();
    }
    redo() {
        if (this.redoStack.length === 0) return;
        this.pushUndo();
        this.tasks = JSON.parse(this.redoStack.pop());
        this.saveTasks();
        this.renderTasks();
        this.updateStats();
    }

    showSuggestions() {
        const val = this.taskInput.value.trim().toLowerCase();
        if (!val) { this.suggestionsBox.style.display = 'none'; return; }
        // Recent tasks
        const recent = Array.from(new Set(this.tasks.map(t => t.text))).filter(t => t.toLowerCase().includes(val)).slice(0,3);
        // Common phrases
        const phrases = ['Call','Email','Meeting','Buy','Schedule','Plan','Review','Submit','Read','Write'];
        const phraseMatches = phrases.filter(p => p.toLowerCase().includes(val)).slice(0,2);
        // Time suggestions
        const timeRegex = /\b(\d{1,2})(:|\s)?(\d{2})?\s?(am|pm)?\b/;
        const timeSuggestions = !timeRegex.test(val) ? ['9:00 AM','2:30 PM','6 PM'].filter(t => t.includes(val)).slice(0,1) : [];
        // Category suggestions
        const categories = ['work','personal','health','learning','other'];
        const catMatches = categories.filter(c => c.includes(val)).slice(0,1);
        // Combine
        const suggestions = [...recent, ...phraseMatches, ...timeSuggestions, ...catMatches].filter(Boolean).slice(0,5);
        if (suggestions.length === 0) { this.suggestionsBox.style.display = 'none'; return; }
        this.suggestionsBox.innerHTML = suggestions.map((s,i) => `<div class='suggestion-item' data-idx='${i}'>${s}</div>`).join('');
        this.suggestionsBox.style.display = 'block';
        // Click to select
        Array.from(this.suggestionsBox.children).forEach(item => {
            item.addEventListener('mousedown', (e) => {
                this.taskInput.value = item.textContent;
                this.suggestionsBox.style.display = 'none';
                this.taskInput.focus();
            });
        });
        this.suggestionIndex = -1;
    }
    suggestionKeydown(e) {
        if (this.suggestionsBox.style.display !== 'block') return;
        const items = Array.from(this.suggestionsBox.children);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.suggestionIndex = (this.suggestionIndex+1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.suggestionIndex = (this.suggestionIndex-1+items.length) % items.length;
        } else if (e.key === 'Enter') {
            if (this.suggestionIndex >= 0 && items[this.suggestionIndex]) {
                this.taskInput.value = items[this.suggestionIndex].textContent;
                this.suggestionsBox.style.display = 'none';
            }
        }
        items.forEach((item,i) => item.classList.toggle('active', i===this.suggestionIndex));
    }

    // Show confirmation modal for marking a task as complete
    showCompleteConfirmModal(taskId) {
        const modal = document.getElementById('deleteConfirmModal');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const closeBtn = document.getElementById('closeDeleteConfirmModal');
        const message = document.getElementById('deleteConfirmMessage');
        let originalMsg = message.textContent;
        message.textContent = 'Are you sure you want to mark this task as complete?';
        modal.classList.add('show');
        const handleConfirm = () => {
            this.toggleTask(taskId, true); // true = force complete
            this.closeDeleteConfirmModal();
        };
        const handleCancel = () => {
            this.closeDeleteConfirmModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.completeModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
            message.textContent = originalMsg;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }
    // Show confirmation modal for clearing completed tasks
    showClearCompletedConfirmModal() {
        const modal = document.getElementById('deleteConfirmModal');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const closeBtn = document.getElementById('closeDeleteConfirmModal');
        const message = document.getElementById('deleteConfirmMessage');
        let originalMsg = message.textContent;
        message.textContent = `Are you sure you want to clear all completed tasks?`;
        modal.classList.add('show');
        const handleConfirm = () => {
            this.clearCompleted(true); // true = force clear
            this.closeDeleteConfirmModal();
        };
        const handleCancel = () => {
            this.closeDeleteConfirmModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.clearCompletedModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
            message.textContent = originalMsg;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }

    // Add this method to TaskManager
    setFilter(filter) {
        this.currentFilter = filter;
        // Update active button UI
        if (this.filterBtns) {
            this.filterBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
        }
        this.renderTasks();
    }

    async toggleTask(taskId) {
        const task = this.tasks.find(t => t._id === taskId);
        if (!task) return;
        const updated = !task.completed;
        // Update on server
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: updated })
        });
        const updatedTask = await res.json();
        // Update locally
        this.tasks = this.tasks.map(t => t._id === taskId ? updatedTask : t);
        this.renderTasks();
        this.updateStats();
    }
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// UserProfileManager now uses backend API
class UserProfileManager {
    constructor() {
        this.phone = localStorage.getItem('currentUserPhone') || null;
        this.userData = {};
        this.initializeElements();
        this.bindEvents();
        this.loadUserProfile();
    }
    async loadUserProfile() {
        if (!this.phone) return;
        try {
            const res = await fetch(`/api/user-profile?phone=${encodeURIComponent(this.phone)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.error) {
                    console.log('User not found, creating new user profile');
                    this.userData = {
                        name: '',
                        email: '',
                        phone: this.phone,
                        bio: '',
                        stats: {},
                        joinDate: new Date().toLocaleDateString(),
                        lastLogin: new Date().toLocaleDateString()
                    };
                } else {
                    this.userData = data;
                }
                this.updateDisplay();
            } else {
                console.error('Failed to load user profile:', res.status);
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
        }
    }
    async saveUserData() {
        if (!this.phone) return;
        await fetch('/api/user-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...this.userData, phone: this.phone })
        });
    }
    initializeElements() {
        this.userProfileBtn = document.getElementById('userProfileBtn');
        this.userProfileDropdown = document.getElementById('userProfileDropdown');
        this.userName = document.getElementById('userName');
        this.profileName = document.getElementById('profileName');
        this.profileEmail = document.getElementById('profileEmail');
        this.profilePhone = document.getElementById('profilePhone');
        this.profileBio = document.getElementById('profileBio');
        this.saveProfileBtn = document.getElementById('saveProfileBtn');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.changePhotoBtn = document.getElementById('changePhotoBtn');
        this.photoInput = document.getElementById('photoInput');

        // Stats elements
        this.userTotalTasks = document.getElementById('userTotalTasks');
        this.userCompletedTasks = document.getElementById('userCompletedTasks');
        this.userStreak = document.getElementById('userStreak');
        this.userProductivity = document.getElementById('userProductivity');
        this.userJoinDate = document.getElementById('userJoinDate');
        this.userLastLogin = document.getElementById('userLastLogin');
    }

    bindEvents() {
        if (this.userProfileBtn) {
            this.userProfileBtn.addEventListener('click', () => this.toggleDropdown());
        }

        if (this.saveProfileBtn) {
            this.saveProfileBtn.addEventListener('click', () => this.saveProfile());
        }

        if (this.logoutBtn) {
            this.logoutBtn.addEventListener('click', () => this.logout());
        }

        if (this.changePhotoBtn) {
            this.changePhotoBtn.addEventListener('click', () => this.photoInput.click());
        }

        if (this.photoInput) {
            this.photoInput.addEventListener('change', (e) => this.handlePhotoChange(e));
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.userProfileBtn?.contains(e.target) && !this.userProfileDropdown?.contains(e.target)) {
                this.closeDropdown();
            }
        });
    }

    toggleDropdown() {
        this.userProfileDropdown.classList.toggle('show');
        this.userProfileBtn.classList.toggle('active');
    }

    closeDropdown() {
        this.userProfileDropdown.classList.remove('show');
        this.userProfileBtn.classList.remove('active');
    }

    updateDisplay() {
        if (this.userName) this.userName.textContent = this.userData.name;
        if (this.profileName) this.profileName.value = this.userData.name;
        if (this.profileEmail) this.profileEmail.value = this.userData.email;
        if (this.profilePhone) this.profilePhone.value = '';
        if (this.profileBio) this.profileBio.value = this.userData.bio;
        if (this.userJoinDate) this.userJoinDate.textContent = this.userData.joinDate;
        if (this.userLastLogin) this.userLastLogin.textContent = this.userData.lastLogin;

        this.updateStatsDisplay();
    }

    updateStatsDisplay() {
        if (this.userTotalTasks) this.userTotalTasks.textContent = this.userData.stats.totalTasks;
        if (this.userCompletedTasks) this.userCompletedTasks.textContent = this.userData.stats.completedTasks;
        if (this.userStreak) this.userStreak.textContent = this.userData.stats.streak;
        if (this.userProductivity) this.userProductivity.textContent = this.userData.stats.productivity + '%';
    }

    saveProfile() {
        this.userData.name = this.profileName.value || 'User';
        this.userData.email = this.profileEmail.value;
        this.userData.phone = this.profilePhone.value;
        this.userData.bio = this.profileBio.value;

        this.saveUserData();
        this.updateDisplay();
        this.closeDropdown();

        // Show success notification
        if (window.taskManager) {
            window.taskManager.showNotification('Profile saved successfully!', 'success');
        }
    }

    logout() {
        if (confirm('Are you sure you want to logout?')) {
            this.userData.lastLogin = new Date().toLocaleDateString();
            this.saveUserData();
            this.closeDropdown();

            if (window.taskManager) {
                window.taskManager.showNotification('Logged out successfully!', 'success');
            }
        }
    }

    handlePhotoChange(event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.userData.avatar = e.target.result;
                this.saveUserData();

                // Update avatar display
                const avatarImg = document.getElementById('userAvatar');
                const profileAvatarImg = document.getElementById('profileAvatar');
                if (avatarImg) avatarImg.src = this.userData.avatar;
                if (profileAvatarImg) profileAvatarImg.src = this.userData.avatar;

                if (window.taskManager) {
                    window.taskManager.showNotification('Profile photo updated!', 'success');
                }
            };
            reader.readAsDataURL(file);
        }
    }

    updateStatsFromTaskManager(taskManager) {
        if (!this.userData.stats) this.userData.stats = {};
        // Now safe to set properties
        this.userData.stats.totalTasks = taskManager.tasks.length;
        this.userData.stats.completedTasks = taskManager.tasks.filter(t => t.completed).length;
        // ... set other stats as needed ...
        this.saveUserData();
        this.updateStatsDisplay();
    }
}

// Theme Manager
class ThemeManager {
    constructor() {
        this.currentTheme = localStorage.getItem('theme') || 'light';
        this.initializeElements();
        this.bindEvents();
        this.initializeTheme();
    }

    initializeElements() {
        this.themeToggle = document.getElementById('darkModeToggle');
        this.themeSwatches = document.querySelectorAll('.theme-swatch');
    }

    bindEvents() {
        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        this.themeSwatches.forEach(swatch => {
            swatch.addEventListener('click', () => {
                const theme = swatch.dataset.theme;
                this.setTheme(theme);
            });
        });
    }

    initializeTheme() {
        this.setTheme(this.currentTheme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    }

    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        // Update theme toggle icon
        if (this.themeToggle) {
            const icon = this.themeToggle.querySelector('i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }

        // Update theme swatches
        this.themeSwatches.forEach(swatch => {
            swatch.classList.toggle('selected', swatch.dataset.theme === theme);
        });
    }
}

// Dashboard Manager
class DashboardManager {
    constructor() {
        this.phone = localStorage.getItem('currentUserPhone') || null;
        console.log('DashboardManager initialized with phone:', this.phone);
        this.initializeElements();
        this.bindEvents();
        this.loadSchedule();
    }

    async loadSchedule() {
        this.headerRow = document.getElementById('headerRow');
        this.tableBody = document.getElementById('tableBody');

        if (!this.phone) {
            this.resetToDefaultSchedule();
            this.unlockScheduleCells();
            return;
        }

        try {
            // Fetch schedule from backend
            const res = await fetch(`/api/schedule?phone=${encodeURIComponent(this.phone)}`);
            const data = await res.json();

            // Debug: Log the raw data from the server
            console.log('Raw schedule data from server:', data);

            if (data.schedule && data.schedule.rows) {
                const schedule = data.schedule;

                // Debug: Log the schedule data
                console.log('Processing schedule:', {
                    headers: schedule.headers,
                    rows: schedule.rows.map((row, i) => `Row ${i}: ${row.length} items`)
                });

                // Clear existing content
                while (this.headerRow.children.length > 1) {
                    this.headerRow.removeChild(this.headerRow.lastChild);
                }
                this.tableBody.innerHTML = '';

                // Set headers
                const headers = Array.isArray(schedule.headers) ? schedule.headers : [];
                headers.forEach(header => {
                    const th = document.createElement('th');
                    th.className = 'time-cell';
                    th.contentEditable = true;
                    th.textContent = String(header || '').trim();
                    this.headerRow.appendChild(th);
                });

                // Set rows
                const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const rows = Array.isArray(schedule.rows) ? schedule.rows : [];

                for (let i = 0; i < days.length; i++) {
                    const tr = document.createElement('tr');
                    const dayCell = document.createElement('td');
                    dayCell.textContent = days[i];
                    tr.appendChild(dayCell);

                    const rowData = Array.isArray(rows[i]) ? rows[i] : [];

                    // Ensure we have enough cells for all headers
                    const cellsNeeded = Math.max(headers.length, rowData.length);

                    for (let j = 0; j < cellsNeeded; j++) {
                        const td = document.createElement('td');
                        td.className = 'task-cell';
                        td.contentEditable = true;

                        // Get the cell content, ensuring it's a string
                        let cellContent = rowData[j];
                        if (Array.isArray(cellContent)) {
                            cellContent = cellContent.join('\n');
                        }
                        td.textContent = String(cellContent || '').trim();

                        tr.appendChild(td);
                    }

                    this.tableBody.appendChild(tr);
                }

                this.lockScheduleCells();
                console.log('Schedule loaded successfully');

                // Debug: Log the final table structure
                console.log('Table structure after loading:', {
                    headers: this.headerRow.children.length,
                    rows: this.tableBody.children.length,
                    cells: this.tableBody.querySelectorAll('td').length
                });

            } else {
                console.log('No schedule found, creating default');
                this.resetToDefaultSchedule();
                this.unlockScheduleCells();
            }
        } catch (error) {
            console.error('Error loading schedule:', error);
            this.resetToDefaultSchedule();
            this.unlockScheduleCells();
        }
    }

    countTasksInSchedule() {
        const scheduleData = this.getScheduleData();
        let taskCount = 0;

        // Count non-empty cells in the schedule
        scheduleData.rows.forEach(row => {
            row.forEach(cell => {
                if (cell && cell.trim() !== '') {
                    taskCount++;
                }
            });
        });

        return taskCount;
    }

    updateTaskCount() {
        const scheduleTaskCount = this.countTasksInSchedule();
        const taskCountElement = document.getElementById('taskCount');
        if (taskCountElement) {
            taskCountElement.textContent = scheduleTaskCount;
        }
    }

    getScheduleData() {
        const headers = [];
        const rows = [];

        // Get headers (time slots)
        const headerCells = this.headerRow.getElementsByClassName('time-cell');
        for (let i = 0; i < headerCells.length; i++) {
            // Get the header text, using data-original-content if available
            const header = headerCells[i].getAttribute('data-original-content') ||
                headerCells[i].textContent ||
                '';
            headers.push(header.trim());
        }

        // Get rows (days and tasks)
        const dayRows = this.tableBody.getElementsByTagName('tr');
        for (let i = 0; i < dayRows.length; i++) {
            const row = [];
            const cells = dayRows[i].getElementsByClassName('task-cell');

            for (let j = 0; j < cells.length; j++) {
                // Get the cell content, using data-original-content if available
                let cellContent = cells[j].getAttribute('data-original-content') ||
                    cells[j].textContent ||
                    '';

                // Clean up the content
                cellContent = cellContent.trim();

                // If the content is an array (from previous bug), join it with newlines
                if (Array.isArray(cellContent)) {
                    cellContent = cellContent.join('\n');
                }

                row.push(cellContent);
            }

            // Only add the row if it has at least one non-empty cell
            if (row.some(cell => cell !== '')) {
                rows.push(row);
            } else if (dayRows.length === 7) {
                // If we have exactly 7 rows (days of the week), keep empty rows
                // to maintain the structure
                rows.push(row);
            }
        }

        // Ensure we always have consistent data structure
        const result = {
            headers: headers || [],
            rows: (rows || []).map(row => (row || []).map(cell =>
                (cell !== null && cell !== undefined) ? cell.toString().trim() : ''
            ))
        };

        // Ensure we have at least one row for each day of the week
        if (result.rows.length < 7) {
            for (let i = result.rows.length; i < 7; i++) {
                result.rows.push(Array(result.headers.length || 4).fill(''));
            }
        }

        return result;
    }

    async saveSchedule() {
        // Don't save if we're not logged in
        if (!this.phone) {
            this.showNotification('Please log in to save your schedule', 'error');
            return false;
        }

        // Get the save button and its original text
        const saveButton = document.getElementById('saveScheduleBtn');
        const originalText = saveButton ? saveButton.textContent : '';

        try {
            // Get the schedule data from the DOM
            const headers = [];
            const rows = [];

            // Get headers (time slots)
            const headerCells = document.querySelectorAll('#headerRow th:not(:first-child)');
            headerCells.forEach(cell => {
                headers.push(cell.textContent.trim());
            });

            // Get rows (days and tasks)
            const dayRows = document.querySelectorAll('#tableBody tr');
            dayRows.forEach(row => {
                const rowData = [];
                const cells = row.querySelectorAll('td:not(:first-child)');
                cells.forEach(cell => {
                    rowData.push(cell.textContent.trim());
                });
                rows.push(rowData);
            });

            // Create the schedule data object
            const scheduleData = {
                headers: headers,
                rows: rows
            };

            // Log the schedule data in a more readable format
            console.log('=== Schedule Data ===');
            console.log('Headers:', scheduleData.headers);
            console.log('Rows:');
            scheduleData.rows.forEach((row, i) => {
                console.log(`  Row ${i + 1}:`, row);
            });
            console.log('=====================');

            // Also log as a table for better visualization
            console.table({
                'Time/Day': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', ...scheduleData.headers],
                ...scheduleData.rows.reduce((acc, row, i) => {
                    acc[`Day ${i + 1}`] = row;
                    return acc;
                }, {})
            });

            // Show saving indicator
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }

            // Debug: Log the phone number before sending
            console.log('Saving schedule with phone:', this.phone);

            // Send the data to the server
            const response = await fetch('/api/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: this.phone,
                    schedule: scheduleData
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save schedule');
            }

            this.showNotification('Schedule saved successfully!', 'success');
            this.lockScheduleCells();
            this.updateTaskCount();

            // Update last saved time
            const lastSavedElement = document.getElementById('lastSavedTime');
            if (lastSavedElement) {
                const now = new Date();
                lastSavedElement.textContent = `Last saved: ${now.toLocaleTimeString()}`;
                lastSavedElement.style.display = 'block';
            }

            return true;

        } catch (error) {
            console.error('Error saving schedule:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
            return false;

        } finally {
            // Restore save button state
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = originalText;
                saveButton.innerHTML = originalText; // Ensure we keep any HTML formatting
            }
        }
    }

    initializeElements() {
        this.addColumnBtn = document.getElementById('addColumnBtn');
        this.deleteColumnBtn = document.getElementById('deleteColumnBtn');
        this.templateBtn = document.getElementById('templateBtn');
        this.saveScheduleBtn = document.getElementById('saveScheduleBtn');
        this.createNewScheduleBtn = document.getElementById('createNewScheduleBtn');
        this.dashboardTable = document.getElementById('dashboardTable');
        this.headerRow = document.getElementById('headerRow');
        this.tableBody = document.getElementById('tableBody');
        this.templateModal = document.getElementById('templateModal');
        this.createCustomTemplateBtn = document.getElementById('createCustomTemplateBtn');

        // Notify button removed - reminders are now automatic
    }

    bindEvents() {
        if (this.addColumnBtn) {
            this.addColumnBtn.addEventListener('click', () => this.addColumn());
        }
        if (this.deleteColumnBtn) {
            this.deleteColumnBtn.addEventListener('click', () => this.deleteColumn());
        }
        if (this.templateBtn) {
            this.templateBtn.addEventListener('click', () => this.showTemplates());
        }
        if (this.saveScheduleBtn) {
            this.saveScheduleBtn.addEventListener('click', () => this.saveSchedule());
        }
        if (this.createNewScheduleBtn) {
            this.createNewScheduleBtn.addEventListener('click', () => this.showCreateNewScheduleModal());
        }
        if (this.createCustomTemplateBtn) {
            this.createCustomTemplateBtn.addEventListener('click', () => this.showCustomTemplateForm());
        }
    }

    addColumn() {
        const currentColumns = this.headerRow.children.length - 1; // -1 for the "Days/Time" column
        const newColumnIndex = currentColumns + 1;

        // Add header cell
        const headerCell = document.createElement('th');
        headerCell.contentEditable = true;
        headerCell.className = 'time-cell';
        headerCell.dataset.col = newColumnIndex;
        this.headerRow.appendChild(headerCell);

        // Add cells to each row
        const rows = this.tableBody.children;
        for (let i = 0; i < rows.length; i++) {
            const cell = document.createElement('td');
            cell.contentEditable = true;
            cell.className = 'task-cell';
            rows[i].appendChild(cell);
        }

        this.showNotification('Column added successfully!', 'success');
    }

    deleteColumn() {
        const currentColumns = this.headerRow.children.length - 1;
        if (currentColumns <= 1) {
            this.showNotification('Cannot delete the last column!', 'error');
            return;
        }

        // Remove header cell
        this.headerRow.removeChild(this.headerRow.lastChild);

        // Remove cells from each row
        const rows = this.tableBody.children;
        for (let i = 0; i < rows.length; i++) {
            rows[i].removeChild(rows[i].lastChild);
        }

        this.showNotification('Column deleted successfully!', 'success');
    }

    showTemplates() {
        if (!this.templateModal) return;
        this.renderTemplates();
        this.templateModal.classList.add('show');
        // Close modal event
        const closeBtn = document.getElementById('closeTemplateModal');
        if (closeBtn) closeBtn.onclick = () => this.templateModal.classList.remove('show');
        this.templateModal.onclick = (e) => {
            if (e.target === this.templateModal) this.templateModal.classList.remove('show');
        };
    }

    renderTemplates() {
        const templateGrid = this.templateModal.querySelector('.template-grid');
        if (!templateGrid) return;
        templateGrid.innerHTML = '';
        // Built-in templates
        const builtIn = this.getBuiltInTemplates();
        builtIn.forEach(t => templateGrid.appendChild(this.createTemplateItem(t, false)));
        // Custom templates
        const custom = this.getCustomTemplates();
        custom.forEach(t => templateGrid.appendChild(this.createTemplateItem(t, true)));
    }

    getBuiltInTemplates() {
        return [
            { name: 'Morning Routine', icon: '🌅', tasks: ['Exercise', 'Breakfast', 'Planning'], type: 'morning' },
            { name: 'Work Day', icon: '💼', tasks: ['Team meeting', 'Project work', 'Lunch break', 'Review progress'], type: 'workday' },
            { name: 'Evening Routine', icon: '🌙', tasks: ['Dinner', 'Review tomorrow', 'Relax time', 'Prepare for bed'], type: 'evening' },
            { name: 'Weekend', icon: '🎉', tasks: ['Sleep in', 'Hobby time', 'Social activities', 'Plan next week'], type: 'weekend' }
        ];
    }

    getCustomTemplates() {
        return JSON.parse(localStorage.getItem('customTemplates') || '[]');
    }

    saveCustomTemplates(templates) {
        localStorage.setItem('customTemplates', JSON.stringify(templates));
    }

    createTemplateItem(template, isCustom) {
        const div = document.createElement('div');
        div.className = 'template-item';
        div.innerHTML = `
            <div class="template-icon">${template.icon || '📝'}</div>
            <div class="template-header-row">
                <h4>${template.name}${isCustom ? '<span class="template-badge badge-work">Custom</span>' : ''}</h4>
                ${isCustom ? '<button class="delete-template-btn" title="Delete Template">&times;</button>' : ''}
            </div>
            <p>${template.tasks.join(', ')}</p>
            <button class="use-template-btn">Use Template</button>
        `;
        div.querySelector('.use-template-btn').onclick = () => this.applyTemplate(template);
        if (isCustom) {
            const deleteBtn = div.querySelector('.delete-template-btn');
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.confirmDeleteTemplate(template);
            };
        }
        return div;
    }

    showCustomTemplateForm() {
        const templateGrid = this.templateModal.querySelector('.template-grid');
        if (!templateGrid) return;
        // Clear and show form
        templateGrid.innerHTML = '';
        const formDiv = document.createElement('div');
        formDiv.className = 'custom-template-box';
        formDiv.innerHTML = `
            <form id="customTemplateForm">
                <input type="text" id="customTemplateName" class="custom-template-input" placeholder="Template Name" maxlength="32" required />
                <input type="text" id="customTemplateIcon" class="custom-icon-select" placeholder="Icon (emoji)" maxlength="2" />
                <textarea id="customTemplateTasks" class="custom-template-input" placeholder="Tasks (comma separated)" maxlength="120" required></textarea>
                <div class="custom-template-actions">
                    <button type="submit" class="use-template-btn">Save</button>
                    <button type="button" class="cancel-btn">Cancel</button>
                </div>
            </form>
        `;
        templateGrid.appendChild(formDiv);
        // Form events
        const form = formDiv.querySelector('#customTemplateForm');
        const cancelBtn = formDiv.querySelector('.cancel-btn');
        form.onsubmit = (e) => {
            e.preventDefault();
            const name = form.querySelector('#customTemplateName').value.trim();
            const icon = form.querySelector('#customTemplateIcon').value.trim() || '📝';
            const tasks = form.querySelector('#customTemplateTasks').value.split(',').map(t => t.trim()).filter(Boolean);
            if (!name || tasks.length === 0) return;
            const customTemplates = this.getCustomTemplates();
            customTemplates.push({ name, icon, tasks });
            this.saveCustomTemplates(customTemplates);
            this.renderTemplates();
        };
        cancelBtn.onclick = () => this.renderTemplates();
    }

    applyTemplate(template) {
        if (!window.taskManager) return;
        const phone = localStorage.getItem('currentUserPhone');
        if (!phone) {
            window.taskManager.showNotification('No user phone found. Please log in.', 'error');
            return;
        }
        // Add each template task to backend
        Promise.all(template.tasks.map(text => {
            return fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, text, priority: 'medium' })
            });
        })).then(() => {
            // Reload tasks from backend
            fetch(`/api/tasks?phone=${encodeURIComponent(phone)}`)
                .then(res => res.json())
                .then(tasks => {
                    window.taskManager.tasks = tasks;
                    window.taskManager.saveTasks();
                    window.taskManager.renderTasks();
                    window.taskManager.updateStats();
                    this.templateModal.classList.remove('show');
                    if (window.taskManager.showNotification) {
                        window.taskManager.showNotification('Template applied!', 'success');
                    }
                });
        }).catch(() => {
            window.taskManager.showNotification('Failed to apply template.', 'error');
        });
    }

    showSaveScheduleModal() {
        const modal = document.getElementById('saveScheduleModal');
        const confirmBtn = document.getElementById('confirmSaveScheduleBtn');
        const cancelBtn = document.getElementById('cancelSaveScheduleBtn');
        const closeBtn = document.getElementById('closeSaveScheduleModal');
        modal.classList.add('show');
        const handleConfirm = () => {
            this.saveSchedule();
            this.closeSaveScheduleModal();
        };
        const handleCancel = () => {
            this.closeSaveScheduleModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.saveModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }
    closeSaveScheduleModal() {
        const modal = document.getElementById('saveScheduleModal');
        modal.classList.remove('show');
        if (this.saveModalCleanup) {
            this.saveModalCleanup();
            this.saveModalCleanup = null;
        }
    }
    showCreateNewScheduleModal() {
        const modal = document.getElementById('createNewScheduleModal');
        const confirmBtn = document.getElementById('confirmCreateNewScheduleBtn');
        const cancelBtn = document.getElementById('cancelCreateNewScheduleBtn');
        const closeBtn = document.getElementById('closeCreateNewScheduleModal');
        modal.classList.add('show');
        const handleConfirm = () => {
            console.log('Confirm clicked: Creating new schedule');
            this.clearSchedule();
            this.showNotification('New schedule created!', 'success');
            this.closeCreateNewScheduleModal();
        };
        const handleCancel = () => {
            this.closeCreateNewScheduleModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.createModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }
    closeCreateNewScheduleModal() {
        const modal = document.getElementById('createNewScheduleModal');
        modal.classList.remove('show');
        if (this.createModalCleanup) {
            this.createModalCleanup();
            this.createModalCleanup = null;
        }
    }

    getScheduleData() {
        const data = {
            headers: [],
            rows: []
        };

        // Get headers
        const headerCells = this.headerRow.children;
        for (let i = 1; i < headerCells.length; i++) {
            data.headers.push(headerCells[i].textContent);
        }

        // Get row data
        const rows = this.tableBody.children;
        for (let i = 0; i < rows.length; i++) {
            const rowData = [];
            const cells = rows[i].children;
            for (let j = 1; j < cells.length; j++) {
                rowData.push(cells[j].textContent);
            }
            data.rows.push(rowData);
        }

        return data;
    }

    getDefaultScheduleData() {
        return {
            headers: ["", "", "", ""],
            rows: [
                ["", "", "", ""], // Monday
                ["", "", "", ""], // Tuesday
                ["", "", "", ""], // Wednesday
                ["", "", "", ""], // Thursday
                ["", "", "", ""], // Friday
                ["", "", "", ""], // Saturday
                ["", "", "", ""], // Sunday
            ]
        };
    }

    async clearSchedule() {
        if (this.phone) { // If there's a user, clear it on the backend
            await fetch(`/api/schedule/clear?phone=${encodeURIComponent(this.phone)}`, {
                method: 'DELETE'
            });
        }
        // Regardless, reset the UI to the default and unlock it.
        this.resetToDefaultSchedule();
        this.unlockScheduleCells();
    }

    resetToDefaultSchedule() {
        console.log('resetToDefaultSchedule called');

        // Ensure elements exist
        if (!this.headerRow || !this.tableBody) {
            console.warn('Table elements not found, initializing...');
            this.initializeElements();

            // If still not found after initialization, create a new table
            if (!this.headerRow || !this.tableBody) {
                console.error('Failed to initialize table elements');
                return false;
            }
        }

        try {
            // Reset headers (4 columns, empty)
            while (this.headerRow && this.headerRow.children.length > 1) {
                this.headerRow.removeChild(this.headerRow.lastChild);
            }

            // Add empty time slots (4 columns by default)
            const numberOfColumns = 4;
            for (let i = 0; i < numberOfColumns; i++) {
                const th = document.createElement('th');
                th.contentEditable = true;
                th.className = 'time-cell';
                th.dataset.col = i + 1;
                th.textContent = ''; // Empty content
                this.headerRow.appendChild(th);
            }

            // Reset rows (Monday-Sunday, 4 columns, all empty)
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            this.tableBody.innerHTML = '';

            days.forEach(day => {
                const tr = document.createElement('tr');
                const dayCell = document.createElement('td');
                dayCell.textContent = day;
                tr.appendChild(dayCell);

                // Add empty cells for each time slot
                for (let i = 0; i < numberOfColumns; i++) {
                    const td = document.createElement('td');
                    td.contentEditable = true;
                    td.className = 'task-cell';
                    tr.appendChild(td);
                }

                this.tableBody.appendChild(tr);
            });

            console.log('Default schedule reset complete');
            return true;
        } catch (error) {
            console.error('Error resetting schedule:', error);
            return false;
        }
    }

    showNotification(message, type = 'info') {
        if (window.taskManager) {
            window.taskManager.showNotification(message, type);
        } else {
            // Fallback notification
            alert(message);
        }
    }

    // Show confirmation and delete custom template
    confirmDeleteTemplate(template) {
        const modal = document.getElementById('deleteConfirmModal');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const closeBtn = document.getElementById('closeDeleteConfirmModal');
        const message = document.getElementById('deleteConfirmMessage');
        const title = document.getElementById('deleteConfirmModalTitle');
        const icon = modal.querySelector('.delete-warning-icon');
        let originalMsg = message.textContent;
        // Set for delete
        title.textContent = 'Delete';
        message.textContent = 'Are you sure you want to delete?';
        confirmBtn.innerHTML = '<i class="fas fa-trash"></i> Yes, Delete';
        icon.className = 'fas fa-exclamation-triangle delete-warning-icon';
        icon.style.color = '#ed8936';
        modal.classList.add('show');
        const handleConfirm = () => {
            this.deleteCustomTemplate(template);
            this.closeDeleteConfirmModal();
        };
        const handleCancel = () => {
            this.closeDeleteConfirmModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.deleteTemplateModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
            message.textContent = originalMsg;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }
    closeDeleteConfirmModal() {
        const modal = document.getElementById('deleteConfirmModal');
        modal.classList.remove('show');
        if (this.deleteModalCleanup) {
            this.deleteModalCleanup();
            this.deleteModalCleanup = null;
        }
        if (this.completeModalCleanup) {
            this.completeModalCleanup();
            this.completeModalCleanup = null;
        }
        if (this.clearCompletedModalCleanup) {
            this.clearCompletedModalCleanup();
            this.clearCompletedModalCleanup = null;
        }
        if (this.deleteTemplateModalCleanup) {
            this.deleteTemplateModalCleanup();
            this.deleteTemplateModalCleanup = null;
        }
    }
    deleteCustomTemplate(template) {
        let customTemplates = this.getCustomTemplates();
        customTemplates = customTemplates.filter(t =>
            !(t.name === template.name && t.icon === template.icon && t.tasks.join(',') === template.tasks.join(','))
        );
        this.saveCustomTemplates(customTemplates);
        this.renderTemplates();
    }

    lockScheduleCells() {
        if (!this.dashboardTable) return;
        const cells = this.dashboardTable.querySelectorAll('.task-cell, .time-cell');
        cells.forEach(cell => {
            cell.setAttribute('contenteditable', 'false');
            cell.classList.add('read-only');
            cell.ondblclick = () => {
                cell.setAttribute('contenteditable', 'true');
                cell.classList.remove('read-only');
                cell.focus();
            };
        });
    }

    unlockScheduleCells() {
        if (!this.dashboardTable) return;
        const cells = this.dashboardTable.querySelectorAll('.task-cell, .time-cell');
        cells.forEach(cell => {
            cell.setAttribute('contenteditable', 'true');
            cell.classList.remove('read-only');
            cell.ondblclick = null;
        });
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        // Add to DOM
        document.body.appendChild(notification);

        // Trigger reflow to ensure the initial state is applied
        void notification.offsetWidth;

        // Show the notification with animation
        notification.classList.add('show');

        // Auto-remove after 3 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Analytics Manager
class AnalyticsManager {
    constructor() {
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.analyticsDemoBtn = document.getElementById('analyticsDemoBtn');
    }

    bindEvents() {
        if (this.analyticsDemoBtn) {
            this.analyticsDemoBtn.addEventListener('click', () => this.showAnalyticsDemo());
        }
    }

    showAnalyticsDemo() {
        // Create demo tasks to show analytics
        if (window.taskManager) {
            const demoTasks = [
                { text: 'Complete project proposal', priority: 'high', completed: true, createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
                { text: 'Review quarterly reports', priority: 'medium', completed: true, createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
                { text: 'Team meeting preparation', priority: 'high', completed: false, createdAt: new Date().toISOString() },
                { text: 'Client presentation', priority: 'high', completed: true, createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
                { text: 'Update documentation', priority: 'low', completed: false, createdAt: new Date().toISOString() },
                { text: 'Code review', priority: 'medium', completed: true, createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
                { text: 'Bug fixes', priority: 'high', completed: true, createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
                { text: 'User testing', priority: 'medium', completed: false, createdAt: new Date().toISOString() }
            ];

            // Add demo tasks
            demoTasks.forEach(task => {
                const newTask = {
                    id: Date.now() + Math.random(),
                    text: task.text,
                    priority: task.priority,
                    completed: task.completed,
                    createdAt: task.createdAt
                };
                window.taskManager.tasks.push(newTask);
            });

            window.taskManager.saveTasks();
            window.taskManager.renderTasks();
            window.taskManager.updateStats();

            this.showNotification('Demo data loaded! Check out the analytics now.', 'success');
        }
    }

    showNotification(message, type = 'info') {
        if (window.taskManager) {
            window.taskManager.showNotification(message, type);
        } else {
            alert(message);
        }
    }
}

// Focus Manager now uses backend API
class FocusManager {
    constructor() {
        this.phone = localStorage.getItem('currentUserPhone') || null;
        this.focusItem = null;
        this.initializeElements();
        this.bindEvents();
        this.loadFocusItem();
    }
    async loadFocusItem() {
        if (!this.phone) return;
        const res = await fetch(`/api/focus?phone=${encodeURIComponent(this.phone)}`);
        if (res.ok) {
            const data = await res.json();
            this.focusItem = data.focus;
            this.renderFocusItem();
        }
    }
    async saveFocusItem() {
        if (!this.phone) return;
        await fetch('/api/focus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: this.phone, focus: this.focusItem })
        });
    }
    initializeElements() {
        this.focusContent = document.querySelector('.focus-content');
    }

    bindEvents() {
        // No additional event binding needed for single focus item
    }

    renderFocusItem() {
        if (!this.focusContent) return;

        this.focusContent.innerHTML = `
            <div class="focus-item ${this.focusItem?.completed ? 'completed' : ''}">
                <input type="text" class="focus-input" value="${escapeHtml(this.focusItem?.text)}" placeholder="What's your main focus today?">
            <div class="focus-actions">
                    <button class="complete-btn" title="Mark as complete">
                    <i class="fas fa-check"></i>
                </button>
                    <button class="delete-btn" title="Clear focus">
                    <i class="fas fa-trash"></i>
                </button>
                </div>
            </div>
        `;

        // Bind events for the focus item
        const input = this.focusContent.querySelector('.focus-input');
        const completeBtn = this.focusContent.querySelector('.complete-btn');
        const deleteBtn = this.focusContent.querySelector('.delete-btn');

        input.addEventListener('blur', () => this.updateFocusItem(input.value));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });

        completeBtn.addEventListener('click', () => this.showFocusConfirmModal('complete'));
        deleteBtn.addEventListener('click', () => this.showFocusConfirmModal('clear'));
    }

    showFocusConfirmModal(action) {
        const modal = document.getElementById('deleteConfirmModal');
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        const closeBtn = document.getElementById('closeDeleteConfirmModal');
        const message = document.getElementById('deleteConfirmMessage');
        const title = document.getElementById('deleteConfirmModalTitle');
        const icon = modal.querySelector('.delete-warning-icon');
        let originalMsg = message.textContent;
        if (action === 'complete') {
            title.textContent = 'Mark as Read';
            message.textContent = 'Are you sure you want to mark your focus as complete?';
            confirmBtn.innerHTML = '<i class="fas fa-check"></i> Yes, Mark';
            icon.className = 'fas fa-check-circle delete-warning-icon';
            icon.style.color = '#38a169';
        } else {
            title.textContent = 'Delete';
            message.textContent = 'Are you sure you want to clear your focus?';
            confirmBtn.innerHTML = '<i class="fas fa-trash"></i> Yes, Delete';
            icon.className = 'fas fa-exclamation-triangle delete-warning-icon';
            icon.style.color = '#ed8936';
        }
        modal.classList.add('show');

        const handleConfirm = () => {
            if (action === 'complete') {
                this.focusItem.completed = true;
                this.saveFocusItem();
                this.renderFocusItem();
            } else {
                this.focusItem = { text: '', completed: false };
                this.saveFocusItem();
                this.renderFocusItem();
            }
            this.closeFocusConfirmModal();
        };
        const handleCancel = () => {
            this.closeFocusConfirmModal();
        };
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        closeBtn.onclick = handleCancel;
        modal.onclick = (e) => { if (e.target === modal) handleCancel(); };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            else if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeydown);
        this.focusModalCleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            modal.onclick = null;
            message.textContent = originalMsg;
        };
        setTimeout(() => cancelBtn.focus(), 100);
    }
    closeFocusConfirmModal() {
        const modal = document.getElementById('deleteConfirmModal');
        modal.classList.remove('show');
        if (this.focusModalCleanup) {
            this.focusModalCleanup();
            this.focusModalCleanup = null;
        }
    }
    updateFocusItem(text) {
        this.focusItem.text = text.trim();
        this.saveFocusItem();
    }
}

// Function to show reminder notification
function showReminderNotification(reminderData) {
    if (!('Notification' in window)) {
        console.log('This browser does not support desktop notification');
        return;
    }

    // Check if notification permissions are already granted
    if (Notification.permission === 'granted') {
        createNotification(reminderData);
    }
    // Otherwise, ask the user for permission
    else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                createNotification(reminderData);
            }
        });
    }
}

// Function to create and show the notification
function createNotification(reminderData) {
    const notification = new Notification('Task Reminder', {
        body: reminderData.message,
        icon: '/icon.png' // Make sure you have an icon.png in your public folder
    });

    // Handle notification click
    notification.onclick = function() {
        window.focus();
        // You can add more actions here, like focusing on the task
    };
}

// Listen for reminder events from server
if (typeof io !== 'undefined') {
    const socket = io();

    socket.on('reminder', (reminderData) => {
        console.log('Received reminder:', reminderData);
        showReminderNotification(reminderData);

        // You can also update the UI to highlight the task
        const taskElement = document.querySelector(`[data-task-id="${reminderData.taskId}"]`);
        if (taskElement) {
            taskElement.classList.add('reminder-active');
            setTimeout(() => {
                taskElement.classList.remove('reminder-active');
            }, 10000); // Remove highlight after 10 seconds
        }
    });
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    try {
        console.log('Initializing Planello application...');

        const taskManager = new TaskManager();
        const userProfileManager = new UserProfileManager();
        const themeManager = new ThemeManager();
        const dashboardManager = new DashboardManager();
        const analyticsManager = new AnalyticsManager();
        const focusManager = new FocusManager();

        // Make them globally accessible
        window.taskManager = taskManager;
        window.userProfileManager = userProfileManager;
        window.themeManager = themeManager;
        window.dashboardManager = dashboardManager;
        window.analyticsManager = analyticsManager;
        window.focusManager = focusManager;

        // Link them together
        userProfileManager.updateStatsFromTaskManager(taskManager);

        // Update user profile stats whenever task stats update
        const originalUpdateStats = taskManager.updateStats.bind(taskManager);
        taskManager.updateStats = function() {
            originalUpdateStats();
            userProfileManager.updateStatsFromTaskManager(taskManager);
        };

        console.log('Planello application initialized successfully!');

        // Test that all managers are accessible
        console.log('TaskManager:', !!window.taskManager);
        console.log('UserProfileManager:', !!window.userProfileManager);
        console.log('ThemeManager:', !!window.themeManager);
        console.log('DashboardManager:', !!window.dashboardManager);
        console.log('AnalyticsManager:', !!window.analyticsManager);
        console.log('FocusManager:', !!window.focusManager);

    } catch (error) {
        console.error('Error initializing Planello application:', error);
        alert('There was an error loading the application. Please refresh the page.');
    }
});

// OTP Modal Logic
// Only show the OTP modal if planello_verified is not set. Do NOT clear user data or localStorage on page load.
if (
    window.location.pathname.endsWith('index.html') ||
    window.location.pathname === '/' ||
    window.location.pathname === '/index.html'
) {
    window.addEventListener('DOMContentLoaded', function() {
        // BEGIN OTP MODAL LOGIC
        const otpModal = document.getElementById('otpModal');
        const otpStep1 = document.getElementById('otpStep1');
        const otpStep2 = document.getElementById('otpStep2');
        const otpStep3 = document.getElementById('otpStep3');
        const otpPhoneInput = document.getElementById('otpPhoneInput');
        const otpNextBtn = document.getElementById('otpNextBtn');
        const otpPhoneDisplay = document.getElementById('otpPhoneDisplay');
        const otpCodeInput = document.getElementById('otpCodeInput');
        const otpVerifyBtn = document.getElementById('otpVerifyBtn');
        const otpResendLink = document.getElementById('otpResendLink');
        const otpCloseBtn = document.getElementById('otpCloseBtn');
        const otpErrorMsg = document.getElementById('otpErrorMsg');

        let currentPhone = '';
        let isVerified = localStorage.getItem('planello_verified') === 'true';

        function showStep(step) {
            otpStep1.style.display = step === 1 ? '' : 'none';
            otpStep2.style.display = step === 2 ? '' : 'none';
            otpStep3.style.display = step === 3 ? '' : 'none';
            otpErrorMsg.style.display = 'none';
        }

        function showError(msg) {
            otpErrorMsg.textContent = msg;
            otpErrorMsg.style.display = 'block';
        }

        function hideError() {
            otpErrorMsg.style.display = 'none';
        }

        // Add overlay to block interaction with main page and hide all except logo
        let otpOverlay = document.createElement('div');
        otpOverlay.id = 'otpOverlay';
        otpOverlay.style.position = 'fixed';
        otpOverlay.style.top = '0';
        otpOverlay.style.left = '0';
        otpOverlay.style.width = '100vw';
        otpOverlay.style.height = '100vh';
        otpOverlay.style.background = '#7ec0ee';
        otpOverlay.style.zIndex = '9998';
        otpOverlay.style.pointerEvents = 'auto';
        otpOverlay.style.display = 'none';
        document.body.appendChild(otpOverlay);

        function setMainContentVisibility(hidden) {
            // Hide all direct children of body except .logo-bar and #otpModal/overlay
            Array.from(document.body.children).forEach(el => {
                if (
                    el.classList && el.classList.contains('logo-bar') ||
                    el.id === 'otpModal' ||
                    el.id === 'otpOverlay'
                ) {
                    el.style.visibility = 'visible';
                } else {
                    el.style.visibility = hidden ? 'hidden' : 'visible';
                }
            });
            // Hide .right-controls inside .logo-bar
            const logoBar = document.querySelector('.logo-bar');
            if (logoBar) {
                const rightControls = logoBar.querySelector('.right-controls');
                if (rightControls) {
                    rightControls.style.visibility = hidden ? 'hidden' : 'visible';
                }
            }
        }

        function openOtpModal() {
            otpModal.style.display = 'flex';
            otpOverlay.style.display = 'block';
            setMainContentVisibility(true);
            showStep(1);
            otpPhoneInput.value = '';
            otpCodeInput.value = '';
            hideError();
        }

        function closeOtpModal() {
            if (!isVerified) return; // Prevent closing if not verified
            otpModal.style.display = 'none';
            otpOverlay.style.display = 'none';
            setMainContentVisibility(false);
        }

        // Show OTP modal and overlay on page load if not verified
        if (!isVerified) {
            openOtpModal();
        } else {
            // If already verified, ensure the UI shows the user's name
            const storedName = localStorage.getItem('userName');
            if (storedName) {
                const userNameElement = document.querySelector('.user-name');
                if (userNameElement) {
                    userNameElement.textContent = storedName;
                }
            }
        }

        otpNextBtn.addEventListener('click', async function() {
            const phone = otpPhoneInput.value.trim();
            const name = otpNameInput.value.trim();

            // Validate inputs
            if (!name) {
                showError('Please enter your name.');
                return;
            }

            if (!/^\d{10}$/.test(phone)) {
                showError('Please enter a valid 10-digit phone number.');
                return;
            }

            hideError();
            otpNextBtn.disabled = true;
            otpNextBtn.textContent = 'Sending OTP...';

            try {
                // Send WhatsApp OTP with name
                const res = await fetch('http://localhost:3001/api/send-whatsapp-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: phone,
                        name: name
                    })
                });

                const data = await res.json();

                if (data.success) {
                    currentPhone = phone;
                    otpPhoneDisplay.textContent = '+91 ' + phone;
                    showStep(2);
                    otpCodeInput.value = '';
                    otpCodeInput.focus();
                    if (data.demo && data.otp) {
                        showError('Demo OTP: ' + data.otp);
                    }
                } else if (data.requiresName) {
                    // This should not happen as we're now always sending the name
                    showError('Please enter your name.');
                    showStep(1);
                } else {
                    showError(data.message || 'Failed to send WhatsApp OTP.');
                }
            } catch (err) {
                console.error('OTP send error:', err);
                showError('Network error. Please try again.');
            }

            otpNextBtn.disabled = false;
            otpNextBtn.textContent = 'Send OTP →';
        });

        otpVerifyBtn.addEventListener('click', async function() {
            const otp = otpCodeInput.value.trim();
            const name = otpNameInput.value.trim();
            if (!/^\d{4,6}$/.test(otp)) {
                showError('Please enter the 6-digit OTP.');
                return;
            }
            if (!name) {
                showError('Please enter your name.');
                return;
            }
            hideError();
            otpVerifyBtn.disabled = true;
            otpVerifyBtn.textContent = 'Verifying...';
            try {
                console.log('Verifying OTP with name:', name); // Debug log
                const res = await fetch('http://localhost:3001/api/verify-whatsapp-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: currentPhone, // Don't add +91 here, let the server handle formatting
                        otp,
                        name: name.trim() // Ensure name is trimmed and included in the request
                    })
                });
                const data = await res.json();
                console.log('OTP verification response:', data); // Debug log
                if (data.success) {
                    showStep(3);
                    isVerified = true;
                    // Use the formatted phone number from the server response if available
                    const formattedPhone = data.phone || currentPhone;
                    localStorage.setItem('planello_verified', 'true');
                    localStorage.setItem('currentUserPhone', formattedPhone);
                    localStorage.setItem('userName', name.trim()); // Store the user's name

                    // Update the UI to show the user's name if the element exists
                    const userNameElement = document.querySelector('.user-name');
                    if (userNameElement) {
                        userNameElement.textContent = name.trim();
                    }

                    // Close the modal after a short delay
                    setTimeout(closeOtpModal, 1500);
                } else {
                    showError(data.message || 'Invalid OTP.');
                }
            } catch (err) {
                console.error('OTP verification error:', err);
                showError('Network error. Please try again.');
            }
            otpVerifyBtn.disabled = false;
            otpVerifyBtn.textContent = 'Verify OTP';
        });

        otpResendLink.addEventListener('click', async function(e) {
            e.preventDefault();
            hideError();
            otpResendLink.textContent = 'Resending...';
            try {
                const res = await fetch('http://localhost:3001/api/send-whatsapp-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: '+91' + currentPhone })
                });
                const data = await res.json();
                if (data.success) {
                    showError('WhatsApp OTP resent successfully.');
                } else {
                    showError(data.message || 'Failed to resend WhatsApp OTP.');
                }
            } catch (err) {
                showError('Network error. Please try again.');
            }
            otpResendLink.textContent = 'Try Again';
        });

        otpCloseBtn.addEventListener('click', function() {
            closeOtpModal();
        });

        // Optional: Prevent interaction with rest of app until verified
        // You can add logic here to block other UI if needed
    });
}

// Add logout function to clear verification/session only
function planelloLogout() {
    localStorage.removeItem('planello_verified');
    localStorage.removeItem('token');
    localStorage.removeItem('authToken');
    // Optionally clear other session-only flags
    window.location.reload();
}
// Attach to logout button if present
window.addEventListener('DOMContentLoaded', function() {
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            planelloLogout();
        });
    }
});

// Show OTP only on a brand new tab/window (not on every refresh)
if (!sessionStorage.getItem('visited')) {
    localStorage.removeItem('planello_verified');
    sessionStorage.setItem('visited', 'true');
}