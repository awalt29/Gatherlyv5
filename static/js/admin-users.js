// Load users
document.addEventListener('DOMContentLoaded', async () => {
    await loadUsers();
});

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        if (users.length === 0) {
            document.getElementById('usersTable').innerHTML = `
                <div class="empty-state">
                    <h3>No users yet</h3>
                    <p>Users will appear here once they sign up</p>
                </div>
            `;
            return;
        }
        
        const tableHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone Number</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => `
                        <tr id="user-${user.id}">
                            <td>${user.id}</td>
                            <td>${user.name}</td>
                            <td>${user.email || 'N/A'}</td>
                            <td>${user.phone_number}</td>
                            <td>${formatDate(user.created_at)}</td>
                            <td>
                                <button class="btn-delete" onclick="deleteUser(${user.id}, '${user.name}')">
                                    Delete
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('usersTable').innerHTML = tableHTML;
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTable').innerHTML = '<p>Error loading users</p>';
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function deleteUser(userId, userName) {
    if (!confirm(`Are you sure you want to delete user "${userName}"? This will also delete all their contacts, plans, and availability data. This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Remove the row from the table
            const row = document.getElementById(`user-${userId}`);
            if (row) {
                row.remove();
            }
            alert(`User "${userName}" has been deleted successfully.`);
            
            // Reload the table if no users left
            const table = document.querySelector('.data-table tbody');
            if (table && table.children.length === 0) {
                await loadUsers();
            }
        } else {
            const error = await response.json();
            alert(`Error deleting user: ${error.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('Error deleting user. Please try again.');
    }
}

