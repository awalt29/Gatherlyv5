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
// Modal Navigation Helper
// =====================

// Close all nav-related modals (called before opening a new one)
function closeAllNavModals() {
    document.getElementById('plansModal')?.classList.remove('active');
    document.getElementById('manageFriendsModal')?.classList.remove('active');
    document.getElementById('settingsModal')?.classList.remove('active');
    document.getElementById('notificationsModal')?.classList.remove('active');
    document.getElementById('aiChatModal')?.classList.remove('active');
    document.getElementById('planDetailModal')?.classList.remove('active');
}

// Go back to home/calendar screen
function goHome() {
    closeAllNavModals();
}

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
        navigator.serviceWorker.addEventListener('message', async (event) => {
            console.log('[SW Message]', event.data);
            if (event.data.type === 'OPEN_NOTIFICATIONS') {
                openNotifications();
            } else if (event.data.type === 'OPEN_PLAN') {
                // Load plans and open the specific plan detail
                await loadPlans();
                setTimeout(() => {
                    openPlanDetail(event.data.planId);
                }, 300);
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

// Check if we should show push prompt to existing users
function showPushPromptIfNeeded() {
    console.log('[PUSH PROMPT] showPushPromptIfNeeded called');
    console.log('[PUSH PROMPT] pushSubscription:', pushSubscription);
    console.log('[PUSH PROMPT] Notification.permission:', Notification.permission);
    
    // Don't show if push not supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('[PUSH PROMPT] Push not supported, skipping');
        return;
    }
    
    // Already subscribed - nothing to do
    if (pushSubscription) {
        console.log('[PUSH PROMPT] Already subscribed, skipping');
        return;
    }
    
    // If permission denied, nothing we can do
    if (Notification.permission === 'denied') {
        console.log('[PUSH PROMPT] Permission denied, skipping');
        return;
    }
    
    // If permission already granted but not subscribed, auto-subscribe
    if (Notification.permission === 'granted') {
        console.log('[PUSH PROMPT] Permission already granted, auto-subscribing...');
        enablePushNotifications();
        return;
    }
    
    // Permission is 'default' - show our custom prompt
    // Check if user has dismissed recently (don't show again for 7 days)
    const lastDismissed = localStorage.getItem('push_prompt_dismissed');
    if (lastDismissed) {
        const daysSinceDismissed = (Date.now() - parseInt(lastDismissed)) / (1000 * 60 * 60 * 24);
        if (daysSinceDismissed < 7) {
            console.log('[PUSH PROMPT] Dismissed recently, skipping');
            return;
        }
    }
    
    console.log('[PUSH PROMPT] Showing prompt...');
    // Show the prompt
    showPushPermissionPrompt();
}

// Show custom prompt before browser permission request
function showPushPermissionPrompt() {
    console.log('[PUSH PROMPT] Checking if should show...');
    console.log('[PUSH PROMPT] pushSubscription:', pushSubscription);
    console.log('[PUSH PROMPT] Notification.permission:', typeof Notification !== 'undefined' ? Notification.permission : 'Notification not available');
    console.log('[PUSH PROMPT] serviceWorker supported:', 'serviceWorker' in navigator);
    console.log('[PUSH PROMPT] PushManager supported:', 'PushManager' in window);
    
    // Don't show if already subscribed or denied
    if (pushSubscription) {
        console.log('[PUSH PROMPT] Skipping - already subscribed');
        return;
    }
    
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        console.log('[PUSH PROMPT] Skipping - permission denied');
        return;
    }
    
    // Don't show if push not supported (but allow on iOS for education)
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('[PUSH PROMPT] Push not supported on this browser');
        // Still skip - can't enable anyway
        return;
    }
    
    console.log('[PUSH PROMPT] Showing prompt!');
    
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

function closePushPrompt(dismissed = true) {
    const overlay = document.getElementById('pushPromptOverlay');
    const prompt = document.querySelector('.push-prompt');
    if (overlay) overlay.remove();
    if (prompt) prompt.remove();
    
    // Record dismissal time so we don't show again for 7 days
    if (dismissed) {
        localStorage.setItem('push_prompt_dismissed', Date.now().toString());
    }
}

async function enablePushFromPrompt() {
    closePushPrompt(false); // Don't record as dismissed since they're enabling
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
            
            // Load plans for unread message badge
            loadPlans();
            
            // Check for new notifications every 10 seconds (which will auto-refresh calendar)
            setInterval(loadNotifications, 10000);
            
            // Check for new plan messages every 15 seconds
            startPlansBadgePolling();
            
            // Initialize push notifications
            initPushNotifications();
            
            // Show push notification prompt for existing users who haven't enabled yet
            setTimeout(() => showPushPromptIfNeeded(), 2000);
            
            // Show "Add to Home Screen" prompt for iOS users (also applies to existing users on login)
            setTimeout(() => showInstallPopup(), 1500);
            
            // Check for ?openPlan= URL parameter (from push notifications)
            checkOpenPlanParam();
            
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
    
    function updateCalendarScrollFades() {
        const scrollLeft = calendar.scrollLeft;
        const scrollWidth = calendar.scrollWidth;
        const clientWidth = calendar.clientWidth;
        
        // Check if can scroll left (not at start)
        const canScrollLeft = scrollLeft > 5;
        // Check if can scroll right (not at end)
        const canScrollRight = scrollLeft + clientWidth < scrollWidth - 5;
        
        calendarSection.classList.toggle('can-scroll-left', canScrollLeft);
        calendarSection.classList.toggle('can-scroll-right', canScrollRight);
        calendarSection.classList.toggle('scrolled-end', !canScrollRight);
    }
    
    calendar.addEventListener('scroll', updateCalendarScrollFades);
    
    // Initial check
    setTimeout(updateCalendarScrollFades, 100);
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
            
            // Show "Add to Home Screen" prompt for iOS users first
            setTimeout(() => showInstallPopup(), 1500);
            
            // Show push notification prompt for new users (after install popup)
            // Delay longer to not conflict with install popup
            setTimeout(() => {
                // Only show if install popup is not visible
                const installPopup = document.getElementById('installPopup');
                if (!installPopup || !installPopup.classList.contains('active')) {
                    showPushPermissionPrompt();
                } else {
                    // Wait for install popup to close, then show push prompt
                    setTimeout(() => showPushPermissionPrompt(), 3000);
                }
            }, 5000);
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
    e.currentTarget.classList.add('dragging');
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
    e.currentTarget.classList.remove('dragging');
    
    // Remove all border highlights and drag-over classes
    const manageList = document.getElementById('friendsManageList');
    manageList.querySelectorAll('.friend-manage-item').forEach(item => {
        item.style.borderTop = '';
        item.classList.remove('drag-over');
    });
}

// Touch event handlers for mobile drag-and-drop
let touchedItem = null;
let touchStartY = 0;
let touchOffsetY = 0;
let itemHeight = 0;
let placeholder = null;

function handleManageTouchStart(e) {
    // Get the parent item from the drag handle
    touchedItem = e.currentTarget.closest('.friend-manage-item');
    if (!touchedItem) return;
    
    e.preventDefault(); // Prevent text selection and copy menu
    
    const rect = touchedItem.getBoundingClientRect();
    touchStartY = e.touches[0].clientY;
    touchOffsetY = touchStartY - rect.top;
    itemHeight = rect.height;
    
    // Create a placeholder to hold the space
    placeholder = document.createElement('div');
    placeholder.className = 'friend-manage-placeholder';
    placeholder.style.height = itemHeight + 'px';
    placeholder.style.marginBottom = '10px';
    
    // Make the dragged item fixed position
    touchedItem.style.position = 'fixed';
    touchedItem.style.left = rect.left + 'px';
    touchedItem.style.top = rect.top + 'px';
    touchedItem.style.width = rect.width + 'px';
    touchedItem.style.zIndex = '1000';
    touchedItem.style.transition = 'none'; // Disable transition while dragging
    touchedItem.classList.add('dragging');
    
    // Insert placeholder where the item was
    touchedItem.parentNode.insertBefore(placeholder, touchedItem);
    
    console.log('Touch started');
}

function handleManageTouchMove(e) {
    if (!touchedItem || !placeholder) return;
    
    e.preventDefault(); // Prevent scrolling while dragging
    const touchY = e.touches[0].clientY;
    
    // Move the item with the finger
    const itemTop = touchY - touchOffsetY;
    touchedItem.style.top = itemTop + 'px';
    
    const manageList = document.getElementById('friendsManageList');
    const allItems = Array.from(manageList.querySelectorAll('.friend-manage-item:not(.dragging)'));
    
    if (allItems.length === 0) return;
    
    // Go through items top to bottom
    // Insert placeholder BEFORE the first item whose center is BELOW the finger
    for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const rect = item.getBoundingClientRect();
        const itemCenter = rect.top + rect.height / 2;
        
        if (touchY < itemCenter) {
            // Finger is above this item's center - insert placeholder before it
            if (placeholder.nextElementSibling !== item) {
                manageList.insertBefore(placeholder, item);
            }
            return;
        }
    }
    
    // Finger is below all items - put placeholder at the end
    if (placeholder.nextElementSibling !== null) {
        manageList.appendChild(placeholder);
    }
}

function handleManageTouchEnd(e) {
    if (!touchedItem) return;
    
    console.log('Touch ended');
    
    // Reset the item's style
    touchedItem.style.position = '';
    touchedItem.style.left = '';
    touchedItem.style.top = '';
    touchedItem.style.width = '';
    touchedItem.style.zIndex = '';
    touchedItem.style.transition = '';
    touchedItem.classList.remove('dragging');
    
    // Replace placeholder with the actual item
    if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(touchedItem, placeholder);
        placeholder.remove();
    }
    placeholder = null;
    
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
    closeAllNavModals();
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
        
        // Prevent context menu on long press (only on drag handle)
        dragHandle.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Add drag handlers for desktop
        dragHandle.addEventListener('mousedown', () => { item.draggable = true; });
        item.addEventListener('dragstart', handleManageDragStart);
        item.addEventListener('dragover', handleManageDragOver);
        item.addEventListener('drop', handleManageDrop);
        item.addEventListener('dragend', (e) => {
            handleManageDragEnd(e);
            item.draggable = false;
        });
        
        // Add touch handlers for mobile - only on drag handle
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
    
    // Auto-save with debounce
    scheduleAutoSave();
}

// Auto-save functionality
let autoSaveTimeout = null;
let isSaving = false;

function scheduleAutoSave() {
    // Clear any pending save
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    // Schedule save after 1 second of no changes
    autoSaveTimeout = setTimeout(() => {
        autoSaveAvailability();
    }, 1000);
}

async function autoSaveAvailability() {
    if (isSaving) return;
    
    // Check if there are actual changes from the last saved state
    if (!hasAvailabilityChanges()) return;
    
    isSaving = true;
    
    try {
        const response = await fetch('/api/my-availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                time_slots: selectedTimeSlots
            })
        });
        
        if (response.ok) {
            // Update original state to match current (no more "changes")
            originalTimeSlots = JSON.parse(JSON.stringify(selectedTimeSlots));
            updateActiveStatus(true, 7);  // Just saved = 7 days remaining
            loadFriendsAvailability();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Error saving', 'error');
        }
    } catch (error) {
        console.error('Error auto-saving availability:', error);
        showStatus('Error saving', 'error');
    } finally {
        isSaving = false;
    }
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
let isNewPlanMode = false;
let selectedPlanTime = null;

// Open plan modal from plans page (new plan mode)
function openNewPlanModal() {
    console.log('[NEW PLAN] Opening new plan modal');
    
    // Close the plans modal first
    closePlans();
    
    isNewPlanMode = true;
    currentPlanSlot = null;
    selectedPlanFriends = [];
    selectedPlanTime = null;
    
    // Show datetime section, hide slot info
    document.getElementById('planSlotInfo').style.display = 'none';
    document.getElementById('planDatetimeSection').style.display = 'block';
    document.getElementById('planFriendsHeader').textContent = 'Who do you want to invite?';
    document.getElementById('planModalTitle').textContent = 'Create a Plan';
    
    // Set default date to today
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    document.getElementById('planDateInput').value = dateStr;
    document.getElementById('planDateInput').min = dateStr;
    
    // Clear time selection
    document.querySelectorAll('.time-btn').forEach(btn => btn.classList.remove('selected'));
    
    // Clear message field
    document.getElementById('planMessage').value = '';
    
    // Show ALL friends (not filtered by availability)
    const friendsList = document.getElementById('planFriendsList');
    if (linkedFriends && linkedFriends.length > 0) {
        friendsList.innerHTML = linkedFriends.map(friend => `
            <div class="plan-friend-item" data-user-id="${friend.id}" onclick="togglePlanFriend(this, ${friend.id})">
                <div class="friend-checkbox"></div>
                <div class="friend-avatar">${getInitials(friend.name)}</div>
                <div class="friend-name">${friend.name}</div>
            </div>
        `).join('');
    } else {
        friendsList.innerHTML = '<div class="plan-friends-empty">No friends yet. Add friends first!</div>';
    }
    
    updateSendInviteButton();
    document.getElementById('planModal').classList.add('active');
}

// Edit existing plan
let editingPlanId = null;

async function openEditPlanModal(planId) {
    console.log('[EDIT PLAN] Opening edit modal for plan:', planId);
    
    // Fetch the plan details first (while plans modal is still open)
    try {
        const response = await fetch(`/api/hangouts/${planId}`);
        if (!response.ok) {
            showStatus('Failed to load plan details', 'error');
            return;
        }
        const plan = await response.json();
        
        // Keep plans modal open - edit modal will layer on top
        editingPlanId = planId;
        isNewPlanMode = false;
        selectedPlanFriends = plan.invitees.map(inv => inv.user_id);
        selectedPlanTime = plan.time_slot.toLowerCase();
        
        // Show datetime section, hide slot info
        document.getElementById('planSlotInfo').style.display = 'none';
        document.getElementById('planDatetimeSection').style.display = 'block';
        document.getElementById('planFriendsHeader').textContent = 'Invited friends (select more to add)';
        document.getElementById('planModalTitle').textContent = 'Edit Plan';
        
        // Set date
        document.getElementById('planDateInput').value = plan.date;
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('planDateInput').min = today;
        
        // Set time selection
        document.querySelectorAll('.time-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (btn.dataset.time === selectedPlanTime) {
                btn.classList.add('selected');
            }
        });
        
        // Set message field
        document.getElementById('planMessage').value = plan.description || '';
        
        // Show ALL friends with current invitees pre-selected
        const friendsList = document.getElementById('planFriendsList');
        if (linkedFriends && linkedFriends.length > 0) {
            friendsList.innerHTML = linkedFriends.map(friend => {
                const isSelected = selectedPlanFriends.includes(friend.id);
                return `
                    <div class="plan-friend-item ${isSelected ? 'selected' : ''}" data-user-id="${friend.id}" onclick="togglePlanFriend(this, ${friend.id})">
                        <div class="friend-checkbox"></div>
                        <div class="friend-avatar">${getInitials(friend.name)}</div>
                        <div class="friend-name">${friend.name}</div>
                    </div>
                `;
            }).join('');
        } else {
            friendsList.innerHTML = '<div class="plan-friends-empty">No friends yet. Add friends first!</div>';
        }
        
        updateSendInviteButton();
        document.getElementById('planModal').classList.add('active');
    } catch (error) {
        console.error('Error loading plan:', error);
        showStatus('Failed to load plan details', 'error');
    }
}

// Select time for new plan
function selectPlanTime(time) {
    selectedPlanTime = time;
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.time === time);
    });
    updateSendInviteButton();
}

// Handle date input change
document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('planDateInput');
    if (dateInput) {
        dateInput.addEventListener('change', updateSendInviteButton);
    }
});

function openPlanModal() {
    if (!currentPopupSlot) return;
    
    isNewPlanMode = false;
    const { date, timeSlot } = currentPopupSlot;
    closeSlotPopup();
    
    // Store for sending invite
    currentPlanSlot = { date, timeSlot };
    selectedPlanFriends = [];
    
    // Show slot info, hide datetime section
    document.getElementById('planSlotInfo').style.display = 'block';
    document.getElementById('planDatetimeSection').style.display = 'none';
    document.getElementById('planFriendsHeader').textContent = "Who's available?";
    document.getElementById('planModalTitle').textContent = 'Plan a Hangout';
    
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
    
    // In new plan mode or edit mode, also need date and time selected
    if (isNewPlanMode || editingPlanId) {
        const dateValue = document.getElementById('planDateInput').value;
        if (selectedPlanFriends.length > 0 && dateValue && selectedPlanTime) {
            btn.disabled = false;
            btn.textContent = editingPlanId ? 'Save Changes' : `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
        } else {
            btn.disabled = true;
            if (!dateValue || !selectedPlanTime) {
                btn.textContent = 'Select date and time';
            } else {
                btn.textContent = 'Select friends to invite';
            }
        }
    } else {
        if (selectedPlanFriends.length > 0) {
            btn.disabled = false;
            btn.textContent = `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
        } else {
            btn.disabled = true;
            btn.textContent = 'Select friends to invite';
        }
    }
}

// Send hangout invite
async function sendHangoutInvite() {
    if (selectedPlanFriends.length === 0) return;
    
    let date, timeSlot;
    
    if (isNewPlanMode || editingPlanId) {
        date = document.getElementById('planDateInput').value;
        timeSlot = selectedPlanTime;
        if (!date || !timeSlot) return;
    } else {
        if (!currentPlanSlot) return;
        date = currentPlanSlot.date;
        timeSlot = currentPlanSlot.timeSlot;
    }
    
    const btn = document.getElementById('sendInviteBtn');
    btn.disabled = true;
    btn.textContent = editingPlanId ? 'Saving...' : 'Sending...';
    
    const message = document.getElementById('planMessage').value.trim();
    
    try {
        let response;
        
        if (editingPlanId) {
            // Update existing plan
            response = await fetch(`/api/hangouts/${editingPlanId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: date,
                    time_slot: timeSlot,
                    description: message,
                    invitee_ids: selectedPlanFriends
                })
            });
        } else {
            // Create new plan
            response = await fetch('/api/hangouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: date,
                    time_slot: timeSlot,
                    description: message,
                    invitee_ids: selectedPlanFriends
                })
            });
        }
        
        if (response.ok) {
            const data = await response.json();
            showStatus(editingPlanId ? 'Plan updated!' : 'Hangout invite sent!', 'success');
            editingPlanId = null;
            closePlanModal();
            // Refresh to show updated hangout status
            loadHangoutStatuses();
        } else {
            const data = await response.json();
            showStatus(data.error || 'Error sending invite', 'error');
            btn.disabled = false;
            btn.textContent = editingPlanId ? 'Save Changes' : `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
        }
    } catch (error) {
        console.error('Error sending hangout invite:', error);
        showStatus('Error sending invite', 'error');
        btn.disabled = false;
        btn.textContent = editingPlanId ? 'Save Changes' : `Send Invite${selectedPlanFriends.length > 1 ? 's' : ''} (${selectedPlanFriends.length})`;
    }
}

// Close plan modal
function closePlanModal() {
    document.getElementById('planModal').classList.remove('active');
    currentPlanSlot = null;
    selectedPlanFriends = [];
    editingPlanId = null;
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

// Update plan button state (no longer used - auto-save enabled)
function updatePlanButton() {
    // No-op: Save button removed, using auto-save instead
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
            
            // Add avatar for each friend (max 4 shown)
            // Determine how many bubbles to show
            // If 5 or fewer friends, show all of them
            // If 6+ friends, show 4 + a "+N" indicator (where N >= 2)
            const maxBubbles = friends.length <= 5 ? friends.length : 4;
            const overflow = friends.length - maxBubbles;
            
            friends.slice(0, maxBubbles).forEach(friend => {
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
            
            // Only show +N if there are 2+ more friends
            if (overflow >= 2) {
                const moreAvatar = document.createElement('div');
                moreAvatar.className = 'slot-avatar';
                moreAvatar.textContent = `+${overflow}`;
                moreAvatar.title = friends.slice(maxBubbles).map(f => f.name).join(', ');
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
        const headerBadge = document.getElementById('notificationBadgeHeader');
        if (unreadCount > 0) {
            if (badge) {
                badge.textContent = unreadCount;
                badge.style.display = 'flex';
            }
            if (headerBadge) {
                headerBadge.textContent = unreadCount;
                headerBadge.style.display = 'flex';
            }
        } else {
            if (badge) badge.style.display = 'none';
            if (headerBadge) headerBadge.style.display = 'none';
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
    closeAllNavModals();
    document.getElementById('notificationsModal').classList.add('active');
    await loadNotifications();
    
    // Mark all as read
    if (plannerInfo && plannerInfo.id) {
        fetch(`/api/notifications/${plannerInfo.id}/mark-read`, {
            method: 'POST'
        });
        
        // Hide badges immediately
        const badge = document.getElementById('notificationBadge');
        const headerBadge = document.getElementById('notificationBadgeHeader');
        if (badge) badge.style.display = 'none';
        if (headerBadge) headerBadge.style.display = 'none';
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
    closeAllNavModals();
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
            // On fresh install, auto-mark existing messages as seen
            initializeSeenMessagesIfNeeded(allPlans);
            renderPlans();
            updatePlansBadge();
        }
    } catch (error) {
        console.error('Error loading plans:', error);
    }
}

// Track last seen message IDs per plan
function getSeenMessageIds() {
    return JSON.parse(localStorage.getItem('seenPlanMessages') || '{}');
}

function setSeenMessageId(planId, messageId) {
    const seen = getSeenMessageIds();
    seen[planId] = messageId;
    localStorage.setItem('seenPlanMessages', JSON.stringify(seen));
}

// On fresh install, auto-mark all existing messages as seen
// This prevents old messages from showing as unread after reinstall
function initializeSeenMessagesIfNeeded(plans) {
    const seenData = localStorage.getItem('seenPlanMessages');
    
    // If there's already seen data, this isn't a fresh install
    if (seenData && seenData !== '{}') return;
    
    // Fresh install - mark all current messages as seen
    const seen = {};
    const allPlansList = [...plans.created, ...plans.invited];
    allPlansList.forEach(plan => {
        if (plan.latest_message_id) {
            seen[plan.id] = plan.latest_message_id;
        }
    });
    localStorage.setItem('seenPlanMessages', JSON.stringify(seen));
}

function updatePlansBadge() {
    if (!allPlans || !plannerInfo) return;
    
    const seen = getSeenMessageIds();
    let unreadCount = 0;
    
    // Check all plans for new messages
    const allPlansList = [...allPlans.created, ...allPlans.invited];
    
    // Get today's date for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    allPlansList.forEach(plan => {
        // Skip plans more than 7 days past - don't show badges for them
        // (7-day window allows for bill splitting discussions after the event)
        const planDate = new Date(plan.date + 'T23:59:59');
        const daysPast = Math.floor((today - planDate) / (1000 * 60 * 60 * 24));
        if (daysPast > 7) return; // Skip plans more than 7 days past
        
        if (plan.latest_message_id) {
            const lastSeen = seen[plan.id] || 0;
            // Only count as unread if:
            // 1. There's a new message we haven't seen
            // 2. AND the latest message is NOT from the current user
            if (plan.latest_message_id > lastSeen && plan.latest_message_user_id !== plannerInfo.id) {
                unreadCount++;
            }
        }
    });
    
    const badge = document.getElementById('plansBadge');
    const navBadge = document.getElementById('plansBadgeNav');
    if (unreadCount > 0) {
        if (badge) {
            badge.textContent = unreadCount;
            badge.style.display = 'flex';
        }
        if (navBadge) {
            navBadge.textContent = unreadCount;
            navBadge.style.display = 'flex';
        }
    } else {
        if (badge) badge.style.display = 'none';
        if (navBadge) navBadge.style.display = 'none';
    }
}

// Call this periodically to check for new messages
function startPlansBadgePolling() {
    setInterval(async () => {
        // Only poll if plans modal is NOT open
        if (!document.getElementById('plansModal').classList.contains('active') &&
            !document.getElementById('planDetailModal').classList.contains('active')) {
            await loadPlans();
        }
    }, 15000); // Check every 15 seconds
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
    
    // Separate into upcoming and past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingPlans = allPlansList.filter(plan => {
        const planDate = new Date(plan.date + 'T23:59:59'); // End of day
        return planDate >= today;
    });
    
    const pastPlans = allPlansList.filter(plan => {
        const planDate = new Date(plan.date + 'T23:59:59');
        return planDate < today;
    });
    
    // Sort upcoming by date ascending (soonest first)
    upcomingPlans.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Sort past by date descending (most recent past first)
    pastPlans.sort((a, b) => new Date(b.date) - new Date(a.date));
    
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
    
    let html = '';
    
    // Upcoming section
    if (upcomingPlans.length > 0) {
        html += `<div class="plans-section-header">Upcoming</div>`;
        html += upcomingPlans.map(plan => renderPlanCard(plan, false)).join('');
    } else {
        html += `
            <div class="plans-section-header">Upcoming</div>
            <div class="plans-section-empty">No upcoming plans</div>
        `;
    }
    
    // Past section (collapsible)
    if (pastPlans.length > 0) {
        html += `
            <div class="plans-section-header plans-past-header" onclick="togglePastPlans()">
                Past <span class="past-toggle-icon" id="pastToggleIcon">▶</span>
            </div>
            <div class="plans-past-section collapsed" id="pastPlansSection">
                ${pastPlans.map(plan => renderPlanCard(plan, true)).join('')}
            </div>
        `;
    }
    
    plansList.innerHTML = html;
}

function renderPlanCard(plan, isPast) {
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
    
    // Check if this plan has unread messages (but not for past plans)
    const seen = getSeenMessageIds();
    const lastSeen = seen[plan.id] || 0;
    const hasUnread = !isPast && 
                      plan.latest_message_id && 
                      plan.latest_message_id > lastSeen && 
                      plan.latest_message_user_id !== plannerInfo?.id;
    
    return `
        <div class="plan-card ${isPast ? 'plan-card-past' : ''} ${hasUnread ? 'plan-card-unread' : ''}" onclick="openPlanDetail(${plan.id})">
            <div class="plan-card-role">
                ${plan.role === 'host' ? '👑 You\'re hosting' : `📬 Invited by ${plan.creator_name}`}
                ${hasUnread ? '<span class="plan-unread-dot"></span>' : ''}
            </div>
            <div class="plan-card-header">
                <div class="plan-card-date">${dateStr}</div>
                <div class="plan-card-time">${plan.time_slot}</div>
            </div>
            ${plan.description ? `<div class="plan-card-description">${plan.description}</div>` : ''}
            <div class="plan-card-guests">${guestChips}</div>
        </div>
    `;
}

function togglePastPlans() {
    const section = document.getElementById('pastPlansSection');
    const icon = document.getElementById('pastToggleIcon');
    
    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        section.classList.add('collapsed');
        icon.textContent = '▶';
    }
}

function togglePlanDetails() {
    const content = document.getElementById('planInfoContent');
    const icon = document.getElementById('planInfoToggle');
    
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        icon.textContent = '▶';
    }
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
    
    // Mark messages as seen for this plan
    if (plan.latest_message_id) {
        setSeenMessageId(planId, plan.latest_message_id);
        updatePlansBadge();
    }
    
    renderPlanDetail();
    document.getElementById('planDetailModal').classList.add('active');
}

function renderPlanDetail() {
    if (!currentPlanDetail) return;
    
    const plan = currentPlanDetail;
    const content = document.getElementById('planDetailContent');
    const titleInfo = document.getElementById('planDetailTitleInfo');
    const optionsMenu = document.getElementById('planOptionsMenu');
    
    const dateObj = new Date(plan.date + 'T12:00:00');
    const shortDateStr = dateObj.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric'
    });
    
    // Check if plan is in the past (with 7-day grace period for post-event coordination like bill splitting)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const planDate = new Date(plan.date + 'T23:59:59');
    const daysPast = Math.floor((today - planDate) / (1000 * 60 * 60 * 24));
    const isPast = daysPast > 7; // Allow chat for 7 days after event
    
    // Update header bar with plan info
    titleInfo.innerHTML = `${shortDateStr} · ${plan.time_slot}`;
    
    // Build options menu
    let optionsHtml = '';
    if (plan.role === 'host' && !isPast) {
        optionsHtml = `
            <button class="plan-option-item" onclick="editCurrentPlan(); closePlanOptions()">Edit Plan</button>
            <button class="plan-option-item plan-option-danger" onclick="cancelPlan(${plan.id}); closePlanOptions()">Cancel Plan</button>
        `;
    } else if (!isPast) {
        optionsHtml = `<button class="plan-option-item plan-option-danger" onclick="leaveEvent(${plan.id}); closePlanOptions()">Leave Event</button>`;
    }
    optionsMenu.innerHTML = optionsHtml;
    
    // Build guest badges (inline) - include host first with special styling
    const hostFirstName = plan.creator_name.split(' ')[0];
    const hostBadge = `<span class="guest-badge host"><span class="guest-badge-name">👑 ${hostFirstName}</span> <span class="guest-badge-status">Host</span></span>`;
    
    const inviteeBadges = plan.invitees.map(inv => {
        const statusClass = inv.status || 'pending';
        const statusText = inv.status === 'accepted' ? 'Going' : 
                          inv.status === 'declined' ? 'Can\'t' : 
                          inv.status === 'maybe' ? 'Maybe' : '...';
        const firstName = inv.user_name.split(' ')[0];
        return `<span class="guest-badge ${statusClass}"><span class="guest-badge-name">${firstName}</span> <span class="guest-badge-status">${statusText}</span></span>`;
    }).join('');
    
    const guestBadges = hostBadge + inviteeBadges;
    
    // Check if user can respond (they're a guest and plan is not in the past)
    const myInvite = plan.invitees.find(inv => inv.user_id === plannerInfo.id);
    const canRespond = plan.role === 'guest' && myInvite && !isPast;
    
    // Build RSVP pills (only for guests who haven't responded or want to change)
    let rsvpPills = '';
    if (canRespond) {
        rsvpPills = `
            <div class="rsvp-pills">
                <button class="rsvp-pill rsvp-going ${myInvite.status === 'accepted' ? 'active' : ''}" onclick="respondToPlanDetail('accepted')">Going</button>
                <button class="rsvp-pill rsvp-maybe ${myInvite.status === 'maybe' ? 'active' : ''}" onclick="respondToPlanDetail('maybe')">Maybe</button>
                <button class="rsvp-pill rsvp-cant ${myInvite.status === 'declined' ? 'active' : ''}" onclick="respondToPlanDetail('declined')">Can't go</button>
            </div>
        `;
    }
    
    // Determine if details should be open by default (open until user RSVPs)
    const needsRsvp = canRespond && myInvite && myInvite.status === 'pending';
    const detailsCollapsed = needsRsvp ? '' : 'collapsed';
    const detailsIcon = needsRsvp ? '▼' : '▶';
    
    // Build info card (collapsible, open until user RSVPs)
    const hostName = plan.creator_name.split(' ')[0];
    const infoCard = `
        <div class="plan-info-section">
            <div class="plan-info-header" onclick="togglePlanDetails()">
                <span>Details</span>
                <span class="plan-info-toggle" id="planInfoToggle">${detailsIcon}</span>
            </div>
            <div class="plan-info-content ${detailsCollapsed}" id="planInfoContent">
                ${rsvpPills}
                <div class="plan-info-card">
                    <div class="plan-info-guests">${guestBadges}</div>
                </div>
            </div>
        </div>
    `;
    
    // Build chat area
    const chatArea = `
        <div class="plan-chat-area">
            <div class="plan-chat-messages" id="planChatMessages">
            </div>
        </div>
    `;
    
    // Build bottom bar with suggestions and input
    let bottomBar = '';
    if (!isPast) {
        bottomBar = `
            <div class="plan-bottom-bar">
                <div class="ai-suggestions-section">
                    <div class="ai-suggestions-header" onclick="toggleAiSuggestions()">
                        <span class="ai-suggestions-title">✨ Get suggestions</span>
                        <span class="ai-suggestions-toggle" id="aiSuggestionsToggle">▶</span>
                    </div>
                    <div class="ai-suggestions-content collapsed" id="aiSuggestionsContent">
                        <div class="ai-suggestions-options" id="aiSuggestionsOptions">
                            <button class="ai-suggestion-btn" onclick="selectAiSuggestion('food')">
                                <span class="ai-btn-icon">🍽️</span>
                                <span class="ai-btn-label">Food</span>
                            </button>
                            <button class="ai-suggestion-btn" onclick="selectAiSuggestion('drinks')">
                                <span class="ai-btn-icon">🍸</span>
                                <span class="ai-btn-label">Drinks</span>
                            </button>
                            <button class="ai-suggestion-btn" onclick="selectAiSuggestion('split')">
                                <span class="ai-btn-icon">🧾</span>
                                <span class="ai-btn-label">Split bill</span>
                            </button>
                            <button class="ai-suggestion-btn" onclick="selectAiSuggestion('custom')">
                                <span class="ai-btn-icon">💬</span>
                                <span class="ai-btn-label">Ask anything</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="plan-chat-input">
                    <input type="file" id="chatImageInput" accept="image/*" style="display: none;" onchange="handleImageSelect(event)">
                    <button class="chat-image-btn" onclick="document.getElementById('chatImageInput').click()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                    </button>
                    <div id="planChatInput" class="chat-input-editable" contenteditable="true" data-placeholder="Type a message..." inputmode="text" enterkeyhint="send" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" onkeydown="handleChatKeydown(event)" oninput="handleChatInput(this)"></div>
                    <button class="chat-send-btn" onmousedown="event.preventDefault()" ontouchend="event.preventDefault(); sendPlanMessage()" onclick="sendPlanMessage()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
                <div class="chat-image-preview" id="chatImagePreview" style="display: none;">
                    <img id="chatImagePreviewImg" src="" alt="Preview">
                    <button class="chat-image-remove" onclick="removeImagePreview()">×</button>
                </div>
            </div>
        `;
    } else {
        bottomBar = `
            <div class="plan-bottom-bar plan-bottom-bar-locked">
                <div class="plan-chat-locked">This event has passed</div>
            </div>
        `;
    }
    
    content.innerHTML = `
        ${infoCard}
        ${chatArea}
        ${bottomBar}
    `;
    
    // Load chat messages
    loadPlanChatMessages(plan.id);
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

async function leaveEvent(planId) {
    if (!confirm('Are you sure you want to leave this event?')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/hangouts/${planId}/leave`, {
            method: 'POST'
        });
        
        if (res.ok) {
            showStatus('You have left the event', 'success');
            closePlanDetail();
            await loadPlans();
            loadHangoutStatuses();
        } else {
            const data = await res.json();
            showStatus(data.error || 'Failed to leave event', 'error');
        }
    } catch (error) {
        console.error('Error leaving event:', error);
        showStatus('Failed to leave event', 'error');
    }
}

function closePlanDetail() {
    document.getElementById('planDetailModal').classList.remove('active');
    currentPlanDetail = null;
    stopChatPolling();
}

// =====================
// Plan Chat Functions
// =====================

let chatPollingInterval = null;
let lastMessageId = 0;

async function loadPlanChatMessages(hangoutId) {
    const container = document.getElementById('planChatMessages');
    if (!container) return;
    
    try {
        const response = await fetch(`/api/hangouts/${hangoutId}/messages`);
        if (response.ok) {
            const messages = await response.json();
            renderChatMessages(messages);
            
            // Track last message ID for polling
            if (messages.length > 0) {
                lastMessageId = messages[messages.length - 1].id;
                // Mark as seen since user is viewing the chat
                setSeenMessageId(hangoutId, lastMessageId);
                updatePlansBadge();
            }
            
            // Start polling for new messages
            startChatPolling(hangoutId);
        } else {
            container.innerHTML = '<div class="chat-error">Failed to load messages</div>';
        }
    } catch (error) {
        console.error('Error loading chat messages:', error);
        container.innerHTML = '<div class="chat-error">Failed to load messages</div>';
    }
}

function renderChatMessages(messages) {
    const container = document.getElementById('planChatMessages');
    if (!container) return;
    
    // Create the event suggestion as the first message from the host
    let suggestionMessage = '';
    if (currentPlanDetail && currentPlanDetail.description) {
        const hostName = currentPlanDetail.creator_name.split(' ')[0];
        const isHostMe = currentPlanDetail.creator_id === plannerInfo.id;
        const createdTime = new Date(currentPlanDetail.created_at).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        
        suggestionMessage = `
            <div class="chat-message ${isHostMe ? 'chat-message-me' : 'chat-message-other'} chat-message-suggestion">
                ${!isHostMe ? `<div class="chat-message-name">${hostName}</div>` : ''}
                <div class="chat-message-bubble">
                    <div class="chat-message-text">${escapeHtml(currentPlanDetail.description)}</div>
                    <div class="chat-message-time">${createdTime}</div>
                </div>
            </div>
        `;
    }
    
    if (messages.length === 0 && !suggestionMessage) {
        container.innerHTML = '<div class="chat-empty">Start the conversation!</div>';
        return;
    }
    
    const chatMessages = messages.map(msg => {
        const isMe = msg.user_id === plannerInfo.id;
        const isAi = msg.is_ai_message || msg.message.startsWith('✨ AI:');
        const hasImage = msg.image_data;
        const time = new Date(msg.created_at).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        
        let messageClass = isMe ? 'chat-message-me' : 'chat-message-other';
        if (isAi) messageClass += ' chat-message-ai';
        if (hasImage) messageClass += ' chat-message-image';
        
        // For AI messages, show "AI Assistant" as the name
        const displayName = isAi ? '✨ AI Assistant' : msg.user_name;
        
        // Build message content
        let messageContent = '';
        if (hasImage) {
            messageContent += `<img class="chat-image" src="data:image/jpeg;base64,${msg.image_data}" alt="Shared image" onclick="openImageFullscreen(this.src)">`;
        }
        
        // Only show text if it's not just the default "Shared a photo" or if there's a caption
        const messageText = msg.message.replace('✨ AI: ', '');
        if (messageText && messageText !== '📷 Shared a photo') {
            messageContent += `<div class="chat-message-text">${escapeHtml(messageText)}</div>`;
        }
        
        return `
            <div class="chat-message ${messageClass}">
                ${(!isMe || isAi) ? `<div class="chat-message-name">${displayName}</div>` : ''}
                <div class="chat-message-bubble">
                    ${messageContent}
                    <div class="chat-message-time">${time}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Combine suggestion message with chat messages
    container.innerHTML = suggestionMessage + chatMessages;
    
    // Scroll to bottom after DOM renders - multiple attempts for reliability
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        // Second scroll after a short delay to catch any late layout shifts
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 100);
        // Third scroll for first-time modal opens
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 300);
    });
}

function openImageFullscreen(src) {
    // Create fullscreen overlay
    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen-overlay';
    overlay.innerHTML = `
        <img src="${src}" alt="Full size image">
        <button class="image-fullscreen-close" onclick="this.parentElement.remove()">×</button>
    `;
    overlay.onclick = function(e) {
        if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add message to chat immediately (optimistic UI)
function addOptimisticMessage(message, imageData = null) {
    const container = document.getElementById('planChatMessages');
    if (!container) return;
    
    // Remove "Start the conversation" placeholder if present
    const empty = container.querySelector('.chat-empty');
    if (empty) empty.remove();
    
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    let messageContent = '';
    if (imageData) {
        messageContent += `<img class="chat-image" src="data:image/jpeg;base64,${imageData}" alt="Shared image" onclick="openImageFullscreen(this.src)">`;
    }
    if (message && message !== '📷 Shared a photo') {
        messageContent += `<div class="chat-message-text">${escapeHtml(message)}</div>`;
    }
    
    const messageHtml = `
        <div class="chat-message chat-message-me">
            <div class="chat-message-bubble">
                ${messageContent}
                <div class="chat-message-time">${time}</div>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', messageHtml);
    
    // Scroll to bottom
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

async function sendPlanMessage() {
    if (!currentPlanDetail) return;
    
    const input = document.getElementById('planChatInput');
    const message = (input.innerText || input.textContent || '').trim();
    
    // If there's a pending image, send it
    if (pendingImageData) {
        await sendImageMessage();
        return;
    }
    
    if (!message) return;
    
    // Check if this is an @AI message
    const isAiMessage = message.toLowerCase().startsWith('@ai ');
    
    try {
        if (isAiMessage) {
            // Handle AI request
            const aiPrompt = message.substring(4).trim(); // Remove @AI prefix
            
            // Clear input and show user's message immediately
            input.textContent = '';
            addOptimisticMessage(`🤖 ${aiPrompt}`);
            
            // Determine suggestion type from prompt
            let type = 'custom';
            if (aiPrompt.toLowerCase().includes('food') || aiPrompt.toLowerCase().includes('dinner') || aiPrompt.toLowerCase().includes('lunch') || aiPrompt.toLowerCase().includes('brunch')) type = 'food';
            else if (aiPrompt.toLowerCase().includes('drinks') || aiPrompt.toLowerCase().includes('bar')) type = 'drinks';
            else if (aiPrompt.toLowerCase().includes('split') || aiPrompt.toLowerCase().includes('bill')) type = 'split';
            
            // Send the user's question to server first (must complete before AI request)
            const saveResponse = await fetch(`/api/hangouts/${currentPlanDetail.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `🤖 ${aiPrompt}` })
            });
            
            if (!saveResponse.ok) {
                console.error('Failed to save AI request message:', await saveResponse.text());
            }
            
            // Then get AI response (this takes time)
            const aiResult = await sendAiRequest(message, type);
            
            // Always reload messages to show user's message and any AI response
            if (aiResult && aiResult.message) {
                setSeenMessageId(currentPlanDetail.id, aiResult.message.id);
            }
            await loadPlanChatMessages(currentPlanDetail.id);
        } else {
            // Regular message - show immediately (optimistic UI)
            const messageText = message;
            input.textContent = '';
            
            // Add message to chat immediately
            addOptimisticMessage(messageText);
            
            // Send to server in background
            const response = await fetch(`/api/hangouts/${currentPlanDetail.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText })
            });
            
            if (response.ok) {
                const newMessage = await response.json();
                // Mark this message as seen (so your own message doesn't show as unread)
                setSeenMessageId(currentPlanDetail.id, newMessage.id);
            } else {
                const data = await response.json();
                showStatus(data.error || 'Failed to send message', 'error');
            }
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showStatus('Failed to send message', 'error');
    }
}

function handleChatKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendPlanMessage();
    }
}

function handleChatFocus() {
    // When keyboard opens, scroll chat to bottom
    const scrollToBottom = () => {
        const chatMessages = document.getElementById('planChatMessages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    };
    
    // Scroll immediately and after delays
    scrollToBottom();
    setTimeout(scrollToBottom, 100);
    setTimeout(scrollToBottom, 300);
}

// =====================
// AI Chat Functions
// =====================

async function openAiChat() {
    closeAllNavModals();
    document.getElementById('aiChatModal').classList.add('active');
    await loadAiChatMessages();
}

function closeAiChat() {
    document.getElementById('aiChatModal').classList.remove('active');
}

async function loadAiChatMessages() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;
    
    try {
        const response = await fetch('/api/ai-chat/messages');
        if (response.ok) {
            const messages = await response.json();
            renderAiChatMessages(messages);
        }
    } catch (error) {
        console.error('Error loading AI chat messages:', error);
    }
}

function renderAiChatMessages(messages) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;
    
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="chat-empty">
                <div style="font-size: 48px; margin-bottom: 16px;">✨</div>
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Hi! I'm your AI assistant</div>
                <div style="font-size: 14px; color: var(--text-muted);">Ask me anything - restaurant recommendations, activity ideas, travel tips, or just chat!</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = messages.map(msg => {
        const isMe = !msg.is_ai_message;
        const messageClass = isMe ? 'chat-message-me' : 'chat-message-ai';
        const name = isMe ? 'You' : '✨ AI Assistant';
        const time = new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        return `
            <div class="chat-message ${messageClass}">
                <div class="chat-message-name">${name}</div>
                <div class="chat-message-bubble">
                    ${msg.message}
                    <div class="chat-message-time">${time}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

async function sendAiChatMessage() {
    const input = document.getElementById('aiChatInput');
    const message = input.textContent.trim();
    
    if (!message) return;
    
    // Clear input
    input.textContent = '';
    
    // Add optimistic message
    const container = document.getElementById('aiChatMessages');
    
    // Remove welcome message if present
    const welcome = container.querySelector('.chat-empty');
    if (welcome) {
        welcome.remove();
    }
    
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    // Add user message optimistically
    const userMsgHtml = `
        <div class="chat-message chat-message-me">
            <div class="chat-message-name">You</div>
            <div class="chat-message-bubble">
                ${message}
                <div class="chat-message-time">${time}</div>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', userMsgHtml);
    container.scrollTop = container.scrollHeight;
    
    // Add typing indicator
    const typingHtml = `
        <div class="chat-message chat-message-ai ai-typing">
            <div class="chat-message-name">✨ AI Assistant</div>
            <div class="chat-message-bubble">Thinking...</div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', typingHtml);
    container.scrollTop = container.scrollHeight;
    
    try {
        const response = await fetch('/api/ai-chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        
        // Remove typing indicator
        const typing = container.querySelector('.ai-typing');
        if (typing) typing.remove();
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.ai_message) {
                const aiTime = new Date(data.ai_message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const aiMsgHtml = `
                    <div class="chat-message chat-message-ai">
                        <div class="chat-message-name">✨ AI Assistant</div>
                        <div class="chat-message-bubble">
                            ${data.ai_message.message}
                            <div class="chat-message-time">${aiTime}</div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', aiMsgHtml);
                container.scrollTop = container.scrollHeight;
            }
        }
    } catch (error) {
        console.error('Error sending AI chat message:', error);
        // Remove typing indicator
        const typing = container.querySelector('.ai-typing');
        if (typing) typing.remove();
    }
}

function handleAiChatKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAiChatMessage();
    }
}

function handleAiChatFocus() {
    const scrollToBottom = () => {
        const chatMessages = document.getElementById('aiChatMessages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    };
    scrollToBottom();
    setTimeout(scrollToBottom, 100);
}

async function clearAiChatHistory() {
    if (!confirm('Clear all chat history with AI?')) return;
    
    try {
        const response = await fetch('/api/ai-chat/clear', { method: 'POST' });
        if (response.ok) {
            await loadAiChatMessages();
        }
    } catch (error) {
        console.error('Error clearing AI chat:', error);
    }
}

// Detect keyboard open/close using visualViewport
function setupKeyboardDetection() {
    if (window.visualViewport) {
        let initialHeight = window.visualViewport.height;
        
        const updateViewport = () => {
            const vh = window.visualViewport.height;
            const offsetTop = window.visualViewport.offsetTop;
            const modal = document.getElementById('planDetailModal');
            const modalContent = modal ? modal.querySelector('.modal-content') : null;
            const chatMessages = document.getElementById('planChatMessages');
            
            // If viewport shrunk significantly, keyboard is open
            if (vh < initialHeight - 100) {
                document.body.classList.add('keyboard-open');
                
                // Resize the modal content to fit the visual viewport
                if (modalContent) {
                    modalContent.style.height = vh + 'px';
                    modalContent.style.top = offsetTop + 'px';
                }
                
                // Scroll chat to bottom
                if (chatMessages) {
                    setTimeout(() => {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }, 50);
                }
            } else {
                document.body.classList.remove('keyboard-open');
                initialHeight = window.visualViewport.height;
                
                // Reset
                if (modalContent) {
                    modalContent.style.height = '';
                    modalContent.style.top = '';
                }
            }
        };
        
        window.visualViewport.addEventListener('resize', updateViewport);
        window.visualViewport.addEventListener('scroll', updateViewport);
    }
}

// Initialize keyboard detection
document.addEventListener('DOMContentLoaded', setupKeyboardDetection);

function autoResizeTextarea(textarea) {
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set the height to scrollHeight (content height)
    const newHeight = Math.min(textarea.scrollHeight, 120); // Max 120px (about 4 lines)
    textarea.style.height = newHeight + 'px';
}

function handleChatInput(element) {
    // Handle placeholder visibility for contenteditable
    if (element.textContent.trim() === '') {
        element.classList.add('empty');
    } else {
        element.classList.remove('empty');
    }
}

// Image Upload for Chat
let pendingImageData = null;

async function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check file type
    if (!file.type.startsWith('image/')) {
        showStatus('Please select an image file', 'error');
        return;
    }
    
    // Compress and convert to base64
    try {
        const compressedData = await compressImage(file, 800, 0.7);
        pendingImageData = compressedData;
        
        // Show preview
        const preview = document.getElementById('chatImagePreview');
        const previewImg = document.getElementById('chatImagePreviewImg');
        previewImg.src = `data:image/jpeg;base64,${compressedData}`;
        preview.style.display = 'flex';
    } catch (error) {
        console.error('Error compressing image:', error);
        showStatus('Failed to process image', 'error');
    }
    
    // Clear the file input
    event.target.value = '';
}

function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Scale down if needed
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to base64 (without the data:image/jpeg;base64, prefix)
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function removeImagePreview() {
    pendingImageData = null;
    const preview = document.getElementById('chatImagePreview');
    preview.style.display = 'none';
}

async function sendImageMessage() {
    if (!currentPlanDetail || !pendingImageData) return;
    
    const input = document.getElementById('planChatInput');
    const caption = (input.innerText || input.textContent || '').trim();
    
    // Clear UI immediately
    const imageData = pendingImageData;
    const messageText = caption || '📷 Shared a photo';
    input.textContent = '';
    removeImagePreview();
    pendingImageData = null;
    
    // Show message immediately (optimistic UI)
    addOptimisticMessage(messageText, imageData);
    
    try {
        const response = await fetch(`/api/hangouts/${currentPlanDetail.id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: messageText,
                image_data: imageData 
            })
        });
        
        if (response.ok) {
            const newMessage = await response.json();
            setSeenMessageId(currentPlanDetail.id, newMessage.id);
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to send image', 'error');
        }
    } catch (error) {
        console.error('Error sending image:', error);
        showStatus('Failed to send image', 'error');
    }
}

// AI Suggestions
let aiSuggestionsExpanded = false;

function toggleAiSuggestions() {
    const content = document.getElementById('aiSuggestionsContent');
    const toggle = document.getElementById('aiSuggestionsToggle');
    
    aiSuggestionsExpanded = !aiSuggestionsExpanded;
    
    if (aiSuggestionsExpanded) {
        content.classList.remove('collapsed');
        toggle.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        toggle.textContent = '▶';
    }
}

function selectAiSuggestion(type) {
    const input = document.getElementById('planChatInput');
    
    const prompts = {
        'food': '@AI suggest food spots',
        'drinks': '@AI suggest places for drinks',
        'split': '@AI split the bill',
        'custom': '@AI '
    };
    
    input.textContent = prompts[type] || '@AI ';
    input.focus();
    
    // If custom, place cursor at the end after @AI
    if (type === 'custom') {
        // Move cursor to end for contenteditable
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(input);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
    
    // Collapse the suggestions panel
    if (aiSuggestionsExpanded) {
        toggleAiSuggestions();
    }
}

async function sendAiRequest(prompt, type) {
    if (!currentPlanDetail) return null;
    
    try {
        const response = await fetch(`/api/hangouts/${currentPlanDetail.id}/ai-suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, type })
        });
        
        if (response.ok) {
            const data = await response.json();
            return data;
        } else {
            const error = await response.json();
            showStatus(error.error || 'Failed to get suggestion', 'error');
            return null;
        }
    } catch (error) {
        console.error('Error getting AI suggestion:', error);
        showStatus('Failed to get suggestion', 'error');
        return null;
    }
}

function startChatPolling(hangoutId) {
    // Stop any existing polling
    stopChatPolling();
    
    // Poll every 5 seconds
    chatPollingInterval = setInterval(async () => {
        if (!currentPlanDetail || currentPlanDetail.id !== hangoutId) {
            stopChatPolling();
            return;
        }
        
        try {
            const response = await fetch(`/api/hangouts/${hangoutId}/messages`);
            if (response.ok) {
                const messages = await response.json();
                
                // Only update if there are new messages
                if (messages.length > 0 && messages[messages.length - 1].id > lastMessageId) {
                    lastMessageId = messages[messages.length - 1].id;
                    renderChatMessages(messages);
                }
            }
        } catch (error) {
            console.error('Error polling chat:', error);
        }
    }, 5000);
}

function stopChatPolling() {
    if (chatPollingInterval) {
        clearInterval(chatPollingInterval);
        chatPollingInterval = null;
    }
    lastMessageId = 0;
}

// Check for ?openPlan= URL parameter and open the plan detail
async function checkOpenPlanParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const planId = urlParams.get('openPlan');
    
    if (planId) {
        console.log('[PLANS] Opening plan from URL param:', planId);
        
        // Clean up the URL without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Load plans first (in case they haven't been loaded yet)
        await loadPlans();
        
        // Small delay to ensure data is loaded
        setTimeout(() => {
            openPlanDetail(parseInt(planId));
        }, 300);
    }
}

function togglePlanOptions() {
    const menu = document.getElementById('planOptionsMenu');
    menu.classList.toggle('active');
}

function editCurrentPlan() {
    if (!currentPlanDetail) return;
    
    const plan = currentPlanDetail;
    
    editingPlanId = plan.id;
    isNewPlanMode = false;
    selectedPlanFriends = plan.invitees.map(inv => inv.user_id);
    selectedPlanTime = plan.time_slot.toLowerCase();
    
    // Show datetime section, hide slot info
    document.getElementById('planSlotInfo').style.display = 'none';
    document.getElementById('planDatetimeSection').style.display = 'block';
    document.getElementById('planFriendsHeader').textContent = 'Invited friends (select more to add)';
    document.getElementById('planModalTitle').textContent = 'Edit Plan';
    
    // Set date
    document.getElementById('planDateInput').value = plan.date;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('planDateInput').min = today;
    
    // Set time selection
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.time === selectedPlanTime) {
            btn.classList.add('selected');
        }
    });
    
    // Set message field
    document.getElementById('planMessage').value = plan.description || '';
    
    // Show ALL friends with current invitees pre-selected
    const friendsList = document.getElementById('planFriendsList');
    if (linkedFriends && linkedFriends.length > 0) {
        friendsList.innerHTML = linkedFriends.map(friend => {
            const isSelected = selectedPlanFriends.includes(friend.id);
            return `
                <div class="plan-friend-item ${isSelected ? 'selected' : ''}" data-user-id="${friend.id}" onclick="togglePlanFriend(this, ${friend.id})">
                    <div class="friend-checkbox"></div>
                    <div class="friend-avatar">${getInitials(friend.name)}</div>
                    <div class="friend-name">${friend.name}</div>
                </div>
            `;
        }).join('');
    } else {
        friendsList.innerHTML = '<div class="plan-friends-empty">No friends yet. Add friends first!</div>';
    }
    
    updateSendInviteButton();
    document.getElementById('planModal').classList.add('active');
}

function closePlanOptions() {
    const menu = document.getElementById('planOptionsMenu');
    menu.classList.remove('active');
}

function backToPlans() {
    closePlanOptions();
    closePlanDetail();
}

// Settings functions
async function openSettings() {
    closeAllNavModals();
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
    const section = document.getElementById('pushNotificationSection');
    const pushNotEnabled = document.getElementById('pushNotEnabled');
    const pushEnabled = document.getElementById('pushEnabled');
    const pushToggle = document.getElementById('pushToggle');
    
    // Hide section if push not supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    if (Notification.permission === 'denied') {
        statusEl.innerHTML = '<p class="settings-hint" style="color: #ef4444;">⚠️ Notifications are blocked. Please enable them in your browser settings.</p>';
        pushNotEnabled.style.display = 'none';
        pushEnabled.style.display = 'none';
    } else if (Notification.permission === 'granted' && pushSubscription) {
        statusEl.innerHTML = '';
        pushNotEnabled.style.display = 'none';
        pushEnabled.style.display = 'block';
        pushToggle.checked = true;
    } else {
        statusEl.innerHTML = '';
        pushNotEnabled.style.display = 'block';
        pushEnabled.style.display = 'none';
    }
}

async function enablePushFromSettings() {
    const success = await requestPushPermission();
    if (success) {
        showStatus('Push notifications enabled! 🔔', 'success');
    }
    updatePushNotificationStatus();
}

async function togglePushNotifications() {
    const pushToggle = document.getElementById('pushToggle');
    
    if (pushToggle.checked) {
        // Re-enable
        const success = await requestPushPermission();
        if (!success) {
            pushToggle.checked = false;
        }
    } else {
        // Disable - unsubscribe from push
        await disablePushNotifications();
    }
    updatePushNotificationStatus();
}

async function disablePushNotifications() {
    try {
        console.log('[PUSH] Disabling push notifications...');
        
        // Get the current subscription from the browser
        const registration = await navigator.serviceWorker.ready;
        const currentSub = await registration.pushManager.getSubscription();
        
        console.log('[PUSH] Current browser subscription:', currentSub ? 'exists' : 'none');
        
        if (currentSub) {
            // Unsubscribe from browser
            const unsubResult = await currentSub.unsubscribe();
            console.log('[PUSH] Browser unsubscribe result:', unsubResult);
            
            // Remove from server
            await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: currentSub.endpoint })
            });
            console.log('[PUSH] Removed from server');
        }
        
        pushSubscription = null;
        showStatus('Push notifications disabled', 'success');
        
        // Verify it's gone
        const verifyCheck = await registration.pushManager.getSubscription();
        console.log('[PUSH] Verification - subscription after disable:', verifyCheck ? 'still exists!' : 'successfully removed');
        
    } catch (error) {
        console.error('[PUSH] Error disabling:', error);
        showStatus('Failed to disable notifications', 'error');
    }
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
