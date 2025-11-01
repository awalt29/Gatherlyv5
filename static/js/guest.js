// Guest page state
let guestInfo = null;
let plannerInfo = null;
let planInfo = null;
let selectedTimeSlots = [];
let weekDays = []; // Store the 7 days of current week starting from today

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
document.addEventListener('DOMContentLoaded', async () => {
    // Generate calendar first
    generateCalendar();
    
    await loadGuestInfo();
    setupCalendar();
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
        
        // Find planner's availability (contact_id will be null for planner's own)
        const plannerAvail = availabilities.find(a => a.contact_id === null);
        
        if (plannerAvail) {
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
        });
    });
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
    if (selectedTimeSlots.length === 0) {
        showStatus('Please select at least one time slot', 'error');
        return;
    }
    
    const submitButton = document.getElementById('submitButton');
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
            showStatus('Thank you! Your availability has been shared.', 'success');
            submitButton.textContent = 'Submitted ✓';
            
            // Disable further editing after a delay
            setTimeout(() => {
                document.querySelectorAll('.time-slot').forEach(slot => {
                    slot.style.cursor = 'default';
                    slot.style.pointerEvents = 'none';
                });
            }, 2000);
        } else {
            showStatus('Error submitting availability. Please try again.', 'error');
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Availability';
        }
    } catch (error) {
        console.error('Error submitting availability:', error);
        showStatus('Error submitting availability. Please try again.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Availability';
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

