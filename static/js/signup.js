document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorMessage = document.getElementById('errorMessage');
    
    // Hide previous errors
    errorMessage.style.display = 'none';
    
    // Validate passwords match
    if (password !== confirmPassword) {
        errorMessage.textContent = 'Passwords do not match';
        errorMessage.style.display = 'block';
        return;
    }
    
    // Validate password length
    if (password.length < 6) {
        errorMessage.textContent = 'Password must be at least 6 characters';
        errorMessage.style.display = 'block';
        return;
    }
    
    // Auto-detect timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    try {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `${firstName} ${lastName}`,
                email,
                phone_number: phone,
                password,
                timezone
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store user info
            localStorage.setItem('gatherly_user', JSON.stringify(data.user));
            // Redirect to main app
            window.location.href = '/';
        } else {
            errorMessage.textContent = data.error || 'Signup failed. Please try again.';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Signup error:', error);
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.style.display = 'block';
    }
});

