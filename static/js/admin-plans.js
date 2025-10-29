// Load plans
document.addEventListener('DOMContentLoaded', async () => {
    await loadPlans();
});

async function loadPlans() {
    try {
        const response = await fetch('/api/plans');
        const plans = await response.json();
        
        if (plans.length === 0) {
            document.getElementById('plansTable').innerHTML = `
                <div class="empty-state">
                    <h3>No plans yet</h3>
                    <p>Plans will appear here once created</p>
                </div>
            `;
            return;
        }
        
        const tableHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Planner</th>
                        <th>Week Start</th>
                        <th>Status</th>
                        <th>Total Guests</th>
                        <th>Responses</th>
                        <th>Response Rate</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${plans.map(plan => {
                        const responseRate = plan.total_guests > 0 
                            ? Math.round((plan.responded_guests / plan.total_guests) * 100)
                            : 0;
                        
                        return `
                            <tr>
                                <td>${plan.id}</td>
                                <td>${plan.planner_name}</td>
                                <td>${formatDate(plan.week_start_date)}</td>
                                <td><span class="badge ${plan.status}">${plan.status}</span></td>
                                <td>${plan.total_guests}</td>
                                <td>${plan.responded_guests}</td>
                                <td>${responseRate}%</td>
                                <td>${formatDateTime(plan.created_at)}</td>
                                <td><a href="/admin/plans/${plan.id}">View Details</a></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('plansTable').innerHTML = tableHTML;
    } catch (error) {
        console.error('Error loading plans:', error);
        document.getElementById('plansTable').innerHTML = '<p>Error loading plans</p>';
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

