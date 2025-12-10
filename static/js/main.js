// Global state
let plannerInfo = null;
let selectedFriends = [];
let allFriends = [];
let selectedTimeSlots = [];
let currentPlanId = null;
let planningMode = 'setup'; // setup, selecting, planning, viewing
let weekDays = []; // Store the 7 days of current week starting from today
let lastNotificationCount = null; // Track notification count to detect new ones (null = not initialized)

// Get today's date as YYYY-MM-DD string (no timezone conversion)
function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    const tomorrowStr = addDaysToDateString(todayStr, 1); // Start from tomorrow
    console.log('📅 STARTING FROM:', tomorrowStr);
    weekDays = [];
    
    // Generate 7 days starting from tomorrow
    for (let i = 0; i < 7; i++) {
        const dateStr = addDaysToDateString(tomorrowStr, i);
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
                email: data.user.email
            };
            
            // Show the main content now that we're authenticated
            document.querySelector('.container').style.opacity = '1';
            document.getElementById('setupModal').classList.remove('active');
            // Load friends first (populates selectedFriends), then load availability
            await loadFriends();
            loadMyAvailability();
            loadFriendsAvailability();
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
            // Load friends first (populates selectedFriends), then load availability
            await loadFriends();
            loadMyAvailability();
            loadFriendsAvailability();
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
    friendsList.innerHTML = '';
    
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
        
        // Show linked badge for friends who are on the platform
        if (friend.is_linked) {
            avatar.classList.add('linked');
            const badge = document.createElement('span');
            badge.className = 'linked-badge';
            badge.textContent = '✓';
            avatar.appendChild(badge);
        } else if (friend.is_pending) {
            // Show pending badge for awaiting response
            avatar.classList.add('pending');
            const badge = document.createElement('span');
            badge.className = 'pending-badge';
            badge.textContent = '⏳';
            badge.title = 'Waiting for response';
            avatar.appendChild(badge);
        }
        
        friendsList.appendChild(avatar);
    });
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
        
        // Determine status badge
        let statusBadge = '';
        let showInviteBtn = false;
        if (friend.is_linked) {
            statusBadge = '<span class="friend-status linked">✓ Connected</span>';
        } else if (friend.is_pending) {
            statusBadge = '<span class="friend-status pending">⏳ Pending</span>';
        } else if (friend.invited_at) {
            statusBadge = '<span class="friend-status invited">✉ Invited</span>';
        } else {
            statusBadge = '<span class="friend-status not-on-app">Not on app</span>';
            showInviteBtn = true;
        }
        
        item.innerHTML = `
            <div class="friend-manage-drag-handle">☰</div>
            <div class="friend-manage-info">
                <div class="friend-manage-avatar">${displayMap[friend.id]}</div>
                <div class="friend-manage-details">
                    <div class="friend-manage-name">${friend.name}</div>
                    <div class="friend-manage-phone">${friend.phone_number}</div>
                    ${statusBadge ? `<div class="friend-manage-status">${statusBadge}</div>` : ''}
                </div>
            </div>
            <div class="friend-manage-actions">
                ${showInviteBtn ? '<button class="btn-invite">Invite</button>' : ''}
                <button class="btn-delete">Delete</button>
            </div>
        `;
        
        // Add delete handler
        const deleteBtn = item.querySelector('.btn-delete');
        deleteBtn.onclick = () => deleteFriend(friend.id);
        
        // Add invite handler if applicable
        if (showInviteBtn) {
            const inviteBtn = item.querySelector('.btn-invite');
            inviteBtn.onclick = () => sendInvite(friend.id, friend.name);
        }
        
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
            const data = await response.json();
            showStatus(`Invite sent to ${contactName}!`, 'success');
            
            // Update local friend data with invited_at
            const friendIndex = allFriends.findIndex(f => f.id === contactId);
            if (friendIndex !== -1 && data.contact) {
                allFriends[friendIndex] = data.contact;
            }
            
            // Re-render manage friends to hide invite button
            renderManageFriends();
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
    // Only require time slots to be selected (no longer need friends selected)
    const hasTimeSlots = selectedTimeSlots.length > 0;
    
    if (hasTimeSlots) {
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
                
                // Update the calendar display
                selectedTimeSlots.forEach(slot => {
                    const slotElement = document.querySelector(
                        `.time-slot[data-date="${slot.date}"][data-slot="${slot.slot}"]`
                    );
                    if (slotElement) {
                        slotElement.classList.add('selected');
                    }
                });
                
                // Update button state
                updatePlanButton();
                
                console.log('Loaded my availability:', selectedTimeSlots.length, 'slots');
            }
        }
    } catch (error) {
        console.error('Error loading my availability:', error);
    }
}

// Update the page title based on active status
function updateActiveStatus(isActive, daysRemaining) {
    const titleEl = document.getElementById('pageTitle');
    if (!titleEl) return;
    
    if (isActive && daysRemaining > 0) {
        let colorClass = 'green';  // 7, 6, 5 days
        let emoji = '🟢';
        
        if (daysRemaining <= 1) {
            colorClass = 'red';
            emoji = '🔴';
        } else if (daysRemaining <= 4) {
            colorClass = 'yellow';
            emoji = '🟡';
        }
        
        titleEl.innerHTML = `<span class="status-badge active ${colorClass}">${emoji} ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining</span>`;
    } else {
        titleEl.innerHTML = `<span class="status-badge inactive">⚪ Not active - save to unlock</span>`;
    }
}

// Save my availability (new flow)
async function saveMyAvailability() {
    if (selectedTimeSlots.length === 0) {
        showStatus('Please select at least one time slot', 'error');
        return;
    }
    
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
            updateActiveStatus(true, 7);  // Just saved = 7 days remaining
            loadFriendsAvailability();
            updatePlanButton();
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
            slotFriends[key].push({ name: avail.user_name, initials: getInitials(avail.user_name) });
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
                avatar.textContent = friend.initials;
                avatar.title = friend.name + ' is free';
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
            // Refresh friends list (updates status badges like pending -> connected)
            await loadFriends();
            // Refresh the calendar when new notifications arrive
            loadFriendsAvailability();
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
        
        // Render notifications with friend requests
        renderNotifications(notifications, friendRequests);
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
                    <div class="notification-avatar friend-request-avatar">👤</div>
                    <div class="notification-content">
                        <div class="notification-text">
                            <strong>${req.from_user_name}</strong> wants to be friends
                        </div>
                        <div class="notification-time">${timeAgo}</div>
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
        
        list.innerHTML = friendRequestsHtml + notificationsHtml;
    } catch (error) {
        console.error('Error rendering notifications:', error);
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
    
    // Load timezone and notification preferences
    await loadTimezone();
    await loadNotificationFriends();
    
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
