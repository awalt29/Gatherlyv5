// Guest page state
let guestInfo = null;
let plannerInfo = null;
let planInfo = null;
let selectedTimeSlots = [];
let weekDays = []; // Store the 7 days of current week starting from today

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

// Generate calendar for the current week (today + next 6 days)
function generateCalendar() {
    const todayStr = getTodayString();
    console.log('📅 GUEST TODAY STRING:', todayStr);
    weekDays = [];
    
    // Generate 7 days starting from today
    for (let i = 0; i < 7; i++) {
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
        
        console.log(`📅 GUEST Day ${i}: ${date.toLocaleDateString('en-US', { weekday: 'short' })} ${month}/${day} → dateString: ${dateStr}`);
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
document.addEventListener('DOMContentLoaded', async () => {
    // Generate calendar first
    generateCalendar();
    
    await loadGuestInfo();
    setupCalendar();
    
    // Initialize submit button state
    updateSubmitButton();
});

// Load guest information
async function loadGuestInfo() {
    try {
        const response = await fetch(`/api/guest/${guestToken}`);
        const data = await response.json();
        
        guestInfo = data.contact;
        plannerInfo = data.planner;
        planInfo = data.plan;
        
        // Update UI - update legend with planner's first name
        const firstName = plannerInfo.name.split(' ')[0];
        document.getElementById('plannerLegend').textContent = 
            `${firstName}'s availability`;
        
        // Load planner's availability to show on calendar
        await loadPlannerAvailability();
        
        // Load existing availability if any
        if (data.existing_availability) {
            selectedTimeSlots = data.existing_availability.time_slots;
            renderSelectedSlots();
        }
        
        // Show main content
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
    } catch (error) {
        console.error('Error loading guest info:', error);
        document.getElementById('loadingState').innerHTML = 
            '<p style="color: #FF6464;">Error loading information. Please check your link.</p>';
    }
}

// Load planner's availability to display on guest calendar
async function loadPlannerAvailability() {
    try {
        const response = await fetch(`/api/availability/plan/${planInfo.id}`);
        const availabilities = await response.json();
        
        console.log('📅 GUEST received availabilities:', availabilities);
        
        // Find planner's availability (contact_id will be null for planner's own)
        const plannerAvail = availabilities.find(a => a.contact_id === null);
        
        if (plannerAvail) {
            console.log('📅 GUEST planner slots:', plannerAvail.time_slots);
            // Highlight planner's slots with a special class
            plannerAvail.time_slots.forEach(slot => {
                // Support both date and day for backwards compatibility
                const selector = slot.date 
                    ? `.time-slot[data-date="${slot.date}"][data-slot="${slot.slot}"]`
                    : `.time-slot[data-day="${slot.day}"][data-slot="${slot.slot}"]`;
                const element = document.querySelector(selector);
                if (element) {
                    element.classList.add('planner-available');
                }
            });
        }
    } catch (error) {
        console.error('Error loading planner availability:', error);
        // Non-fatal, continue without showing planner availability
    }
}

// Setup calendar interaction
function setupCalendar() {
    const slots = document.querySelectorAll('.time-slot');
    
    slots.forEach(slot => {
        slot.addEventListener('click', () => {
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
            
            // Update submit button based on selection
            updateSubmitButton();
        });
    });
}

// Update submit button text based on whether slots are selected
function updateSubmitButton() {
    const submitButton = document.getElementById('submitButton');
    
    if (selectedTimeSlots.length === 0) {
        submitButton.textContent = "I'm unavailable";
    } else {
        submitButton.textContent = 'Share Availability';
    }
}

// Render selected slots
function renderSelectedSlots() {
    selectedTimeSlots.forEach(slot => {
        // Support both date and day for backwards compatibility
        const selector = slot.date 
            ? `.time-slot[data-date="${slot.date}"][data-slot="${slot.slot}"]`
            : `.time-slot[data-day="${slot.day}"][data-slot="${slot.slot}"]`;
        const element = document.querySelector(selector);
        if (element) {
            element.classList.add('selected');
        }
    });
}

// Submit availability
async function submitAvailability() {
    const submitButton = document.getElementById('submitButton');
    const hasAvailability = selectedTimeSlots.length > 0;
    
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    
    try {
        const response = await fetch('/api/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: guestToken,
                time_slots: selectedTimeSlots
            })
        });
        
        if (response.ok) {
            if (hasAvailability) {
                showStatus('Thank you! Your availability has been shared.', 'success');
            } else {
                showStatus('Thank you for letting us know!', 'success');
            }
            submitButton.textContent = 'Submitted ✓';
            
            // Disable further editing after a delay
            setTimeout(() => {
                document.querySelectorAll('.time-slot').forEach(slot => {
                    slot.style.cursor = 'default';
                    slot.style.pointerEvents = 'none';
                });
                submitButton.style.pointerEvents = 'none';
            }, 2000);
        } else {
            showStatus('Error submitting availability. Please try again.', 'error');
            submitButton.disabled = false;
            updateSubmitButton();
        }
    } catch (error) {
        console.error('Error submitting availability:', error);
        showStatus('Error submitting availability. Please try again.', 'error');
        submitButton.disabled = false;
        updateSubmitButton();
    }
}

// Show status message
function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 10000);
    }
}

