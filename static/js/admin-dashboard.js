// Load dashboard data
document.addEventListener('DOMContentLoaded', async () => {
    await loadStats();
    await loadRecentPlans();
});

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats');
        const stats = await response.json();
        
        document.getElementById('totalUsers').textContent = stats.total_users;
        document.getElementById('totalPlans').textContent = stats.total_plans;
        document.getElementById('activePlans').textContent = stats.active_plans;
        document.getElementById('responseRate').textContent = stats.response_rate + '%';
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load recent plans
async function loadRecentPlans() {
    try {
        const response = await fetch('/api/plans');
        const plans = await response.json();
        
        const recentPlans = plans.slice(0, 10);
        
        if (recentPlans.length === 0) {
            document.getElementById('recentPlans').innerHTML = `
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
                        <th>Week</th>
                        <th>Status</th>
                        <th>Guests</th>
                        <th>Responses</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentPlans.map(plan => `
                        <tr>
                            <td>${plan.id}</td>
                            <td>${plan.planner_name}</td>
                            <td>${formatDate(plan.week_start_date)}</td>
                            <td><span class="badge ${plan.status}">${plan.status}</span></td>
                            <td>${plan.total_guests}</td>
                            <td>${plan.responded_guests} / ${plan.total_guests}</td>
                            <td>${formatDate(plan.created_at)}</td>
                            <td><a href="/admin/plans/${plan.id}">View</a></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('recentPlans').innerHTML = tableHTML;
    } catch (error) {
        console.error('Error loading plans:', error);
        document.getElementById('recentPlans').innerHTML = '<p>Error loading plans</p>';
    }
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

