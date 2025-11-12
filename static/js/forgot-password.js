// Forgot Password Form Handler
document.getElementById('forgotPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');
    const submitBtn = document.getElementById('submitBtn');
    
    // Hide messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    
    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            successDiv.textContent = data.message;
            successDiv.style.display = 'block';
            // Clear the form
            document.getElementById('email').value = '';
        } else {
            errorDiv.textContent = data.error || 'Failed to send reset email';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.style.display = 'block';
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
    }
});

