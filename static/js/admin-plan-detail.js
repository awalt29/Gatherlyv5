// Load plan details
document.addEventListener('DOMContentLoaded', async () => {
    await loadPlanDetails();
});

async function loadPlanDetails() {
    try {
        const response = await fetch(`/api/admin/plans/${planId}/details`);
        const data = await response.json();
        
        const { plan, planner, guests, availabilities } = data;
        
        // Build calendar visualization
        const calendarHTML = buildCalendar(availabilities);
        
        const detailHTML = `
            <div class="content-card">
                <h2 class="card-title">Plan Information</h2>
                <table class="data-table">
                    <tr>
                        <td><strong>Plan ID</strong></td>
                        <td>${plan.id}</td>
                    </tr>
                    <tr>
                        <td><strong>Planner</strong></td>
                        <td>${planner.name} (${planner.phone_number})</td>
                    </tr>
                    <tr>
                        <td><strong>Week</strong></td>
                        <td>${formatDate(plan.week_start_date)}</td>
                    </tr>
                    <tr>
                        <td><strong>Status</strong></td>
                        <td><span class="badge ${plan.status}">${plan.status}</span></td>
                    </tr>
                    <tr>
                        <td><strong>Created</strong></td>
                        <td>${formatDateTime(plan.created_at)}</td>
                    </tr>
                </table>
            </div>
            
            <div class="content-card">
                <h2 class="card-title">Invited Guests (${guests.length})</h2>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Responded</th>
                            <th>Notified</th>
                            <th>Link Token</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${guests.map(guest => `
                            <tr>
                                <td>${guest.contact_name}</td>
                                <td>${guest.contact_phone}</td>
                                <td><span class="badge ${guest.has_responded ? 'yes' : 'no'}">${guest.has_responded ? 'Yes' : 'No'}</span></td>
                                <td>${guest.notified_at ? formatDateTime(guest.notified_at) : 'Not sent'}</td>
                                <td><code>${guest.unique_token.substring(0, 20)}...</code></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="content-card">
                <h2 class="card-title">Combined Availability</h2>
                ${calendarHTML}
                
                <div class="user-legend">
                    ${availabilities.map(avail => `
                        <div class="user-legend-item">
                            <div class="user-color-box"></div>
                            <span>${avail.user_name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="content-card">
                <h2 class="card-title">Individual Availability Submissions</h2>
                ${availabilities.length > 0 ? `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Submitted</th>
                                <th>Time Slots</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${availabilities.map(avail => `
                                <tr>
                                    <td>${avail.user_name}</td>
                                    <td>${formatDateTime(avail.submitted_at)}</td>
                                    <td>${formatTimeSlots(avail.time_slots)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="empty-state">No availability submitted yet</p>'}
            </div>
        `;
        
        document.getElementById('planContent').innerHTML = detailHTML;
    } catch (error) {
        console.error('Error loading plan details:', error);
        document.getElementById('planContent').innerHTML = '<p>Error loading plan details</p>';
    }
}

function buildCalendar(availabilities) {
    // Count users per slot
    const slotCounts = {};
    
    availabilities.forEach(avail => {
        avail.time_slots.forEach(slot => {
            const key = `${slot.day}-${slot.slot}`;
            slotCounts[key] = (slotCounts[key] || 0) + 1;
        });
    });
    
    const timeSlots = ['morning', 'afternoon', 'evening'];
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    
    let html = '<div class="calendar-display">';
    
    // Header
    html += '<div class="calendar-header">';
    html += '<div></div>';
    days.forEach(day => {
        html += `<div class="calendar-day">${day}</div>`;
    });
    html += '</div>';
    
    // Body
    html += '<div class="calendar-body">';
    
    timeSlots.forEach(slot => {
        html += `<div class="time-label">${slot.toUpperCase()}</div>`;
        
        for (let day = 0; day < 7; day++) {
            const key = `${day}-${slot}`;
            const count = slotCounts[key] || 0;
            
            html += `<div class="calendar-cell ${count > 0 ? 'has-availability' : ''}">`;
            if (count > 0) {
                html += `<span class="user-count">${count}</span>`;
            }
            html += '</div>';
        }
    });
    
    html += '</div></div>';
    
    return html;
}

function formatTimeSlots(slots) {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return slots.map(slot => {
        return `${dayNames[slot.day]} ${slot.slot}`;
    }).join(', ');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

