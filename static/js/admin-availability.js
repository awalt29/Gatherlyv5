// Load availability records
document.addEventListener('DOMContentLoaded', async () => {
    await loadAvailability();
});

async function loadAvailability() {
    try {
        const response = await fetch('/api/admin/availability');
        const availabilities = await response.json();
        
        if (availabilities.length === 0) {
            document.getElementById('availabilityTable').innerHTML = `
                <div class="empty-state">
                    <h3>No availability records yet</h3>
                    <p>Availability submissions will appear here</p>
                </div>
            `;
            return;
        }
        
        const tableHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>User</th>
                        <th>Planner ID</th>
                        <th>Week Start</th>
                        <th>Time Slots</th>
                        <th>Submitted</th>
                        <th>Last Updated</th>
                    </tr>
                </thead>
                <tbody>
                    ${availabilities.map(avail => `
                        <tr>
                            <td>${avail.id}</td>
                            <td>${avail.user_name}</td>
                            <td>${avail.planner_id}</td>
                            <td>${formatDate(avail.week_start_date)}</td>
                            <td>${avail.time_slots.length} slots</td>
                            <td>${formatDateTime(avail.submitted_at)}</td>
                            <td>${formatDateTime(avail.updated_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('availabilityTable').innerHTML = tableHTML;
    } catch (error) {
        console.error('Error loading availability:', error);
        document.getElementById('availabilityTable').innerHTML = '<p>Error loading availability records</p>';
    }
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

