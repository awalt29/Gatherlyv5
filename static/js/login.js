document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('rememberMe').checked;
    const errorMessage = document.getElementById('errorMessage');
    
    // Hide previous errors
    errorMessage.style.display = 'none';
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, remember_me: rememberMe })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store user info
            localStorage.setItem('gatherly_user', JSON.stringify(data.user));
            // Redirect to main app
            window.location.href = '/';
        } else {
            errorMessage.textContent = data.error || 'Invalid email or password';
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.style.display = 'block';
    }
});

