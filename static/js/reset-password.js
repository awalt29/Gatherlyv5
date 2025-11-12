// Get token from URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

if (!token) {
    document.getElementById('errorMessage').textContent = 'Invalid reset link';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('resetPasswordForm').style.display = 'none';
}

// Reset Password Form Handler
document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');
    const submitBtn = document.getElementById('submitBtn');
    
    // Hide messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    // Validate passwords match
    if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }
    
    // Validate password length
    if (password.length < 6) {
        errorDiv.textContent = 'Password must be at least 6 characters';
        errorDiv.style.display = 'block';
        return;
    }
    
    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';
    
    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                token,
                password
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            successDiv.textContent = data.message + ' Redirecting to login...';
            successDiv.style.display = 'block';
            // Redirect to login after 2 seconds
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            errorDiv.textContent = data.error || 'Failed to reset password';
            errorDiv.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reset Password';
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password';
    }
});

