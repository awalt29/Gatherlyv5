// Global state
let plannerInfo = null;
let selectedFriends = [];
let allFriends = [];
let selectedTimeSlots = [];
let originalTimeSlots = []; // Track the saved state to detect changes
let currentPlanId = null;
let planningMode = 'setup'; // setup, selecting, planning, viewing
let weekDays = []; // Store the 7 days of current week starting from today
let lastNotificationCount = null; // Track notification count to detect new ones (null = not initialized)
let lastNotificationData = null; // Track last rendered data to avoid unnecessary re-renders
let pushSubscription = null; // Store current push subscription

// =====================
// Push Notifications
// =====================

async function initPushNotifications() {
    // Check if push is supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('[PUSH] Push notifications not supported');
        return;
    }
    
    try {
        // Register service worker from root for proper scope
        console.log('[PUSH] Registering service worker...');
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PUSH] Service worker registered, scope:', registration.scope);
        
        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;
        console.log('[PUSH] Service worker is ready');
        
        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'OPEN_NOTIFICATIONS') {
                openNotifications();
            }
        });
        
        // Check if already subscribed
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            pushSubscription = subscription;
            console.log('[PUSH] Already subscribed');
            // Sync subscription with server (in case user cleared browser data)
            fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subscription.toJSON())
            }).catch(e => console.log('[PUSH] Sync error:', e));
        } else {
            console.log('[PUSH] Not subscribed yet');
        }
    } catch (error) {
        console.error('[PUSH] Error initializing:', error);
    }
}

async function requestPushPermission() {
    // Check if push is supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('[PUSH] Push notifications not supported');
        showStatus('Push notifications not supported on this browser', 'error');
        return false;
    }
    
    // Check current permission
    if (Notification.permission === 'denied') {
        console.log('[PUSH] Notifications are blocked');
        showStatus('Notifications are blocked. Please enable in browser settings.', 'error');
        return false;
    }
    
    if (Notification.permission === 'granted' && pushSubscription) {
        console.log('[PUSH] Already have permission and subscription');
        return true;
    }
    
    try {
        // Get VAPID public key from server
        console.log('[PUSH] Fetching VAPID key...');
        const keyResponse = await fetch('/api/push/vapid-key');
        console.log('[PUSH] VAPID key response status:', keyResponse.status);
        if (!keyResponse.ok) {
            const errorText = await keyResponse.text();
            console.error('[PUSH] VAPID key error:', errorText);
            showStatus('Push notifications not configured on server', 'error');
            return false;
        }
        const keyData = await keyResponse.json();
        console.log('[PUSH] Got VAPID key:', keyData.publicKey ? 'yes' : 'no');
        const publicKey = keyData.publicKey;
        
        if (!publicKey) {
            console.error('[PUSH] No public key in response');
            showStatus('Push notifications not configured', 'error');
            return false;
        }
        
        // Request permission
        console.log('[PUSH] Requesting permission...');
        const permission = await Notification.requestPermission();
        console.log('[PUSH] Permission result:', permission);
        if (permission !== 'granted') {
            console.log('[PUSH] Permission denied');
            showStatus('Notification permission denied', 'error');
            return false;
        }
        
        // Subscribe to push
        console.log('[PUSH] Subscribing to push manager...');
        const registration = await navigator.serviceWorker.ready;
        console.log('[PUSH] Service worker ready, state:', registration.active?.state);
        
        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            console.log('[PUSH] Already have existing subscription');
        } else {
            console.log('[PUSH] Creating new subscription with key:', publicKey.substring(0, 20) + '...');
            try {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey)
                });
                console.log('[PUSH] Created new subscription');
            } catch (subscribeError) {
                console.error('[PUSH] Subscribe error:', subscribeError);
                showStatus('Error subscribing: ' + subscribeError.message, 'error');
                return false;
            }
        }
        console.log('[PUSH] Got subscription');
        
        // Send subscription to server
        console.log('[PUSH] Saving subscription to server...');
        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription.toJSON())
        });
        
        console.log('[PUSH] Server response status:', response.status);
        if (response.ok) {
            pushSubscription = subscription;
            console.log('[PUSH] Successfully subscribed!');
            return true;
        } else {
            const errorData = await response.text();
            console.error('[PUSH] Failed to save subscription:', errorData);
            showStatus('Failed to save subscription', 'error');
            return false;
        }
    } catch (error) {
        console.error('[PUSH] Error subscribing:', error);
        showStatus('Error enabling notifications: ' + error.message, 'error');
        return false;
    }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Show custom prompt before browser permission request
function showPushPermissionPrompt() {
    // Don't show if already subscribed or denied
    if (pushSubscription || Notification.permission === 'denied') {
        return;
    }
    
    // Create custom prompt
    const overlay = document.createElement('div');
    overlay.className = 'push-prompt-overlay';
    overlay.id = 'pushPromptOverlay';
    
    const prompt = document.createElement('div');
    prompt.className = 'push-prompt';
    prompt.innerHTML = `
        <div class="push-prompt-icon">🔔</div>
        <h3 class="push-prompt-title">Stay in the loop!</h3>
        <p class="push-prompt-text">Get notified instantly when friends share their availability or send you hangout invites.</p>
        <div class="push-prompt-buttons">
            <button class="push-prompt-btn push-prompt-later" onclick="closePushPrompt()">Not now</button>
            <button class="push-prompt-btn push-prompt-enable" onclick="enablePushFromPrompt()">Enable</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(prompt);
    
    // Animate in
    setTimeout(() => {
        overlay.classList.add('active');
        prompt.classList.add('active');
    }, 10);
}

function closePushPrompt() {
    const overlay = document.getElementById('pushPromptOverlay');
    const prompt = document.querySelector('.push-prompt');
    if (overlay) overlay.remove();
    if (prompt) prompt.remove();
}

async function enablePushFromPrompt() {
    closePushPrompt();
    const success = await requestPushPermission();
    if (success) {
        showStatus('Notifications enabled! 🔔', 'success');
    }
}

async function testPushNotification() {
    try {
        const response = await fetch('/api/push/test', { method: 'POST' });
        if (response.ok) {
            showStatus('Test notification sent!', 'success');
        } else {
            showStatus('Failed to send test notification', 'error');
        }
    } catch (error) {
        console.error('Error testing push:', error);
    }
}
let currentPopupSlot = null; // Track the slot the popup is open for

// Get today's date as YYYY-MM-DD string (no timezone conversion)
function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Format phone number for display: (XXX) XXX-XXXX
function formatPhoneDisplay(phone) {
    if (!phone) return '';
    // Strip all non-digits
    const digits = phone.replace(/\D/g, '');
    // Get last 10 digits
    const last10 = digits.slice(-10);
    if (last10.length === 10) {
        return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
    }
    // If not 10 digits, return original
    return phone;
}

// Bold a name in a notification message
function formatNotificationMessage(message, fromUserName) {
    if (!message) return '';
    if (!fromUserName) return message;
    
    // Escape special regex characters in the name
    const escapedName = fromUserName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Replace the name with a bolded version
    return message.replace(new RegExp(escapedName, 'g'), `<strong>${fromUserName}</strong>`);
}

// Add days to a YYYY-MM-DD date string (pure math, no Date objects!)
function addDaysToDateString(dateStr, daysToAdd) {
    const [year, month, day] = dateStr.split('-').map(Number);
    
    // Calculate total days since epoch for simple math
    const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    
    // Check for leap year
    const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    if (isLeapYear(year)) daysInMonth[2] = 29;
    
    let newDay = day + daysToAdd;
    let newMonth = month;
    let newYear = year;
    
    // Handle month overflow
    while (newDay > daysInMonth[newMonth]) {
        newDay -= daysInMonth[newMonth];
        newMonth++;
        if (newMonth > 12) {
            newMonth = 1;
            newYear++;
            if (isLeapYear(newYear)) daysInMonth[2] = 29;
            else daysInMonth[2] = 28;
        }
    }
    
    return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

// Generate calendar for the next 7 days (starting tomorrow)
function generateCalendar() {
    const todayStr = getTodayString();
    console.log('📅 STARTING FROM:', todayStr);
    weekDays = [];
    
    // Generate 14 days starting from today (2 weeks)
    for (let i = 0; i < 14; i++) {
        const dateStr = addDaysToDateString(todayStr, i);
        const [year, month, day] = dateStr.split('-').map(Number);
        
        // Create date at noon local time to avoid any timezone issues
        const date = new Date(year, month - 1, day, 12, 0, 0);
        
        const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const mondayBasedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to 0=Mon, 6=Sun
        
        weekDays.push({
            dateString: dateStr, // Store as string!
            dayIndex: mondayBasedDay, // For backend compatibility (0=Mon, 6=Sun)
            dayName: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
            dayDate: day,
            month: month
        });
        
        console.log(`📅 Day ${i}: ${date.toLocaleDateString('en-US', { weekday: 'short' })} ${month}/${day} → dateString: ${dateStr}`);
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
            timeSlot.dataset.date = day.dateString; // Use the pre-calculated date string
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
                email: data.user.email,
                weekly_reminders_enabled: data.user.weekly_reminders_enabled !== false,
                has_seen_install_prompt: data.user.has_seen_install_prompt === true
            };
            
            // Show the main content now that we're authenticated
            document.querySelector('.container').style.opacity = '1';
            document.getElementById('setupModal').classList.remove('active');
            // Load linked friends first (for active status), then contacts, then availability
            await loadLinkedFriends();
            await loadFriends();
            loadMyAvailability();
            loadFriendsAvailability();
            loadHangoutStatuses();
            loadNotifications();
            
            // Check for new notifications every 10 seconds (which will auto-refresh calendar)
            setInterval(loadNotifications, 10000);
            
            // Initialize push notifications
            initPushNotifications();
            
            // Show "Add to Home Screen" prompt for iOS users (also applies to existing users on login)
            setTimeout(() => showInstallPopup(), 1500);
            
            // Check for pending hangout invites or #notifications hash - auto-open modal (once per invite)
            setTimeout(async () => {
                // Check if URL has #notifications hash
                const hasHash = window.location.hash === '#notifications';
                
                // Check if there are NEW pending hangout invites we haven't shown yet
                const response = await fetch(`/api/notifications/${plannerInfo.id}`);
                const notifications = await response.json();
                
                // Get list of invite IDs we've already auto-opened for
                const seenInvites = JSON.parse(localStorage.getItem('seenHangoutInvites') || '[]');
                
                // Find pending invites we haven't shown yet
                const newPendingInvites = notifications.filter(n => {
                    if (n.notification_type === 'hangout_invite' && n.hangout) {
                        const myInvite = n.hangout.invitees?.find(inv => inv.user_id === plannerInfo.id);
                        const isPending = myInvite && myInvite.status === 'pending';
                        const isNew = !seenInvites.includes(n.hangout_id);
                        return isPending && isNew;
                    }
                    return false;
                });
                
                if (hasHash || newPendingInvites.length > 0) {
                    openNotifications();
                    
                    // Mark these invites as seen
                    const newSeenIds = newPendingInvites.map(n => n.hangout_id);
                    localStorage.setItem('seenHangoutInvites', JSON.stringify([...seenInvites, ...newSeenIds]));
                    
                    // Clear the hash if present
                    if (hasHash) {
                        history.replaceState(null, null, ' ');
                    }
                }
            }, 300);
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
    
    // Set up scroll hint for calendar
    setupCalendarScrollHint();
});

// Setup scroll hint for 2-week calendar
function setupCalendarScrollHint() {
    const calendar = document.querySelector('.calendar');
    const calendarSection = document.querySelector('.calendar-section');
    
    if (!calendar || !calendarSection) return;
    
    calendar.addEventListener('scroll', () => {
        // Check if scrolled to the end (with small buffer)
        const isAtEnd = calendar.scrollLeft + calendar.clientWidth >= calendar.scrollWidth - 10;
        
        if (isAtEnd) {
            calendarSection.classList.add('scrolled-end');
        } else {
            calendarSection.classList.remove('scrolled-end');
        }
    });
}

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
            plannerInfo = { id: user.id, name: user.name, phone: user.phone_number, email: user.email, weekly_reminders_enabled: user.weekly_reminders_enabled !== false, has_seen_install_prompt: user.has_seen_install_prompt === true };
            localStorage.setItem('gatherly_planner', JSON.stringify(plannerInfo));
            
            document.getElementById('setupModal').classList.remove('active');
            showStatus('Welcome, ' + name + '!', 'success');
            // Load linked friends first (for active status), then contacts, then availability
            await loadLinkedFriends();
            await loadFriends();
            loadMyAvailability();
            loadFriendsAvailability();
            loadNotifications();
            
            // Initialize push notifications
            initPushNotifications();
            
            // Show "Add to Home Screen" prompt for iOS users
            setTimeout(() => showInstallPopup(), 1500);
            
            // Show push notification prompt for new users (after a delay)
            setTimeout(() => showPushPermissionPrompt(), 3000);
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
        
        // Auto-select all linked friends by default (so their availability shows)
        selectedFriends = contacts.filter(c => c.is_linked);
        
        renderFriends();
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

// Render friends list
function renderFriends() {
    const friendsList = document.getElementById('friendsList');
    const wrapper = document.getElementById('friendsListWrapper');
    friendsList.innerHTML = '';
    
    // Get display map with subscripts for duplicate initials
    const displayMap = getContactDisplayMap(allFriends);
    
    allFriends.forEach(friend => {
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.textContent = displayMap[friend.id];
        avatar.dataset.friendId = friend.id;
        
        // Check if this linked friend is active (has shared availability)
        let isInactiveFriend = false;
        if (friend.is_linked && friend.linked_user_id) {
            const linkedFriendData = linkedFriends.find(lf => lf.id === friend.linked_user_id);
            isInactiveFriend = linkedFriendData && !linkedFriendData.is_active_this_week;
        }
        
        // For inactive linked friends: show indicator and prompt nudge on tap
        if (isInactiveFriend) {
            avatar.classList.add('inactive-friend');
            avatar.onclick = () => promptNudge(friend);
        } else {
            avatar.onclick = () => toggleFriend(friend);
        }
        
        if (selectedFriends.find(f => f.id === friend.id)) {
            avatar.classList.add('selected');
        }
        
        // Show pending badge for awaiting response
        if (friend.is_pending) {
            avatar.classList.add('pending');
            const badge = document.createElement('span');
            badge.className = 'pending-badge';
            badge.textContent = '⏳';
            badge.title = 'Waiting for response';
            avatar.appendChild(badge);
        }
        
        friendsList.appendChild(avatar);
    });
    
    // Check for overflow and setup scroll detection
    setTimeout(() => {
        checkFriendsListOverflow();
        setupFriendsListScrollListener();
    }, 0);
}

// Prompt to nudge an inactive friend
function promptNudge(friend) {
    showNudgeConfirm(friend);
}

// Custom themed confirm dialog for nudge
function showNudgeConfirm(friend) {
    // Remove any existing dialog
    const existing = document.getElementById('nudgeConfirmDialog');
    if (existing) existing.remove();
    
    const dialog = document.createElement('div');
    dialog.id = 'nudgeConfirmDialog';
    dialog.className = 'nudge-confirm-overlay';
    dialog.innerHTML = `
        <div class="nudge-confirm-dialog">
            <div class="nudge-confirm-message">
                <strong>${friend.name}</strong> hasn't shared their availability yet.
            </div>
            <div class="nudge-confirm-question">Send them a nudge?</div>
            <div class="nudge-confirm-buttons">
                <button class="nudge-confirm-cancel" onclick="closeNudgeConfirm()">Cancel</button>
                <button class="nudge-confirm-ok" onclick="confirmNudge(${friend.linked_user_id}, '${friend.name.replace(/'/g, "\\'")}')">Send Nudge</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Close on overlay click
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeNudgeConfirm();
    });
}

function closeNudgeConfirm() {
    const dialog = document.getElementById('nudgeConfirmDialog');
    if (dialog) dialog.remove();
}

function confirmNudge(friendUserId, friendName) {
    closeNudgeConfirm();
    sendNudge(friendUserId, friendName);
}

// Check if friends list has overflow (more than visible)
function checkFriendsListOverflow() {
    const friendsList = document.getElementById('friendsList');
    const wrapper = document.getElementById('friendsListWrapper');
    if (!friendsList || !wrapper) return;
    
    const hasOverflow = friendsList.scrollWidth > friendsList.clientWidth;
    wrapper.classList.toggle('has-overflow', hasOverflow);
    
    // Check if scrolled from start (show left gradient)
    const isAtStart = friendsList.scrollLeft <= 5;
    wrapper.classList.toggle('scrolled-start', !isAtStart && hasOverflow);
    
    // Check if already scrolled to end (hide right gradient)
    const isAtEnd = friendsList.scrollLeft + friendsList.clientWidth >= friendsList.scrollWidth - 5;
    wrapper.classList.toggle('scrolled-end', isAtEnd);
}

// Setup scroll listener to hide gradient when scrolled to end
let friendsScrollListenerAdded = false;
function setupFriendsListScrollListener() {
    const friendsList = document.getElementById('friendsList');
    const wrapper = document.getElementById('friendsListWrapper');
    if (!friendsList || !wrapper || friendsScrollListenerAdded) return;
    
    friendsList.addEventListener('scroll', () => {
        // Show left gradient when scrolled from start
        const isAtStart = friendsList.scrollLeft <= 5;
        wrapper.classList.toggle('scrolled-start', !isAtStart);
        
        // Hide right gradient when scrolled to end
        const isAtEnd = friendsList.scrollLeft + friendsList.clientWidth >= friendsList.scrollWidth - 5;
        wrapper.classList.toggle('scrolled-end', isAtEnd);
    });
    
    friendsScrollListenerAdded = true;
}

// Long press detection for nudge feature
let longPressTimer = null;
const LONG_PRESS_DURATION = 500; // ms

function setupLongPress(element, friend) {
    let pressStarted = false;
    
    // Mouse events
    element.addEventListener('mousedown', (e) => {
        pressStarted = true;
        longPressTimer = setTimeout(() => {
            if (pressStarted) {
                e.preventDefault();
                showNudgePopup(friend, e);
            }
        }, LONG_PRESS_DURATION);
    });
    
    element.addEventListener('mouseup', () => {
        pressStarted = false;
        clearTimeout(longPressTimer);
    });
    
    element.addEventListener('mouseleave', () => {
        pressStarted = false;
        clearTimeout(longPressTimer);
    });
    
    // Touch events for mobile
    element.addEventListener('touchstart', (e) => {
        pressStarted = true;
        longPressTimer = setTimeout(() => {
            if (pressStarted) {
                e.preventDefault();
                showNudgePopup(friend, e);
            }
        }, LONG_PRESS_DURATION);
    }, { passive: false });
    
    element.addEventListener('touchend', () => {
        pressStarted = false;
        clearTimeout(longPressTimer);
    });
    
    element.addEventListener('touchmove', () => {
        pressStarted = false;
        clearTimeout(longPressTimer);
    });
}

// Show nudge popup
function showNudgePopup(friend, event) {
    // Close any existing popup
    closeNudgePopup();
    
    const popup = document.createElement('div');
    popup.className = 'nudge-popup';
    popup.id = 'nudgePopup';
    
    popup.innerHTML = `
        <div class="nudge-popup-content">
            <div class="nudge-popup-header">
                <span class="nudge-friend-name">${friend.name}</span>
            </div>
            <button class="nudge-btn" onclick="sendNudge(${friend.linked_user_id}, '${friend.name.replace(/'/g, "\\'")}')">
                👋 Send Nudge
            </button>
            <button class="nudge-cancel-btn" onclick="closeNudgePopup()">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Position near the element
    const rect = event.target.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 10}px`;
    popup.style.left = `${Math.max(10, rect.left - 50)}px`;
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeNudgePopupOnOutsideClick);
    }, 100);
}

function closeNudgePopupOnOutsideClick(e) {
    const popup = document.getElementById('nudgePopup');
    if (popup && !popup.contains(e.target)) {
        closeNudgePopup();
    }
}

function closeNudgePopup() {
    const popup = document.getElementById('nudgePopup');
    if (popup) {
        popup.remove();
    }
    document.removeEventListener('click', closeNudgePopupOnOutsideClick);
}

// Send nudge to friend
async function sendNudge(friendUserId, friendName) {
    closeNudgePopup();
    
    try {
        const response = await fetch(`/api/nudge/${friendUserId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(`Nudge sent to ${friendName}!`, 'success');
        } else if (response.status === 400 && data.already_active) {
            // Friend already has availability
            alert(`${friendName} has already shared their availability!`);
        } else {
            showStatus(data.error || 'Error sending nudge', 'error');
        }
    } catch (error) {
        console.error('Error sending nudge:', error);
        showStatus('Error sending nudge', 'error');
    }
}

// Get initials from name
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Drag and drop handlers for manage friends modal
let draggedManageItem = null;

function handleManageDragStart(e) {
    console.log('Drag started');
    draggedManageItem = e.currentTarget; // Use currentTarget instead of target
    e.currentTarget.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
}

function handleManageDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    
    e.dataTransfer.dropEffect = 'move';
    
    // Get the item being dragged over (could be child element)
    let targetItem = e.target;
    while (targetItem && !targetItem.classList.contains('friend-manage-item')) {
        targetItem = targetItem.parentElement;
    }
    
    // Visual feedback
    if (targetItem && targetItem.classList.contains('friend-manage-item') && targetItem !== draggedManageItem) {
        targetItem.style.borderTop = '2px solid var(--accent-mint)';
    }
    
    return false;
}

function handleManageDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    console.log('Drop event fired');
    
    // Get the item being dropped on (could be child element)
    let targetItem = e.target;
    while (targetItem && !targetItem.classList.contains('friend-manage-item')) {
        targetItem = targetItem.parentElement;
    }
    
    if (!targetItem || !targetItem.classList.contains('friend-manage-item')) {
        console.log('Invalid drop target');
        return false;
    }
    
    if (draggedManageItem !== targetItem) {
        console.log('Reordering items');
        // Get all items
        const manageList = document.getElementById('friendsManageList');
        const allItems = Array.from(manageList.querySelectorAll('.friend-manage-item'));
        
        // Get indices
        const draggedIndex = allItems.indexOf(draggedManageItem);
        const targetIndex = allItems.indexOf(targetItem);
        
        console.log(`Moving from ${draggedIndex} to ${targetIndex}`);
        
        // Reorder in the allFriends array
        const [removed] = allFriends.splice(draggedIndex, 1);
        allFriends.splice(targetIndex, 0, removed);
        
        // Save new order to backend
        saveContactOrder();
        
        // Re-render both the modal and the main friend bubbles
        renderManageFriends();
        renderFriends();
    }
    
    return false;
}

function handleManageDragEnd(e) {
    console.log('Drag ended');
    e.currentTarget.style.opacity = '1';
    
    // Remove all border highlights
    const manageList = document.getElementById('friendsManageList');
    manageList.querySelectorAll('.friend-manage-item').forEach(item => {
        item.style.borderTop = '';
    });
}

// Touch event handlers for mobile drag-and-drop
let touchedItem = null;
let touchStartY = 0;
let touchCurrentY = 0;

function handleManageTouchStart(e) {
    // Get the parent item from the drag handle
    touchedItem = e.currentTarget.closest('.friend-manage-item');
    if (!touchedItem) return;
    
    touchStartY = e.touches[0].clientY;
    touchedItem.style.opacity = '0.5';
    console.log('Touch started');
}

function handleManageTouchMove(e) {
    if (!touchedItem) return;
    
    e.preventDefault(); // Prevent scrolling while dragging
    touchCurrentY = e.touches[0].clientY;
    
    const manageList = document.getElementById('friendsManageList');
    const allItems = Array.from(manageList.querySelectorAll('.friend-manage-item'));
    
    // Find which item we're over
    const currentIndex = allItems.indexOf(touchedItem);
    const touchedIndex = allItems.findIndex(item => {
        const rect = item.getBoundingClientRect();
        return touchCurrentY >= rect.top && touchCurrentY <= rect.bottom;
    });
    
    if (touchedIndex !== -1 && touchedIndex !== currentIndex) {
        // Swap in DOM
        if (touchedIndex < currentIndex) {
            manageList.insertBefore(touchedItem, allItems[touchedIndex]);
        } else {
            manageList.insertBefore(touchedItem, allItems[touchedIndex].nextSibling);
        }
    }
}

function handleManageTouchEnd(e) {
    if (!touchedItem) return;
    
    console.log('Touch ended');
    touchedItem.style.opacity = '1';
    
    // Get final order from DOM
    const manageList = document.getElementById('friendsManageList');
    const allItems = Array.from(manageList.querySelectorAll('.friend-manage-item'));
    
    // Reorder allFriends array to match DOM order
    const newOrder = allItems.map(item => {
        const friendId = parseInt(item.dataset.friendId);
        return allFriends.find(f => f.id === friendId);
    });
    
    allFriends.length = 0;
    allFriends.push(...newOrder);
    
    // Save new order to backend
    saveContactOrder();
    
    // Re-render friend bubbles
    renderFriends();
    
    touchedItem = null;
}

// Save contact order to backend
async function saveContactOrder() {
    try {
        const contactIds = allFriends.map(f => f.id);
        
        await fetch('/api/contacts/reorder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contact_ids: contactIds
            })
        });
    } catch (error) {
        console.error('Error saving contact order:', error);
    }
}

// Get display text for contacts (with subscripts for duplicate initials)
function getContactDisplayMap(contacts) {
    const displayMap = {};
    const initialsGroups = {};
    
    // Group contacts by their initials (only for linked/pending contacts)
    contacts.forEach(contact => {
        // If contact is not on platform and not pending, show smiley
        if (!contact.is_linked && !contact.is_pending) {
            displayMap[contact.id] = '=)';
            return;
        }
        
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
        // Deselecting - hide their availability
        selectedFriends.splice(index, 1);
    } else {
        // Selecting - show their availability
        selectedFriends.push(friend);
    }
    
    renderFriends();
    // Re-display friends availability with the new filter
    displayFriendsAvailability();
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
    // Hide name fields for next time
    document.getElementById('nameFieldsContainer').style.display = 'none';
}

// Show add friend view in manage modal
function showAddFriendView() {
    document.getElementById('manageFriendsListView').style.display = 'none';
    document.getElementById('manageFriendsAddView').style.display = 'block';
}

// Show friends list view in manage modal
function showFriendsListView() {
    document.getElementById('manageFriendsAddView').style.display = 'none';
    document.getElementById('manageFriendsListView').style.display = 'block';
    // Clear the add form
    document.getElementById('manageFriendPhone').value = '';
}

// Add friend from manage modal
async function addFriendFromManage(event) {
    event.preventDefault();
    
    const phone = document.getElementById('manageFriendPhone').value.trim();
    
    if (!plannerInfo || !plannerInfo.id) {
        showStatus('Planner not set up', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                owner_id: plannerInfo.id,
                phone_number: phone 
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const contact = data;
            
            // Add to local array if not already there
            if (!allFriends.find(f => f.id === contact.id)) {
                allFriends.push(contact);
            }
            if (!selectedFriends.find(f => f.id === contact.id) && contact.is_linked) {
                selectedFriends.push(contact);
            }
            
            renderFriends();
            renderManageFriends();
            showFriendsListView();  // Go back to list view
            
            // Check if friend is on the platform
            if (contact.is_on_platform === false) {
                showInvitePrompt(contact);
            } else if (contact.is_pending) {
                showStatus('Friend added! Waiting for them to accept your request.', 'success');
            } else if (contact.is_linked) {
                showStatus('Friend added! You\'re already connected.', 'success');
            } else {
                showStatus('Friend added!', 'success');
            }
        } else {
            showStatus(data.error || 'Error adding friend', 'error');
        }
    } catch (error) {
        console.error('Error adding friend:', error);
        showStatus('Error adding friend', 'error');
    }
}

// Open manage friends modal
function openManageFriendsModal() {
    renderManageFriends();
    document.getElementById('manageFriendsModal').classList.add('active');
}

// Close manage friends modal
function closeManageFriendsModal() {
    document.getElementById('manageFriendsModal').classList.remove('active');
    // Reset to list view for next time
    showFriendsListView();
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
    
    manageList.innerHTML = '';
    
    allFriends.forEach(friend => {
        const item = document.createElement('div');
        item.className = 'friend-manage-item';
        item.dataset.friendId = friend.id;
        item.draggable = true;
        
        // Determine status badge (only show for pending or not on app)
        let statusBadge = '';
        if (friend.is_pending) {
            statusBadge = '<span class="friend-status pending">⏳ Pending</span>';
        } else if (!friend.is_linked) {
            statusBadge = '<span class="friend-status not-on-app">Not on app</span>';
        }
        
        item.innerHTML = `
            <div class="friend-manage-drag-handle">☰</div>
            <div class="friend-manage-info">
                <div class="friend-manage-avatar">${displayMap[friend.id]}</div>
                <div class="friend-manage-details">
                    <div class="friend-manage-name">${friend.name}</div>
                    <div class="friend-manage-phone">${formatPhoneDisplay(friend.phone_number)}</div>
                    ${statusBadge ? `<div class="friend-manage-status">${statusBadge}</div>` : ''}
                </div>
            </div>
            <div class="friend-manage-actions">
                <button class="btn-delete">Delete</button>
            </div>
        `;
        
        // Add delete handler
        const deleteBtn = item.querySelector('.btn-delete');
        deleteBtn.onclick = () => deleteFriend(friend.id);
        
        // Get the drag handle
        const dragHandle = item.querySelector('.friend-manage-drag-handle');
        
        // Add drag handlers for desktop - only to the handle
        dragHandle.addEventListener('mousedown', (e) => {
            item.draggable = true;
        });
        item.addEventListener('dragstart', handleManageDragStart);
        item.addEventListener('dragover', handleManageDragOver);
        item.addEventListener('drop', handleManageDrop);
        item.addEventListener('dragend', (e) => {
            handleManageDragEnd(e);
            item.draggable = false;
        });
        
        // Add touch handlers for mobile - only to the handle
        dragHandle.addEventListener('touchstart', handleManageTouchStart, { passive: false });
        dragHandle.addEventListener('touchmove', handleManageTouchMove, { passive: false });
        dragHandle.addEventListener('touchend', handleManageTouchEnd);
        
        manageList.appendChild(item);
    });
}

// Delete contact (friend)
async function deleteFriend(friendId) {
    if (!confirm('Are you sure you want to delete this friend?')) {
        return;
    }
    
    try {
        // Delete the contact from database (cascades to availability, plan_guests, friendship)
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
            loadLinkedFriends();
            loadFriendsAvailability();
            
            showStatus('Friend removed', 'success');
        } else {
            showStatus('Error deleting friend', 'error');
        }
    } catch (error) {
        console.error('Error deleting friend:', error);
        showStatus('Error deleting friend', 'error');
    }
}

// Show invite prompt for contacts not on the platform
function showInvitePrompt(contact) {
    const shouldInvite = confirm(
        `${contact.name} isn't on Gatherly yet.\n\nWould you like to send them a text invite to join?`
    );
    
    if (shouldInvite) {
        sendInvite(contact.id, contact.name);
    } else {
        showStatus('Friend added! You can invite them later from Manage Friends.', 'success');
    }
}

// Send invite SMS to contact
async function sendInvite(contactId, contactName) {
    try {
        const response = await fetch(`/api/contacts/${contactId}/invite`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showStatus(`Invite sent to ${contactName}!`, 'success');
            loadNotifications();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to send invite', 'error');
        }
    } catch (error) {
        console.error('Error sending invite:', error);
        showStatus('Error sending invite', 'error');
    }
}

// Add contact (friend)
async function addFriend(event) {
    event.preventDefault();
    
    const phone = document.getElementById('friendPhone').value.trim();
    const firstName = document.getElementById('friendFirstName').value.trim();
    const lastName = document.getElementById('friendLastName').value.trim();
    const nameFieldsContainer = document.getElementById('nameFieldsContainer');
    
    // Build name if provided
    let name = '';
    if (firstName || lastName) {
        name = `${firstName} ${lastName}`.trim();
    }
    
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
                name: name || null, 
                phone_number: phone 
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const contact = data;
            
            // Add to local array if not already there
            if (!allFriends.find(f => f.id === contact.id)) {
                allFriends.push(contact);
            }
            if (!selectedFriends.find(f => f.id === contact.id) && contact.is_linked) {
                selectedFriends.push(contact);
            }
            
            renderFriends();
            closeAddFriendModal();
            
            // Check if friend is on the platform
            if (contact.is_on_platform === false) {
                // Show invite option
                showInvitePrompt(contact);
            } else if (contact.is_pending) {
                showStatus('Friend added! Waiting for them to accept your request.', 'success');
            } else if (contact.is_linked) {
                showStatus('Friend added! You\'re already connected.', 'success');
            } else {
                showStatus('Friend added!', 'success');
            }
        } else if (data.error === 'name_required') {
            // Show name fields and prompt user
            nameFieldsContainer.style.display = 'block';
            document.getElementById('friendFirstName').focus();
            showStatus('This person isn\'t on Gatherly. Please add their name.', 'error');
        } else {
            showStatus(data.error || 'Error adding friend', 'error');
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
        slot.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (planningMode === 'viewing') return;
            
            const date = slot.dataset.date;
            const timeSlot = slot.dataset.slot;
            const hasFriends = slot.classList.contains('has-friends');
            const isSelected = slot.classList.contains('selected');
            
            // Check if popup is already open for this slot
            const popup = document.getElementById('slotPopup');
            const isPopupOpen = popup.classList.contains('active');
            const isSameSlot = currentPopupSlot && 
                currentPopupSlot.date === date && 
                currentPopupSlot.timeSlot === timeSlot;
            
            // If clicking on same slot with popup open, close it
            if (isPopupOpen && isSameSlot) {
                closeSlotPopup();
                return;
            }
            
            // If popup is open and clicking different cell, just close popup (don't select)
            if (isPopupOpen && !isSameSlot) {
                closeSlotPopup();
                return;
            }
            
            // If cell has friends, show popup menu
            if (hasFriends) {
                showSlotPopup(e, slot, date, timeSlot, isSelected);
            } else {
                // No friends - just toggle availability directly
                toggleSlotAvailability(slot, date, timeSlot);
            }
        });
    });
    
    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('slotPopup');
        if (popup.classList.contains('active') && !popup.contains(e.target)) {
            closeSlotPopup();
        }
    });
}

// Toggle slot availability (add/remove)
function toggleSlotAvailability(slot, date, timeSlot) {
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
}

// Show slot popup menu
function showSlotPopup(e, slot, date, timeSlot, isSelected) {
    const popup = document.getElementById('slotPopup');
    const toggleText = document.getElementById('popupToggleText');
    const calendar = document.querySelector('.calendar');
    
    // Disable calendar scrolling while popup is open
    if (calendar) {
        calendar.style.overflowX = 'hidden';
    }
    
    // Store current slot info
    currentPopupSlot = { element: slot, date, timeSlot, isSelected };
    
    // Update toggle button text based on current state
    toggleText.textContent = isSelected ? 'Remove availability' : 'Add availability';
    
    // Position popup near the clicked cell
    const rect = slot.getBoundingClientRect();
    const popupWidth = 160;
    
    // Position to the right of the cell, or left if not enough space
    let left = rect.right + 8;
    if (left + popupWidth > window.innerWidth - 16) {
        left = rect.left - popupWidth - 8;
    }
    
    // Ensure popup stays within viewport
    left = Math.max(16, Math.min(left, window.innerWidth - popupWidth - 16));
    
    // Position vertically centered with the cell
    let top = rect.top + (rect.height / 2) - 40;
    top = Math.max(16, Math.min(top, window.innerHeight - 120));
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.classList.add('active');
}

// Close slot popup
function closeSlotPopup() {
    document.getElementById('slotPopup').classList.remove('active');
    currentPopupSlot = null;
    
    // Re-enable calendar scrolling
    const calendar = document.querySelector('.calendar');
    if (calendar) {
        calendar.style.overflowX = 'auto';
    }
}

// Toggle availability from popup
function toggleSlotFromPopup() {
    if (!currentPopupSlot) return;
    
    const { element, date, timeSlot } = currentPopupSlot;
    toggleSlotAvailability(element, date, timeSlot);
    closeSlotPopup();
}

// Open plan modal from popup
// Track current plan modal state
let currentPlanSlot = null;
let selectedPlanFriends = [];

function openPlanModal() {
    if (!currentPopupSlot) return;
    
    const { date, timeSlot } = currentPopupSlot;
    closeSlotPopup();
    
    // Store for sending invite
    currentPlanSlot = { date, timeSlot };
    selectedPlanFriends = [];
    
    // Find friends available at this slot
    const availableFriends = getAvailableFriendsForSlot(date, timeSlot);
    
    // Get the day info for display
    const dayInfo = weekDays.find(d => d.dateString === date);
    const dayName = dayInfo ? `${dayInfo.dayName}, ${dayInfo.month}/${dayInfo.dayDate}` : date;
    
    // Update modal content
    document.getElementById('planSlotInfo').innerHTML = `
        <div class="slot-day">${dayName}</div>
        <div class="slot-time">${timeSlot}</div>
    `;
    
    // Clear message field
    document.getElementById('planMessage').value = '';
    
    const friendsList = document.getElementById('planFriendsList');
    if (availableFriends.length > 0) {
        friendsList.innerHTML = availableFriends.map(friend => `
            <div class="plan-friend-item" data-user-id="${friend.userId}" onclick="togglePlanFriend(this, ${friend.userId})">
                <div class="friend-checkbox"></div>
                <div class="friend-avatar">${friend.initials}</div>
                <div class="friend-name">${friend.name}</div>
            </div>
        `).join('');
    } else {
        friendsList.innerHTML = '<div class="plan-friends-empty">No friends available at this time</div>';
    }
    
    updateSendInviteButton();
    document.getElementById('planModal').classList.add('active');
}

// Toggle friend selection in plan modal
function togglePlanFriend(element, userId) {
    element.classList.toggle('selected');
    
    if (element.classList.contains('selected')) {
        if (!selectedPlanFriends.includes(userId)) {
            selectedPlanFriends.push(userId);
        }
    } else {
        selectedPlanFriends = selectedPlanFriends.filter(id => id !== userId);
    }
    
    updateSendInviteButton();
}

// Update the send invite button state
function updateSendInviteButton() {
    const btn = document.getElementById('sendInviteBtn');
    if (selectedPlanFriends.length > 0) {
        btn.disabled = false;
        btn.textContent = `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
    } else {
        btn.disabled = true;
        btn.textContent = 'Select friends to invite';
    }
}

// Send hangout invite
async function sendHangoutInvite() {
    if (!currentPlanSlot || selectedPlanFriends.length === 0) return;
    
    const btn = document.getElementById('sendInviteBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    
    const message = document.getElementById('planMessage').value.trim();
    
    try {
        const response = await fetch('/api/hangouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: currentPlanSlot.date,
                time_slot: currentPlanSlot.timeSlot,
                description: message,
                invitee_ids: selectedPlanFriends
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showStatus('Hangout invite sent!', 'success');
            closePlanModal();
            // Refresh to show updated hangout status
            loadHangoutStatuses();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Error sending invite', 'error');
            btn.disabled = false;
            btn.textContent = `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
        }
    } catch (error) {
        console.error('Error sending hangout invite:', error);
        showStatus('Error sending invite', 'error');
        btn.disabled = false;
        btn.textContent = `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
    }
}

// Close plan modal
function closePlanModal() {
    document.getElementById('planModal').classList.remove('active');
    currentPlanSlot = null;
    selectedPlanFriends = [];
}

// Get friends available for a specific slot
function getAvailableFriendsForSlot(date, timeSlot) {
    const friends = [];
    
    // Get selected friend user IDs
    const selectedUserIds = selectedFriends
        .filter(f => f.linked_user_id)
        .map(f => f.linked_user_id);
    
    // Filter availability to only selected friends
    const filteredAvailability = friendsAvailability.filter(avail => 
        selectedUserIds.includes(avail.user_id)
    );
    
    filteredAvailability.forEach(avail => {
        const hasSlot = avail.time_slots.some(
            s => s.date === date && s.slot === timeSlot
        );
        if (hasSlot) {
            friends.push({
                userId: avail.user_id,
                name: avail.user_name,
                initials: getInitials(avail.user_name)
            });
        }
    });
    
    return friends;
}

// Check if user has made changes from the saved state
function hasAvailabilityChanges() {
    // Create sets for comparison (date_slot format)
    const currentSet = new Set(selectedTimeSlots.map(s => `${s.date}_${s.slot}`));
    const originalSet = new Set(originalTimeSlots.map(s => `${s.date}_${s.slot}`));
    
    // Check if sets are different
    if (currentSet.size !== originalSet.size) return true;
    for (const slot of currentSet) {
        if (!originalSet.has(slot)) return true;
    }
    return false;
}

// Update plan button state
function updatePlanButton() {
    const button = document.getElementById('planButton');
    // Button should only be active when user has made changes from saved state
    const hasChanges = hasAvailabilityChanges();
    
    if (hasChanges) {
        button.classList.remove('inactive');
        button.disabled = false;
    } else {
        button.classList.add('inactive');
        button.disabled = true;
    }
}

// Load my saved availability
async function loadMyAvailability() {
    try {
        const response = await fetch('/api/my-availability');
        if (response.ok) {
            const data = await response.json();
            
            // Update the page title with active status
            updateActiveStatus(data.is_active, data.days_remaining);
            
            if (data.availability && data.availability.time_slots) {
                // Populate selectedTimeSlots with saved data
                selectedTimeSlots = data.availability.time_slots;
                // Store original state to track changes
                originalTimeSlots = JSON.parse(JSON.stringify(data.availability.time_slots));
                
                // Update the calendar display
                selectedTimeSlots.forEach(slot => {
                    const slotElement = document.querySelector(
                        `.time-slot[data-date="${slot.date}"][data-slot="${slot.slot}"]`
                    );
                    if (slotElement) {
                        slotElement.classList.add('selected');
                    }
                });
                
                // Update button state (will be inactive since no changes yet)
                updatePlanButton();
                
                console.log('Loaded my availability:', selectedTimeSlots.length, 'slots');
            } else {
                // No saved availability - reset original state
                originalTimeSlots = [];
                updatePlanButton();
            }
        }
    } catch (error) {
        console.error('Error loading my availability:', error);
    }
}

// Update the page title based on active status
function updateActiveStatus(isActive, daysRemaining) {
    const statusEl = document.getElementById('activeStatus');
    if (!statusEl) return;
    
    if (isActive && daysRemaining > 0) {
        // Hide when active
        statusEl.style.display = 'none';
    } else {
        // Count friends who have actually shared availability (not just linked)
        const friendsWithAvailability = linkedFriends.filter(f => f.is_active_this_week).length;
        const friendText = friendsWithAvailability > 0 
            ? `<div class="friends-waiting">${friendsWithAvailability} ${friendsWithAvailability === 1 ? 'friend has' : 'friends have'} shared their availability!</div>`
            : '';
        
        statusEl.innerHTML = `
            <div class="inactive-prompt">
                ${friendText}
                <div class="inactive-cta">Add your availability to see when they're free</div>
            </div>
        `;
        statusEl.style.display = 'block';
    }
}

// Save my availability (new flow)
async function saveMyAvailability() {
    
    try {
        const response = await fetch('/api/my-availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                time_slots: selectedTimeSlots
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showStatus('Availability saved! Your friends can now see when you\'re free.', 'success');
            // Update original state to match current (no more "changes")
            originalTimeSlots = JSON.parse(JSON.stringify(selectedTimeSlots));
            updateActiveStatus(true, 7);  // Just saved = 7 days remaining
            loadFriendsAvailability();
            updatePlanButton();  // Will now be inactive since no changes
        } else {
            const data = await response.json();
            showStatus(data.error || 'Error saving availability', 'error');
        }
    } catch (error) {
        console.error('Error saving availability:', error);
        showStatus('Error saving availability', 'error');
    }
}

// Load friends' availability
let friendsAvailability = [];

async function loadFriendsAvailability() {
    try {
        const response = await fetch('/api/friends/availability');
        if (response.ok) {
            const data = await response.json();
            if (data.active) {
                friendsAvailability = data.availabilities;
                displayFriendsAvailability();
            }
        } else {
            friendsAvailability = [];
        }
    } catch (error) {
        console.error('Error loading friends availability:', error);
    }
}

// Display friends availability on calendar
function displayFriendsAvailability() {
    // Clear previous friend avatars
    document.querySelectorAll('.time-slot').forEach(slot => {
        const avatars = slot.querySelector('.slot-avatars');
        if (avatars) avatars.remove();
        slot.classList.remove('has-friends');
    });
    
    if (friendsAvailability.length === 0) return;
    
    // Get selected friend user IDs (linked_user_id from contacts)
    const selectedUserIds = selectedFriends
        .filter(f => f.linked_user_id)
        .map(f => f.linked_user_id);
    
    // Filter availability to only selected friends
    const filteredAvailability = friendsAvailability.filter(avail => 
        selectedUserIds.includes(avail.user_id)
    );
    
    if (filteredAvailability.length === 0) return;
    
    // Group friends by slot
    const slotFriends = {};
    filteredAvailability.forEach(avail => {
        avail.time_slots.forEach(slot => {
            const key = `${slot.date}-${slot.slot}`;
            if (!slotFriends[key]) slotFriends[key] = [];
            slotFriends[key].push({ 
                userId: avail.user_id,
                name: avail.user_name, 
                initials: getInitials(avail.user_name) 
            });
        });
    });
    
    // Add avatars to matching slots (same style as original)
    Object.keys(slotFriends).forEach(key => {
        const dateStr = key.substring(0, 10);
        const slot = key.substring(11);
        const slotElement = document.querySelector(`.time-slot[data-date="${dateStr}"][data-slot="${slot}"]`);
        if (slotElement) {
            const friends = slotFriends[key];
            
            // Create container for avatars
            const avatarsContainer = document.createElement('div');
            avatarsContainer.className = 'slot-avatars';
            
            // Add avatar for each friend (max 3 shown)
            friends.slice(0, 3).forEach(friend => {
                const avatar = document.createElement('div');
                avatar.className = 'slot-avatar';
                
                // Check if this friend has an RSVP status for this slot
                const hangoutStatus = getHangoutStatusForFriend(dateStr, slot, friend.userId);
                if (hangoutStatus === 'accepted') {
                    avatar.classList.add('rsvp-accepted');
                } else if (hangoutStatus === 'declined') {
                    avatar.classList.add('rsvp-declined');
                } else if (hangoutStatus === 'maybe') {
                    avatar.classList.add('rsvp-maybe');
                }
                
                avatar.textContent = friend.initials;
                avatar.title = friend.name + (hangoutStatus ? ` (${hangoutStatus})` : ' is free');
                avatarsContainer.appendChild(avatar);
            });
            
            // If more than 3, show count
            if (friends.length > 3) {
                const moreAvatar = document.createElement('div');
                moreAvatar.className = 'slot-avatar';
                moreAvatar.textContent = `+${friends.length - 3}`;
                moreAvatar.title = friends.slice(3).map(f => f.name).join(', ');
                avatarsContainer.appendChild(moreAvatar);
            }
            
            slotElement.appendChild(avatarsContainer);
            slotElement.classList.add('has-friends');
        }
    });
}

// Track hangout RSVP statuses for calendar display
let hangoutStatuses = {}; // key: "date-slot-userId", value: "pending" | "accepted" | "declined"

// Load hangout statuses for calendar display
async function loadHangoutStatuses() {
    try {
        const response = await fetch('/api/hangouts');
        if (response.ok) {
            const data = await response.json();
            hangoutStatuses = {};
            
            // Process hangouts created by user (to see invitee responses)
            data.created.forEach(hangout => {
                hangout.invitees.forEach(invitee => {
                    const key = `${hangout.date}-${hangout.time_slot}-${invitee.user_id}`;
                    hangoutStatuses[key] = invitee.status;
                });
            });
            
            // Process hangouts user is invited to (to see creator's status based on own response)
            data.invited.forEach(hangout => {
                // Find my invite status
                const myInvite = hangout.invitees.find(inv => inv.user_id === plannerInfo?.id);
                if (myInvite && myInvite.status === 'accepted') {
                    // Mark the creator's bubble as green on my calendar
                    const key = `${hangout.date}-${hangout.time_slot}-${hangout.creator_id}`;
                    hangoutStatuses[key] = 'accepted';
                }
            });
            
            // Refresh the calendar display
            displayFriendsAvailability();
        }
    } catch (error) {
        console.error('Error loading hangout statuses:', error);
    }
}

// Get hangout RSVP status for a specific friend/slot
function getHangoutStatusForFriend(date, timeSlot, userId) {
    const key = `${date}-${timeSlot}-${userId}`;
    return hangoutStatuses[key] || null;
}

// Load linked friends (users who have accepted friend requests)
let linkedFriends = [];
async function loadLinkedFriends() {
    try {
        const response = await fetch('/api/friends');
        if (response.ok) linkedFriends = await response.json();
    } catch (error) {
        console.error('Error loading linked friends:', error);
    }
}

// Legacy handle plan action
async function handlePlanAction() {
    await saveMyAvailability();
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
    const todayStr = getTodayString();
    const endDateStr = addDaysToDateString(todayStr, 6);
    
    return {
        start: todayStr,
        end: endDateStr
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

// Check if running on iOS Safari (not in standalone mode)
function isIOSSafari() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isStandalone = window.navigator.standalone === true;
    const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua);
    return isIOS && !isStandalone && isSafari;
}

// Show install popup for first-time iOS users
function showInstallPopup() {
    console.log('showInstallPopup called');
    console.log('plannerInfo:', plannerInfo);
    console.log('has_seen_install_prompt:', plannerInfo?.has_seen_install_prompt);
    
    // TODO: Re-enable iOS check after testing
    // if (!isIOSSafari()) return;
    
    // Check database flag - only show if user hasn't seen it
    if (plannerInfo && plannerInfo.has_seen_install_prompt) {
        console.log('User already saw prompt, skipping');
        return;
    }
    
    console.log('Showing install popup!');
    document.getElementById('installPopupOverlay').classList.add('active');
    document.getElementById('installPopup').classList.add('active');
}

// Close install popup and mark as seen in database
async function closeInstallPopup() {
    document.getElementById('installPopupOverlay').classList.remove('active');
    document.getElementById('installPopup').classList.remove('active');
    
    // Mark as seen in database
    if (plannerInfo && plannerInfo.id) {
        try {
            await fetch(`/api/users/${plannerInfo.id}/install-prompt-seen`, { method: 'POST' });
            plannerInfo.has_seen_install_prompt = true;
            localStorage.setItem('gatherly_planner', JSON.stringify(plannerInfo));
        } catch (error) {
            console.error('Error marking install prompt as seen:', error);
        }
    }
}

// Notifications functions
async function loadNotifications() {
    if (!plannerInfo || !plannerInfo.id) {
        return;
    }
    
    try {
        // Load both notifications and friend requests
        const [notifResponse, friendReqResponse] = await Promise.all([
            fetch(`/api/notifications/${plannerInfo.id}`),
            fetch('/api/friend-requests')
        ]);
        
        const notifications = await notifResponse.json();
        const friendRequests = friendReqResponse.ok ? await friendReqResponse.json() : [];
        
        // Check if we have new notifications (more than before)
        const currentCount = notifications.length + friendRequests.length;
        if (lastNotificationCount !== null && currentCount > lastNotificationCount) {
            console.log('New notification detected, refreshing data');
            // Refresh linked friends (for active status), then friends list
            await loadLinkedFriends();
            await loadFriends();
            // Refresh the calendar when new notifications arrive
            loadFriendsAvailability();
            // Refresh hangout statuses (updates bubble colors for RSVPs)
            loadHangoutStatuses();
        }
        lastNotificationCount = currentCount;
        
        // Update badge count (unread notifications + pending friend requests)
        const unreadCount = notifications.filter(n => !n.read).length + friendRequests.length;
        const badge = document.getElementById('notificationBadge');
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
        
        // Only re-render if data has changed (prevents icon blinking)
        const currentData = JSON.stringify({ notifications, friendRequests });
        if (currentData !== lastNotificationData) {
            lastNotificationData = currentData;
            renderNotifications(notifications, friendRequests);
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function renderNotifications(notifications, friendRequests = []) {
    const list = document.getElementById('notificationsList');
    
    if (!list) {
        console.error('notificationsList element not found!');
        return;
    }
    
    if (notifications.length === 0 && friendRequests.length === 0) {
        list.innerHTML = '<div class="no-notifications">No notifications yet</div>';
        return;
    }
    
    try {
        // Render friend requests first (with accept/deny buttons)
        const friendRequestsHtml = friendRequests.map(req => {
            const timeAgo = getTimeAgo(new Date(req.created_at));
            return `
                <div class="notification-item unread friend-request" data-request-id="${req.id}">
                    <div class="notification-avatar icon-avatar">
                        <img src="/static/icons/friend-request.png" alt="Friend request">
                    </div>
                    <div class="notification-content">
                        <div class="notification-header">
                            <div class="notification-text">
                                <strong>${req.from_user_name}</strong> wants to be friends
                            </div>
                            <div class="notification-time">${timeAgo}</div>
                        </div>
                        <div class="friend-request-actions">
                            <button class="btn-accept" onclick="acceptFriendRequest(${req.id})">Accept</button>
                            <button class="btn-reject" onclick="rejectFriendRequest(${req.id})">Decline</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Render regular notifications
        const notificationsHtml = notifications.map(notif => {
            const timeAgo = getTimeAgo(new Date(notif.created_at));
            
            // Hangout invite notification - show accept/decline buttons for invitees
            if (notif.notification_type === 'hangout_invite' && notif.hangout_id && notif.from_user_id !== plannerInfo?.id) {
                // Check if user already responded
                const hangout = notif.hangout;
                const myInvite = hangout?.invitees?.find(inv => inv.user_id === plannerInfo?.id);
                const hasResponded = myInvite && myInvite.status !== 'pending';
                
                // Get list of other invitees (excluding self)
                const otherInvitees = hangout?.invitees?.filter(inv => inv.user_id !== plannerInfo?.id) || [];
                const inviteeNames = otherInvitees.map(inv => inv.user_name);
                const inviteeList = inviteeNames.length > 0 
                    ? `Also invited: ${inviteeNames.join(', ')}` 
                    : '';
                
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'} hangout-invite" data-hangout-id="${notif.hangout_id}">
                        <div class="notification-avatar icon-avatar">
                            <img src="/static/icons/event-invite.png" alt="Event invite">
                        </div>
                        <div class="notification-content">
                            <div class="notification-header">
                                <div class="notification-text">${formatNotificationMessage(notif.message, notif.from_user_name)}</div>
                                <div class="notification-time">${timeAgo}</div>
                            </div>
                            ${inviteeList ? `<div class="notification-invitees">${inviteeList}</div>` : ''}
                            ${hangout?.description ? `<div class="notification-description">"${hangout.description}"</div>` : ''}
                            ${hasResponded ? `
                                <div class="hangout-response-status ${myInvite.status}">
                                    You ${myInvite.status === 'maybe' ? 'said maybe to' : myInvite.status} this invite
                                </div>
                            ` : `
                                <div class="friend-request-actions hangout-actions">
                                    <button class="btn-accept" onclick="respondToHangout(${notif.hangout_id}, 'accepted')">Accept</button>
                                    <button class="btn-maybe" onclick="respondToHangout(${notif.hangout_id}, 'maybe')">Maybe</button>
                                    <button class="btn-reject" onclick="respondToHangout(${notif.hangout_id}, 'declined')">Decline</button>
                                </div>
                            `}
                        </div>
                    </div>
                `;
            }
            
            // Hangout response notification (for creator)
            if (notif.notification_type === 'hangout_response') {
                const isAccepted = notif.message.includes('accepted');
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'} hangout-response">
                        <div class="notification-avatar icon-avatar ${isAccepted ? 'accepted' : 'declined'}">
                            <img src="/static/icons/event-invite.png" alt="Event response">
                        </div>
                        <div class="notification-content">
                            <div class="notification-header">
                                <div class="notification-text">${formatNotificationMessage(notif.message, notif.from_user_name)}</div>
                                <div class="notification-time">${timeAgo}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            // System notifications (no contact) vs contact notifications
            if (!notif.contact_name) {
                // Determine icon based on message content
                let iconSrc = '/static/icons/availability.png'; // default
                if (notif.message.toLowerCase().includes('nudge') || notif.message.includes('wants to see your availability') || notif.message.includes('wants to know when')) {
                    iconSrc = '/static/icons/nudge.png';
                } else if (notif.message.toLowerCase().includes('availability') || notif.message.includes('updated their schedule')) {
                    iconSrc = '/static/icons/availability.png';
                } else if (notif.message.toLowerCase().includes('accepted') && notif.message.toLowerCase().includes('friend')) {
                    iconSrc = '/static/icons/friend-request.png';
                } else if (notif.message.toLowerCase().includes('invite') || notif.message.toLowerCase().includes('joined')) {
                    iconSrc = '/static/icons/invite.png';
                }
                
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'}">
                        <div class="notification-avatar icon-avatar">
                            <img src="${iconSrc}" alt="Notification">
                        </div>
                        <div class="notification-content">
                            <div class="notification-header">
                                <div class="notification-text">${formatNotificationMessage(notif.message, notif.from_user_name)}</div>
                                <div class="notification-time">${timeAgo}</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Contact notification - show contact initials and name
                return `
                    <div class="notification-item ${notif.read ? '' : 'unread'}">
                        <div class="notification-avatar">${getInitials(notif.contact_name)}</div>
                        <div class="notification-content">
                            <div class="notification-header">
                                <div class="notification-text">
                                    <strong>${notif.contact_name}</strong> ${notif.message}
                                </div>
                                <div class="notification-time">${timeAgo}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }).join('');
        
        list.innerHTML = friendRequestsHtml + notificationsHtml;
    } catch (error) {
        console.error('Error rendering notifications:', error);
    }
}

// Respond to a hangout invite
async function respondToHangout(hangoutId, response) {
    try {
        const res = await fetch(`/api/hangouts/${hangoutId}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response })
        });
        
        if (res.ok) {
            const data = await res.json();
            showStatus(data.message, 'success');
            loadNotifications(); // Refresh notifications
            loadHangoutStatuses(); // Refresh calendar display
        } else {
            const data = await res.json();
            showStatus(data.error || 'Error responding to invite', 'error');
        }
    } catch (error) {
        console.error('Error responding to hangout:', error);
        showStatus('Error responding to invite', 'error');
    }
}

// Accept friend request
async function acceptFriendRequest(requestId) {
    try {
        const response = await fetch(`/api/friend-requests/${requestId}/accept`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showStatus('Friend request accepted!', 'success');
            loadNotifications();
            await loadFriends();  // Reload contacts (includes new reciprocal contact)
            loadLinkedFriends();  // Reload linked friends
            loadFriendsAvailability();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to accept request', 'error');
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
        showStatus('Error accepting request', 'error');
    }
}

// Reject friend request
async function rejectFriendRequest(requestId) {
    try {
        const response = await fetch(`/api/friend-requests/${requestId}/reject`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showStatus('Friend request declined', 'success');
            loadNotifications();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to decline request', 'error');
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
        showStatus('Error declining request', 'error');
    }
}

function getTimeAgo(date) {
    const now = new Date();
    const notifDate = new Date(date);
    const seconds = Math.floor((now - notifDate) / 1000);
    
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

// =====================
// Plans Functions
// =====================

let allPlans = { created: [], invited: [] };
let currentPlanDetail = null;

async function openPlans() {
    document.getElementById('plansModal').classList.add('active');
    await loadPlans();
}

function closePlans() {
    document.getElementById('plansModal').classList.remove('active');
}

async function loadPlans() {
    try {
        const response = await fetch('/api/hangouts');
        if (response.ok) {
            allPlans = await response.json();
            renderPlans();
        }
    } catch (error) {
        console.error('Error loading plans:', error);
    }
}

function renderPlans() {
    const plansList = document.getElementById('plansList');
    const allPlansList = [];
    
    // Combine created and invited plans
    allPlans.created.forEach(plan => {
        allPlansList.push({ ...plan, role: 'host' });
    });
    allPlans.invited.forEach(plan => {
        // Don't duplicate if you're both creator and invitee
        if (!allPlansList.find(p => p.id === plan.id)) {
            allPlansList.push({ ...plan, role: 'guest' });
        }
    });
    
    // Sort by date (most recent first)
    allPlansList.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (allPlansList.length === 0) {
        plansList.innerHTML = `
            <div class="plans-empty">
                <div class="plans-empty-icon">📅</div>
                <div class="plans-empty-text">No plans yet</div>
                <div class="plans-empty-hint">Tap a time slot with friends available to create a plan</div>
            </div>
        `;
        return;
    }
    
    plansList.innerHTML = allPlansList.map(plan => {
        const dateObj = new Date(plan.date + 'T12:00:00');
        const dateStr = dateObj.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
        
        const guestChips = plan.invitees.map(inv => {
            const statusClass = inv.status || 'pending';
            return `<span class="plan-guest-chip ${statusClass}">${inv.user_name}</span>`;
        }).join('');
        
        return `
            <div class="plan-card" onclick="openPlanDetail(${plan.id})">
                <div class="plan-card-role">${plan.role === 'host' ? '👑 You\'re hosting' : '📬 Invited'}</div>
                <div class="plan-card-header">
                    <div class="plan-card-date">${dateStr}</div>
                    <div class="plan-card-time">${plan.time_slot}</div>
                </div>
                ${plan.description ? `<div class="plan-card-description">${plan.description}</div>` : ''}
                <div class="plan-card-guests">${guestChips}</div>
            </div>
        `;
    }).join('');
}

function openPlanDetail(planId) {
    // Find the plan in our loaded data
    let plan = allPlans.created.find(p => p.id === planId);
    let role = 'host';
    if (!plan) {
        plan = allPlans.invited.find(p => p.id === planId);
        role = 'guest';
    }
    
    if (!plan) {
        showStatus('Plan not found', 'error');
        return;
    }
    
    currentPlanDetail = { ...plan, role };
    renderPlanDetail();
    document.getElementById('planDetailModal').classList.add('active');
}

function renderPlanDetail() {
    if (!currentPlanDetail) return;
    
    const plan = currentPlanDetail;
    const content = document.getElementById('planDetailContent');
    
    const dateObj = new Date(plan.date + 'T12:00:00');
    const dateStr = dateObj.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
    });
    
    const guestsHtml = plan.invitees.map(inv => {
        const statusClass = inv.status || 'pending';
        const statusText = inv.status === 'accepted' ? 'Going' : 
                          inv.status === 'declined' ? 'Can\'t go' : 
                          inv.status === 'maybe' ? 'Maybe' : 'Pending';
        return `
            <div class="plan-detail-guest">
                <div class="plan-detail-guest-name">${inv.user_name}</div>
                <div class="plan-detail-guest-status ${statusClass}">${statusText}</div>
            </div>
        `;
    }).join('');
    
    // Check if user can respond (they're a guest and haven't responded or want to change)
    const myInvite = plan.invitees.find(inv => inv.user_id === plannerInfo.id);
    const canRespond = plan.role === 'guest' && myInvite;
    
    let responseButtons = '';
    if (canRespond) {
        responseButtons = `
            <div class="plan-detail-section">
                <div class="plan-detail-section-title">Your Response</div>
                <div class="friend-request-actions hangout-actions">
                    <button class="btn-accept ${myInvite.status === 'accepted' ? 'active' : ''}" onclick="respondToPlanDetail('accepted')">Going</button>
                    <button class="btn-maybe ${myInvite.status === 'maybe' ? 'active' : ''}" onclick="respondToPlanDetail('maybe')">Maybe</button>
                    <button class="btn-reject ${myInvite.status === 'declined' ? 'active' : ''}" onclick="respondToPlanDetail('declined')">Can't go</button>
                </div>
            </div>
        `;
    }
    
    let cancelButton = '';
    if (plan.role === 'host') {
        cancelButton = `
            <div class="plan-detail-actions">
                <button class="btn-danger" onclick="cancelPlan(${plan.id})">Cancel Plan</button>
            </div>
        `;
    }
    
    content.innerHTML = `
        <div class="plan-detail-header">
            <div class="plan-detail-date">${dateStr}</div>
            <div class="plan-detail-time">${plan.time_slot}</div>
        </div>
        
        ${plan.description ? `
            <div class="plan-detail-section">
                <div class="plan-detail-section-title">Description</div>
                <div class="plan-detail-description">${plan.description}</div>
            </div>
        ` : ''}
        
        <div class="plan-detail-section">
            <div class="plan-detail-section-title">Guests</div>
            <div class="plan-detail-guests">${guestsHtml}</div>
        </div>
        
        ${responseButtons}
        
        <div class="plan-detail-creator">
            Created by ${plan.creator_name}
        </div>
        
        ${cancelButton}
    `;
}

async function respondToPlanDetail(response) {
    if (!currentPlanDetail) return;
    
    try {
        const res = await fetch(`/api/hangouts/${currentPlanDetail.id}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response })
        });
        
        if (res.ok) {
            showStatus('Response updated!', 'success');
            // Update local data
            const myInvite = currentPlanDetail.invitees.find(inv => inv.user_id === plannerInfo.id);
            if (myInvite) myInvite.status = response;
            renderPlanDetail();
            // Reload plans list
            await loadPlans();
            // Reload calendar to show updated statuses
            loadHangoutStatuses();
        } else {
            const data = await res.json();
            showStatus(data.error || 'Failed to update response', 'error');
        }
    } catch (error) {
        console.error('Error responding to plan:', error);
        showStatus('Failed to update response', 'error');
    }
}

async function cancelPlan(planId) {
    if (!confirm('Are you sure you want to cancel this plan? All guests will be notified.')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/hangouts/${planId}`, {
            method: 'DELETE'
        });
        
        if (res.ok) {
            showStatus('Plan cancelled', 'success');
            closePlanDetail();
            await loadPlans();
            loadHangoutStatuses();
        } else {
            const data = await res.json();
            showStatus(data.error || 'Failed to cancel plan', 'error');
        }
    } catch (error) {
        console.error('Error cancelling plan:', error);
        showStatus('Failed to cancel plan', 'error');
    }
}

function closePlanDetail() {
    document.getElementById('planDetailModal').classList.remove('active');
    currentPlanDetail = null;
}

function backToPlans() {
    closePlanDetail();
}

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
            <div class="account-info-value">${formatPhoneDisplay(plannerInfo.phone)}</div>
        </div>
    `;
    
    // Load timezone and notification preferences
    await loadTimezone();
    await loadNotificationFriends();
    loadWeeklyReminders();
    updatePushNotificationStatus();
    
    document.getElementById('settingsModal').classList.add('active');
}

function updatePushNotificationStatus() {
    const statusEl = document.getElementById('pushStatus');
    const enableBtn = document.getElementById('enablePushBtn');
    const testBtn = document.getElementById('testPushBtn');
    const section = document.getElementById('pushNotificationSection');
    
    // Hide section if push not supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    if (Notification.permission === 'denied') {
        statusEl.innerHTML = '<p class="settings-hint" style="color: #ef4444;">⚠️ Notifications are blocked. Please enable them in your browser settings.</p>';
        enableBtn.style.display = 'none';
        testBtn.style.display = 'none';
    } else if (Notification.permission === 'granted' && pushSubscription) {
        statusEl.innerHTML = '<p class="settings-hint" style="color: #22c55e;">✓ Push notifications are enabled</p>';
        enableBtn.style.display = 'none';
        testBtn.style.display = 'inline-block';
    } else {
        statusEl.innerHTML = '<p class="settings-hint">Push notifications are not enabled</p>';
        enableBtn.style.display = 'inline-block';
        testBtn.style.display = 'none';
    }
}

async function enablePushFromSettings() {
    const success = await requestPushPermission();
    if (success) {
        showStatus('Push notifications enabled! 🔔', 'success');
    }
    updatePushNotificationStatus();
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
            plannerInfo = { id: updatedUser.id, name: updatedUser.name, phone: updatedUser.phone_number, email: updatedUser.email, weekly_reminders_enabled: updatedUser.weekly_reminders_enabled !== false, has_seen_install_prompt: updatedUser.has_seen_install_prompt === true };
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

// Notification friends functions
let selectedNotificationFriends = [];

async function loadNotificationFriends() {
    const container = document.getElementById('notificationFriendsList');
    const noFriendsHint = document.getElementById('noLinkedFriendsHint');
    
    if (!container) return;
    
    // Get linked friends (friends with accepted friendship)
    const linkedFriends = allFriends.filter(f => f.is_linked);
    
    if (linkedFriends.length === 0) {
        container.innerHTML = '';
        noFriendsHint.style.display = 'block';
        return;
    }
    
    noFriendsHint.style.display = 'none';
    
    // Load saved notification preferences
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}/notification-friends`);
        const data = await response.json();
        selectedNotificationFriends = data.friend_ids || [];
    } catch (error) {
        console.error('Error loading notification preferences:', error);
        selectedNotificationFriends = [];
    }
    
    // Render friend bubbles
    container.innerHTML = linkedFriends.map(friend => {
        const initials = getInitials(friend.name);
        const isSelected = selectedNotificationFriends.includes(friend.linked_user_id);
        return `
            <div class="notification-friend-bubble ${isSelected ? 'selected' : ''}" 
                 data-friend-id="${friend.linked_user_id}"
                 title="${friend.name}"
                 onclick="toggleNotificationFriend(${friend.linked_user_id})">
                ${initials}
            </div>
        `;
    }).join('');
}

function toggleNotificationFriend(friendId) {
    const bubble = document.querySelector(`.notification-friend-bubble[data-friend-id="${friendId}"]`);
    
    if (selectedNotificationFriends.includes(friendId)) {
        // Remove from list
        selectedNotificationFriends = selectedNotificationFriends.filter(id => id !== friendId);
        bubble.classList.remove('selected');
    } else {
        // Add to list
        selectedNotificationFriends.push(friendId);
        bubble.classList.add('selected');
    }
}

async function saveNotificationPreferences() {
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}/notification-friends`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friend_ids: selectedNotificationFriends })
        });
        
        if (response.ok) {
            showStatus('Notification preferences saved!', 'success');
            closeSettings();
        } else {
            showStatus('Error saving preferences', 'error');
        }
    } catch (error) {
        console.error('Error saving notification preferences:', error);
        showStatus('Error saving preferences', 'error');
    }
}

// Weekly reminders functions
function loadWeeklyReminders() {
    const toggle = document.getElementById('weeklyRemindersToggle');
    if (toggle && plannerInfo) {
        // Default to true if not set
        toggle.checked = plannerInfo.weekly_reminders_enabled !== false;
    }
}

async function saveWeeklyReminders() {
    const toggle = document.getElementById('weeklyRemindersToggle');
    const enabled = toggle.checked;
    
    try {
        const response = await fetch(`/api/users/${plannerInfo.id}/weekly-reminders`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: enabled })
        });
        
        if (response.ok) {
            // Update local plannerInfo
            plannerInfo.weekly_reminders_enabled = enabled;
            showStatus(enabled ? 'Weekly reminders enabled!' : 'Weekly reminders disabled', 'success');
        } else {
            showStatus('Error updating preferences', 'error');
            // Revert toggle
            toggle.checked = !enabled;
        }
    } catch (error) {
        console.error('Error saving weekly reminders:', error);
        showStatus('Error updating preferences', 'error');
        toggle.checked = !enabled;
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
            
            // Redirect to login page
            window.location.href = '/login';
        } else {
            showStatus('Error deleting account', 'error');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showStatus('Error deleting account', 'error');
    }
}
