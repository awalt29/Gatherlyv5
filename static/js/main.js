// Global state
let plannerInfo = null;
let selectedFriends = [];
let allFriends = [];
let selectedTimeSlots = [];
let currentPlanId = null;
let planningMode = 'setup'; // setup, selecting, planning, viewing
let weekDays = []; // Store the 7 days of current week starting from today
let lastNotificationCount = null; // Track notification count to detect new ones (null = not initialized)

// Generate calendar for the current week (today + next 6 days)
function generateCalendar() {
    const today = new Date();
    weekDays = [];
    
    // Generate 7 days starting from today
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const mondayBasedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to 0=Mon, 6=Sun
        
        weekDays.push({
            date: date,
            dayIndex: mondayBasedDay, // For backend compatibility (0=Mon, 6=Sun)
            dayName: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
            dayDate: date.getDate(),
            month: date.getMonth() + 1
        });
    }
    
    // Generate header
    const header = document.getElementById('calendarHeader');
    header.innerHTML = '<div></div>'; // Empty corner cell
    
    weekDays.forEach(day => {
        const dayLabel = document.createElement('div');
        dayLabel.className = 'day-label';
        dayLabel.innerHTML = `
            <div class="day-name">${day.dayName}</div>
            <div class="day-date">${day.month}/${day.dayDate}</div>
        `;
        header.appendChild(dayLabel);
    });
    
    // Generate grid
    const grid = document.getElementById('calendarGrid');
    const timeSlots = ['morning', 'afternoon', 'evening'];
    const timeLabels = ['MORN', 'AFTER', 'EVEN'];
    
    grid.innerHTML = '';
    
    timeSlots.forEach((slot, slotIndex) => {
        // Add time label
        const label = document.createElement('div');
        label.className = 'time-label';
        label.textContent = timeLabels[slotIndex];
        grid.appendChild(label);
        
        // Add time slots for each day
        weekDays.forEach((day, dayIndex) => {
            const timeSlot = document.createElement('div');
            timeSlot.className = 'time-slot';
            timeSlot.dataset.day = day.dayIndex; // Use Monday-based index for backend
            timeSlot.dataset.displayDay = dayIndex; // Use display index for UI
            timeSlot.dataset.date = day.date.toISOString().split('T')[0]; // Store actual date YYYY-MM-DD
            timeSlot.dataset.slot = slot;
            grid.appendChild(timeSlot);
        });
    });
}

// Initialize
// Logout function
function logout() {
    window.location.href = '/logout';
}

document.addEventListener('DOMContentLoaded', async () => {
    // Generate calendar first
    generateCalendar();
    
    // Fetch user info from session
    try {
        const response = await fetch('/api/auth/me', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            plannerInfo = { 
                id: data.user.id, 
                name: data.user.name, 
                phone: data.user.phone_number,
                email: data.user.email
            };
            
            document.getElementById('setupModal').classList.remove('active');
            loadFriends();
            loadAvailability();
            loadNotifications();
            
            // Check for new notifications every 10 seconds (which will auto-refresh calendar)
            setInterval(loadNotifications, 10000);
        } else {
            // Not authenticated, redirect to login
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
        window.location.href = '/login';
    }
    
    // Set up calendar click handlers
    setupCalendar();
    updatePlanButton();
});

// Setup planner
async function setupPlanner(event) {
    event.preventDefault();
    
    const firstName = document.getElementById('plannerFirstName').value.trim();
    const lastName = document.getElementById('plannerLastName').value.trim();
    const name = `${firstName} ${lastName}`;
    const phone = document.getElementById('plannerPhone').value;
    
    try {
        // Create or get user from database
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone_number: phone })
        });
        
        if (response.ok) {
            const user = await response.json();
            plannerInfo = { id: user.id, name: user.name, phone: user.phone_number, email: user.email };
            localStorage.setItem('gatherly_planner', JSON.stringify(plannerInfo));
            
            document.getElementById('setupModal').classList.remove('active');
            showStatus('Welcome, ' + name + '!', 'success');
            loadFriends();
            loadAvailability();
            loadNotifications();
        } else {
            showStatus('Error setting up. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Error setting up planner:', error);
        showStatus('Error setting up. Please try again.', 'error');
    }
}

// Load contacts (friends) from API
async function loadFriends() {
    if (!plannerInfo || !plannerInfo.id) {
        return;
    }
    
    try {
        const response = await fetch(`/api/contacts?owner_id=${plannerInfo.id}`);
        const contacts = await response.json();
        
        allFriends = contacts;
        renderFriends();
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

// Render friends list
function renderFriends() {
    const friendsList = document.getElementById('friendsList');
    friendsList.innerHTML = '<div class="friend-avatar add-btn" onclick="openAddFriendModal()">+</div>';
    
    // Get display map with subscripts for duplicate initials
    const displayMap = getContactDisplayMap(allFriends);
    
    allFriends.forEach(friend => {
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.textContent = displayMap[friend.id];
        avatar.onclick = () => toggleFriend(friend);
        avatar.dataset.friendId = friend.id;
        
        if (selectedFriends.find(f => f.id === friend.id)) {
            avatar.classList.add('selected');
        }
        
        friendsList.appendChild(avatar);
    });
}

// Get initials from name
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Get display text for contacts (with subscripts for duplicate initials)
function getContactDisplayMap(contacts) {
    const displayMap = {};
    const initialsGroups = {};
    
    // Group contacts by their initials
    contacts.forEach(contact => {
        const initials = getInitials(contact.name);
        if (!initialsGroups[initials]) {
            initialsGroups[initials] = [];
        }
        initialsGroups[initials].push(contact);
    });
    
    // Assign display text with subscripts for duplicates
    Object.keys(initialsGroups).forEach(initials => {
        const group = initialsGroups[initials];
        if (group.length === 1) {
            // No duplicates, just show initials
            displayMap[group[0].id] = initials;
        } else {
            // Duplicates exist, add subscript numbers
            group.forEach((contact, index) => {
                const subscript = String(index + 1).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
                displayMap[contact.id] = initials + subscript;
            });
        }
    });
    
    return displayMap;
}

// Toggle friend selection
function toggleFriend(friend) {
    const index = selectedFriends.findIndex(f => f.id === friend.id);
    
    if (index > -1) {
        selectedFriends.splice(index, 1);
    } else {
        selectedFriends.push(friend);
    }
    
    renderFriends();
    updatePlanButton();
}

// Open add friend modal
function openAddFriendModal() {
    document.getElementById('addFriendModal').classList.add('active');
}

// Close add friend modal
function closeAddFriendModal() {
    document.getElementById('addFriendModal').classList.remove('active');
    document.getElementById('friendFirstName').value = '';
    document.getElementById('friendLastName').value = '';
    document.getElementById('friendPhone').value = '';
}

// Open manage friends modal
function openManageFriendsModal() {
    renderManageFriends();
    document.getElementById('manageFriendsModal').classList.add('active');
}

// Close manage friends modal
function closeManageFriendsModal() {
    document.getElementById('manageFriendsModal').classList.remove('active');
}

// Render manage friends list
function renderManageFriends() {
    const manageList = document.getElementById('friendsManageList');
    
    if (allFriends.length === 0) {
        manageList.innerHTML = '<div class="no-friends-message">No friends added yet</div>';
        return;
    }
    
    // Get display map with subscripts for duplicate initials
    const displayMap = getContactDisplayMap(allFriends);
    
    manageList.innerHTML = allFriends.map(friend => `
        <div class="friend-manage-item">
            <div class="friend-manage-info">
                <div class="friend-manage-avatar">${displayMap[friend.id]}</div>
                <div class="friend-manage-details">
                    <div class="friend-manage-name">${friend.name}</div>
                    <div class="friend-manage-phone">${friend.phone_number}</div>
                </div>
            </div>
            <button class="btn-delete" onclick="deleteFriend(${friend.id})">Delete</button>
        </div>
    `).join('');
}

// Delete contact (friend)
async function deleteFriend(friendId) {
    if (!confirm('Are you sure you want to delete this friend?')) {
        return;
    }
    
    try {
        // Delete the contact from database (cascades to availability, plan_guests)
        const response = await fetch(`/api/contacts/${friendId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Remove from local arrays
            allFriends = allFriends.filter(f => f.id !== friendId);
            selectedFriends = selectedFriends.filter(f => f.id !== friendId);
            
            // Re-render both lists
            renderFriends();
            renderManageFriends();
            updatePlanButton();
            
            // Refresh calendar to remove their availability
            loadAvailability();
            
            showStatus('Friend removed', 'success');
        } else {
            showStatus('Error deleting friend', 'error');
        }
    } catch (error) {
        console.error('Error deleting friend:', error);
        showStatus('Error deleting friend', 'error');
    }
}

// Add contact (friend)
async function addFriend(event) {
    event.preventDefault();
    
    const firstName = document.getElementById('friendFirstName').value.trim();
    const lastName = document.getElementById('friendLastName').value.trim();
    const name = `${firstName} ${lastName}`;
    const phone = document.getElementById('friendPhone').value;
    
    if (!plannerInfo || !plannerInfo.id) {
        showStatus('Planner not set up', 'error');
        return;
    }
    
    try {
        // Create contact
        const response = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                owner_id: plannerInfo.id,
                name, 
                phone_number: phone 
            })
        });
        
        if (response.ok) {
            const contact = await response.json();
            
            // Add to local array if not already there
            if (!allFriends.find(f => f.id === contact.id)) {
                allFriends.push(contact);
            }
            if (!selectedFriends.find(f => f.id === contact.id)) {
                selectedFriends.push(contact);
            }
            
            renderFriends();
            closeAddFriendModal();
            showStatus('Friend added!', 'success');
            updatePlanButton();
        } else {
            showStatus('Error adding friend', 'error');
        }
    } catch (error) {
        console.error('Error adding friend:', error);
        showStatus('Error adding friend', 'error');
    }
}

// Setup calendar interaction
function setupCalendar() {
    const slots = document.querySelectorAll('.time-slot');
    
    slots.forEach(slot => {
        slot.addEventListener('click', () => {
            if (planningMode === 'viewing') return;
            
            const date = slot.dataset.date; // Use actual date instead of day index
            const timeSlot = slot.dataset.slot;
            
            slot.classList.toggle('selected');
            
            const slotIndex = selectedTimeSlots.findIndex(
                s => s.date === date && s.slot === timeSlot
            );
            
            if (slotIndex > -1) {
                selectedTimeSlots.splice(slotIndex, 1);
            } else {
                selectedTimeSlots.push({ date, slot: timeSlot });
            }
            
            updatePlanButton();
        });
    });
}

// Update plan button state
function updatePlanButton() {
    const button = document.getElementById('planButton');
    const hasSelections = selectedTimeSlots.length > 0 && selectedFriends.length > 0;
    
    if (hasSelections) {
        button.classList.remove('inactive');
        button.disabled = false;
    } else {
        button.classList.add('inactive');
        button.disabled = true;
    }
}

// Handle plan action
async function handlePlanAction() {
    await createPlan();
}

// Create plan and send invites
async function createPlan() {
    if (selectedFriends.length === 0) {
        showStatus('Please select at least one friend', 'error');
        return;
    }
    
    if (selectedTimeSlots.length === 0) {
        showStatus('Please select your availability', 'error');
        return;
    }
    
    const dateRange = getCalendarDateRange();
    
    const planData = {
        planner_id: plannerInfo.id,
        week_start_date: dateRange.start, // Use today's date as the start
        planner_availability: selectedTimeSlots,
        contact_ids: selectedFriends.map(f => f.id)
    };
    
    try {
        const response = await fetch('/api/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(planData)
        });
        
        if (response.ok) {
            const plan = await response.json();
            currentPlanId = plan.id;
            
            showStatus('Invites sent! Friends will receive a text with a link to respond.', 'success');
            
            // Clear friend selections but keep time slots displayed
            selectedFriends = [];
            renderFriends();
            updatePlanButton();
            
            // Refresh to show saved availability
            setTimeout(() => loadAvailability(), 1000);
        } else {
            showStatus('Error creating plan', 'error');
        }
    } catch (error) {
        console.error('Error creating plan:', error);
        showStatus('Error creating plan', 'error');
    }
}

// Get date range for displayed calendar (today + 6 days)
function getCalendarDateRange() {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);
    
    return {
        start: today.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
}

// Load availability for current week
async function loadAvailability() {
    if (!plannerInfo || !plannerInfo.id) {
        console.log('No planner info with ID');
        return;
    }
    
    try {
        const dateRange = getCalendarDateRange();
        console.log('Loading availability for date range:', dateRange.start, 'to', dateRange.end, 'planner ID:', plannerInfo.id);
        
        // Get all availability for this date range and planner
        const availResponse = await fetch(`/api/availability/daterange?planner_id=${plannerInfo.id}&start_date=${dateRange.start}&end_date=${dateRange.end}`);
        
        if (!availResponse.ok) {
            console.log('No availability found for this week');
            return;
        }
        
        const availabilities = await availResponse.json();
        console.log('Loaded availabilities:', availabilities);
        
        // Clear current display
        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.classList.remove('selected', 'multiple-users');
            slot.removeAttribute('data-count');
            // Remove any existing avatars
            const existingAvatars = slot.querySelector('.slot-avatars');
            if (existingAvatars) {
                existingAvatars.remove();
            }
        });
        
        // Get display map with subscripts for duplicate initials
        const displayMap = getContactDisplayMap(allFriends);
        
        // Group users by slot (exclude planner's own availability from bubbles)
        const slotUsers = {};
        const plannerSlots = new Set();
        
        availabilities.forEach(avail => {
            // Check if this is the planner's own availability
            const isPlanner = avail.contact_id === null;
            
            avail.time_slots.forEach(slot => {
                // Use date if available, fallback to day (for backwards compatibility)
                const key = slot.date ? `${slot.date}|${slot.slot}` : `${slot.day}|${slot.slot}`;
                
                if (isPlanner) {
                    // Just track planner slots for highlighting, don't add bubble
                    plannerSlots.add(key);
                } else {
                    // Add guest bubbles
                    if (!slotUsers[key]) {
                        slotUsers[key] = [];
                    }
                    slotUsers[key].push({
                        name: avail.contact_name,
                        initials: displayMap[avail.contact_id] || getInitials(avail.contact_name)
                    });
                }
            });
        });
        
        console.log('Slot users:', slotUsers);
        console.log('Planner slots:', plannerSlots);
        
        // Highlight planner's own slots (no bubbles) and populate selectedTimeSlots
        plannerSlots.forEach(key => {
            const [date, slot] = key.split('|'); // Changed separator to | to avoid date conflicts
            const element = document.querySelector(
                `.time-slot[data-date="${date}"][data-slot="${slot}"]`
            );
            if (element) {
                element.classList.add('selected');
                
                // Add to selectedTimeSlots array if not already there
                const exists = selectedTimeSlots.find(
                    s => s.date === date && s.slot === slot
                );
                if (!exists) {
                    selectedTimeSlots.push({ date, slot: slot });
                }
            }
        });
        
        // Update button state after loading availability
        updatePlanButton();
        
        // Add guest bubbles to their slots (don't highlight, just add bubbles)
        Object.keys(slotUsers).forEach(key => {
            const [date, slot] = key.split('|'); // Changed separator to | to avoid date conflicts
            const element = document.querySelector(
                `.time-slot[data-date="${date}"][data-slot="${slot}"]`
            );
            
            if (element) {
                // DON'T add 'selected' class - only planner selections should be highlighted
                // element.classList.add('selected'); // REMOVED
                
                // Create avatar container
                const avatarContainer = document.createElement('div');
                avatarContainer.className = 'slot-avatars';
                
                // Add avatars for each guest (stacked vertically)
                slotUsers[key].forEach((user, index) => {
                    const avatar = document.createElement('div');
                    avatar.className = 'slot-avatar';
                    avatar.textContent = user.initials;
                    avatar.title = user.name;
                    avatarContainer.appendChild(avatar);
                });
                
                element.appendChild(avatarContainer);
            }
        });
        
        console.log('Availability loaded successfully');
    } catch (error) {
        console.error('Error loading availability:', error);
    }
}

// Add a refresh button functionality
function refreshAvailability() {
    console.log('Manually refreshing availability...');
    loadAvailability();
}

// Show status message
function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
}

// Notifications functions
async function loadNotifications() {
    if (!plannerInfo || !plannerInfo.id) {
        return;
    }
    
    try {
        const response = await fetch(`/api/notifications/${plannerInfo.id}`);
        const notifications = await response.json();
        
        // Check if we have new notifications (more than before)
        const currentCount = notifications.length;
        if (lastNotificationCount !== null && currentCount > lastNotificationCount) {
            console.log('New notification detected, refreshing availability');
            // Refresh the calendar when new notifications arrive
            loadAvailability();
        }
        lastNotificationCount = currentCount;
        
        // Update badge count
        const unreadCount = notifications.filter(n => !n.read).length;
        const badge = document.getElementById('notificationBadge');
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
        
        // Render notifications
        renderNotifications(notifications);
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function renderNotifications(notifications) {
    const list = document.getElementById('notificationsList');
    console.log('Rendering notifications:', notifications);
    
    if (!list) {
        console.error('notificationsList element not found!');
        return;
    }
    
    if (notifications.length === 0) {
        list.innerHTML = '<div class="no-notifications">No notifications yet</div>';
        return;
    }
    
    try {
        const html = notifications.map(notif => {
            const timeAgo = getTimeAgo(new Date(notif.created_at));
            
            // System notifications (no contact) vs contact notifications
            if (!notif.contact_name) {
                // System notification - show checkmark icon and just the message
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'}">
                        <div class="notification-avatar system-notification">✓</div>
                        <div class="notification-content">
                            <div class="notification-text">${notif.message}</div>
                            <div class="notification-time">${timeAgo}</div>
                        </div>
                    </div>
                `;
            } else {
                // Contact notification - show contact initials and name
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'}">
                        <div class="notification-avatar">${getInitials(notif.contact_name)}</div>
                        <div class="notification-content">
                            <div class="notification-text">
                                <strong>${notif.contact_name}</strong> ${notif.message}
                            </div>
                            <div class="notification-time">${timeAgo}</div>
                        </div>
                    </div>
                `;
            }
        }).join('');
        
        console.log('Setting innerHTML with', html.length, 'characters');
        list.innerHTML = html;
    } catch (error) {
        console.error('Error rendering notifications:', error);
    }
}

function getTimeAgo(date) {
    const now = new Date();
    const notifDate = new Date(date);
    const seconds = Math.floor((now - notifDate) / 1000);
    
    console.log('getTimeAgo:', {
        now: now.toISOString(),
        notifDate: notifDate.toISOString(),
        secondsAgo: seconds
    });
    
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

let notificationUpdateInterval = null;

async function openNotifications() {
    document.getElementById('notificationsModal').classList.add('active');
    await loadNotifications();
    
    // Mark all as read
    if (plannerInfo && plannerInfo.id) {
        fetch(`/api/notifications/${plannerInfo.id}/mark-read`, {
            method: 'POST'
        });
        
        // Hide badge immediately
        document.getElementById('notificationBadge').style.display = 'none';
    }
    
    // Update timestamps every 5 seconds while modal is open
    if (notificationUpdateInterval) {
        clearInterval(notificationUpdateInterval);
    }
    notificationUpdateInterval = setInterval(() => {
        loadNotifications();
    }, 5000);
}

function closeNotifications() {
    document.getElementById('notificationsModal').classList.remove('active');
    
    // Stop updating timestamps when modal closes
    if (notificationUpdateInterval) {
        clearInterval(notificationUpdateInterval);
        notificationUpdateInterval = null;
    }
}

// Poll for new notifications every 30 seconds
setInterval(() => {
    if (plannerInfo && plannerInfo.id) {
        loadNotifications();
    }
}, 30000);

// Settings functions
async function openSettings() {
    if (!plannerInfo) {
        showStatus('Please set up your account first', 'error');
        return;
    }
    
    // Display account information
    const accountInfo = document.getElementById('accountInfo');
    accountInfo.innerHTML = `
        <div class="account-info-item">
            <div class="account-info-label">Name</div>
            <div class="account-info-value">${plannerInfo.name}</div>
        </div>
        <div class="account-info-item">
            <div class="account-info-label">Email</div>
            <div class="account-info-value">${plannerInfo.email}</div>
        </div>
        <div class="account-info-item">
            <div class="account-info-label">Phone Number</div>
            <div class="account-info-value">${plannerInfo.phone}</div>
        </div>
    `;
    
    // Load timezone and reminder preferences
    await loadTimezone();
    await loadReminderPreferences();
    
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function editAccount() {
    if (!plannerInfo) return;
    
    // Pre-fill form with current data
    const nameParts = plannerInfo.name.split(' ');
    document.getElementById('editFirstName').value = nameParts[0] || '';
    document.getElementById('editLastName').value = nameParts.slice(1).join(' ') || '';
    document.getElementById('editPhone').value = plannerInfo.phone;
    
    // Open edit modal
    document.getElementById('editAccountModal').classList.add('active');
}

function closeEditAccount() {
    document.getElementById('editAccountModal').classList.remove('active');
}

async function updateAccount(event) {
    event.preventDefault();
    
    const firstName = document.getElementById('editFirstName').value.trim();
    const lastName = document.getElementById('editLastName').value.trim();
    const name = `${firstName} ${lastName}`;
    const phone = document.getElementById('editPhone').value;
    
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone_number: phone })
        });
        
        if (response.ok) {
            const updatedUser = await response.json();
            plannerInfo = { id: updatedUser.id, name: updatedUser.name, phone: updatedUser.phone_number, email: updatedUser.email };
            localStorage.setItem('gatherly_planner', JSON.stringify(plannerInfo));
            
            closeEditAccount();
            closeSettings();
            showStatus('Account updated successfully!', 'success');
        } else {
            showStatus('Error updating account', 'error');
        }
    } catch (error) {
        console.error('Error updating account:', error);
        showStatus('Error updating account', 'error');
    }
}

// Reminder preferences functions
async function loadReminderPreferences() {
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}/reminders`);
        const data = await response.json();
        
        // Uncheck all checkboxes first
        document.querySelectorAll('input[name="reminder-day"]').forEach(cb => {
            cb.checked = false;
        });
        
        // Check the boxes for selected days
        if (data.reminder_days && Array.isArray(data.reminder_days)) {
            data.reminder_days.forEach(day => {
                const checkbox = document.querySelector(`input[name="reminder-day"][value="${day}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
        }
    } catch (error) {
        console.error('Error loading reminder preferences:', error);
    }
}

async function saveReminderPreferences() {
    try {
        // Get selected days
        const selectedDays = [];
        document.querySelectorAll('input[name="reminder-day"]:checked').forEach(cb => {
            selectedDays.push(cb.value);
        });
        
        const response = await fetch(`/api/users/${plannerInfo.id}/reminders`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reminder_days: selectedDays })
        });
        
        if (response.ok) {
            showStatus('Reminder preferences saved!', 'success');
            closeSettings(); // Auto-close modal after saving
        } else {
            showStatus('Error saving preferences', 'error');
        }
    } catch (error) {
        console.error('Error saving reminder preferences:', error);
        showStatus('Error saving preferences', 'error');
    }
}

// Timezone functions
async function loadTimezone() {
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}`);
        const user = await response.json();
        
        // Set the timezone dropdown
        const timezoneSelect = document.getElementById('timezoneSelect');
        if (timezoneSelect && user.timezone) {
            timezoneSelect.value = user.timezone;
        }
    } catch (error) {
        console.error('Error loading timezone:', error);
    }
}

async function saveTimezone() {
    try {
        const timezone = document.getElementById('timezoneSelect').value;
        
        const response = await fetch(`/api/users/${plannerInfo.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ timezone })
        });
        
        if (response.ok) {
            const updatedUser = await response.json();
            plannerInfo.timezone = updatedUser.timezone;
            showStatus('Timezone saved!', 'success');
            closeSettings(); // Auto-close modal after saving
        } else {
            showStatus('Error saving timezone', 'error');
        }
    } catch (error) {
        console.error('Error saving timezone:', error);
        showStatus('Error saving timezone', 'error');
    }
}

async function confirmDeleteAccount() {
    const confirmation = confirm(
        'Are you sure you want to delete your account?\n\n' +
        'This will permanently delete:\n' +
        '• All your contacts\n' +
        '• All your plans\n' +
        '• All your availability data\n\n' +
        'This action cannot be undone.'
    );
    
    if (!confirmation) return;
    
    // Double confirmation
    const doubleConfirm = confirm('This is your last chance. Delete account permanently?');
    if (!doubleConfirm) return;
    
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Clear local storage
            localStorage.removeItem('gatherly_planner');
            localStorage.removeItem('gatherly_friends');
            
            // Show success message
            alert('Your account has been deleted successfully.');
            
            // Reload page to show setup modal
            window.location.reload();
        } else {
            showStatus('Error deleting account', 'error');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showStatus('Error deleting account', 'error');
    }
}
