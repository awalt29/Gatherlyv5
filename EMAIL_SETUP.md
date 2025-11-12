# Email Setup for Password Reset

The password reset feature requires email configuration. Add these environment variables to Railway:

## Required Environment Variables

```bash
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password
MAIL_DEFAULT_SENDER=your-email@gmail.com
```

## Gmail Setup

1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Navigate to **Security** → **2-Step Verification** (enable if not already)
3. Go to **Security** → **App passwords**
4. Create a new app password for "Mail"
5. Use this app password (not your regular Gmail password) for `MAIL_PASSWORD`

## Other Email Providers

### Outlook/Office 365
```bash
MAIL_SERVER=smtp.office365.com
MAIL_PORT=587
```

### SendGrid
```bash
MAIL_SERVER=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USERNAME=apikey
MAIL_PASSWORD=your-sendgrid-api-key
```

## Database Migration

After deploying, run this command in Railway to create the `password_resets` table:

1. Go to your Railway project
2. Click on your PostgreSQL database service
3. Go to the "Data" tab
4. Click "Query"
5. Run:

```sql
CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    email VARCHAR(120) NOT NULL,
    reset_token VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);
```

## How It Works

1. User clicks "Forgot?" link on login page
2. Enters their email address
3. Receives an email with a reset link (expires in 1 hour)
4. Clicks the link and enters a new password
5. Password is reset and they can log in with the new password

