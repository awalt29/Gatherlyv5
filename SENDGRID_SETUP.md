# SendGrid Setup for Password Reset

The password reset feature uses SendGrid to send emails. Follow these steps to configure it:

## 1. Get SendGrid API Key

1. Go to [SendGrid](https://sendgrid.com/) and sign in (or create a free account)
2. Navigate to **Settings** → **API Keys**
3. Click **Create API Key**
4. Name it "Gatherly Password Reset"
5. Select **Restricted Access**
6. Under **Mail Send**, toggle **Mail Send** to **Full Access**
7. Click **Create & View**
8. **Copy the API key** (you won't be able to see it again!)

## 2. Verify Sender Email

1. In SendGrid, go to **Settings** → **Sender Authentication**
2. Click **Verify a Single Sender**
3. Fill in your information (use your real email)
4. Check your email and click the verification link
5. Once verified, use this email as your `SENDGRID_FROM_EMAIL`

## 3. Add Environment Variables to Railway

Add these to your Railway project:

```bash
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=your-verified-email@example.com
```

## 4. Create Database Table

In Railway's PostgreSQL database → Data tab → Query, run:

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

1. User clicks "Forgot?" on login page
2. Enters their email address
3. Receives an email with a reset link (expires in 1 hour)
4. Clicks the link and enters a new password
5. Password is reset and they can log in

## Testing Locally

1. Add the environment variables to your `.env` file:
   ```
   SENDGRID_API_KEY=your-key
   SENDGRID_FROM_EMAIL=your-verified-email@example.com
   ```

2. Run the local database migration:
   ```bash
   python add_password_resets_table.py
   ```

## SendGrid Free Tier

- **100 emails/day** for free
- More than enough for password resets
- Can upgrade if needed

## Troubleshooting

If emails aren't sending:
1. Check that your API key has Mail Send permissions
2. Verify your sender email is verified in SendGrid
3. Check Railway logs for any SendGrid errors
4. Make sure `SENDGRID_FROM_EMAIL` matches your verified sender

