# Setting Up Weekly Availability Reminders on Railway

## Overview
The weekly reminder feature sends SMS reminders every Monday at 6pm asking users to share their availability for the week. When users save their availability, they become "active" and can see their linked friends' availability.

## Setup Instructions

### Option 1: Using Railway Dashboard (Recommended)

1. **Go to your Railway project dashboard**
   - Navigate to https://railway.app/project/[your-project-id]

2. **Create a new Cron Job service**
   - Click "+ New" in your project
   - Select "Empty Service"
   - Name it "reminder-cron"

3. **Configure the Cron Job**
   - Go to the service settings
   - Under "Variables", add all the same environment variables from your main service:
     - `DATABASE_URL` (should auto-reference from main service)
     - `TWILIO_ACCOUNT_SID`
     - `TWILIO_AUTH_TOKEN`
     - `TWILIO_PHONE_NUMBER`
     - `APP_BASE_URL`
   
4. **Set the Cron Schedule**
   - In the service settings, go to "Deployments"
   - Set the "Start Command" to: `python3 send_reminders.py`
   - Click on "Settings" > "Cron Schedule"
   - **The cron runs daily but only sends on Monday for each user's timezone**
   - Enter the cron expression: `0 22,23 * * *` (runs at 10 PM and 11 PM UTC to catch 6 PM EST/PST)
     - For 6 PM EST (Eastern): 11 PM UTC (during standard time)
     - For 6 PM PST (Pacific): 2 AM UTC next day (script handles timezone)

5. **Deploy the Cron Service**
   - The service should automatically deploy from your GitHub repo
   - Railway will run the cron job on the specified schedule

### Option 2: Using Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Create cron service
railway service create reminder-cron

# Set environment variables (reference from main service)
railway variables set DATABASE_URL=${{DATABASE_URL}}
railway variables set TWILIO_ACCOUNT_SID=${{TWILIO_ACCOUNT_SID}}
railway variables set TWILIO_AUTH_TOKEN=${{TWILIO_AUTH_TOKEN}}
railway variables set TWILIO_PHONE_NUMBER=${{TWILIO_PHONE_NUMBER}}
railway variables set APP_BASE_URL=${{APP_BASE_URL}}

# Deploy
railway up
```

## Cron Schedule Examples

- `0 9 * * *` - Daily at 9:00 AM UTC
- `0 9 * * 1-5` - Weekdays at 9:00 AM UTC
- `0 9 * * 1,3,5` - Monday, Wednesday, Friday at 9:00 AM UTC
- `0 9,17 * * *` - Daily at 9:00 AM and 5:00 PM UTC

## Testing the Cron Job

Test the reminder script locally:

```bash
# Activate virtual environment
source venv/bin/activate

# Run the reminder script
python3 send_reminders.py
```

## How It Works

1. The cron job runs multiple times daily to catch 6 PM in various timezones
2. For each user, it converts UTC to their local timezone
3. If it's Monday in the user's timezone AND they're inactive (haven't saved in 7+ days):
   - Sends an SMS reminder asking them to share availability
4. When users save their availability, they become "active" for 7 days
5. If they save again, their 7-day window resets from that day
6. Active users can see their linked friends' availability
7. Example message: "Hi John! 👋 Share your availability to see when your friends are free this week: https://trygatherly.com"

## Monitoring

- Check Railway logs for the cron service to see reminder sending activity
- Look for:
  - `✅ SMS sent to [phone]: [message_sid]`
  - `✅ Sent X reminder(s)`
- Any errors will be logged with `❌`

## Troubleshooting

**No reminders being sent?**
- Check that users have set reminder preferences in Settings
- Verify the cron schedule matches your desired time
- Check Railway logs for errors
- Ensure all environment variables are set correctly

**Wrong timezone?**
- Railway cron jobs run in UTC
- Convert your desired local time to UTC for the cron schedule
- Example: 9 AM PST = 5 PM UTC (during standard time)

