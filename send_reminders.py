#!/usr/bin/env python3
"""
Send weekly planning reminders to users via SMS on Sunday evening
This script is run by Railway cron job
Schedule: Run at 11 PM UTC Sunday (6 PM EST) and 2 AM UTC Monday (6 PM PST)
"""

import os
from datetime import datetime
import pytz
from dotenv import load_dotenv
from models import db, User
from flask import Flask
from twilio.rest import Client

load_dotenv()

# Create Flask app for database access
app = Flask(__name__)

# Fix Railway's DATABASE_URL (postgres:// -> postgresql://)
database_url = os.getenv('DATABASE_URL', 'sqlite:///instance/gatherly.db')
if database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Twilio setup
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')
APP_BASE_URL = os.getenv('APP_BASE_URL', 'https://trygatherly.com')

def send_sms(to_number, message):
    """Send SMS via Twilio"""
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]):
        print("⚠️  Twilio credentials not configured")
        return False
    
    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        message = client.messages.create(
            body=message,
            from_=TWILIO_PHONE_NUMBER,
            to=to_number
        )
        print(f"✅ SMS sent to {to_number}: {message.sid}")
        return True
    except Exception as e:
        print(f"❌ Error sending SMS to {to_number}: {e}")
        return False

def send_reminders():
    """Send reminders to users who are no longer active (haven't saved availability in 7 days)"""
    with app.app_context():
        # Get current UTC time
        utc_now = datetime.now(pytz.UTC)
        today = utc_now.date()
        print(f"🌍 Current UTC time: {utc_now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        
        # Find all users
        users = User.query.all()
        
        sent_count = 0
        
        for user in users:
            # Get user's timezone (default to America/New_York if not set)
            user_tz = pytz.timezone(user.timezone or 'America/New_York')
            
            # Convert current time to user's timezone
            user_time = utc_now.astimezone(user_tz)
            today_for_user = user_time.strftime('%A').lower()
            
            print(f"👤 {user.name}: {user_time.strftime('%Y-%m-%d %H:%M:%S %Z')} ({today_for_user})")
            
            # Check if user has weekly reminders enabled (default to True if not set)
            reminders_enabled = user.weekly_reminders_enabled if user.weekly_reminders_enabled is not None else True
            
            if not reminders_enabled:
                print(f"   ⏭️  Skipped (weekly reminders disabled)")
                continue
            
            # Send reminders on Sunday evening only
            if today_for_user == 'sunday':
                # Check if user is no longer active (hasn't saved in 7+ days)
                is_inactive = True
                if user.weekly_availability_date:
                    days_since_save = (today - user.weekly_availability_date).days
                    is_inactive = days_since_save >= 7
                    print(f"   📅 Last saved {days_since_save} days ago")
                
                if is_inactive:
                    # Send reminder to inactive users
                    base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
                    message = f"Hi {user.name.split()[0]}! 👋 Share your availability for the week ahead: {base_url}"
                    
                    if send_sms(user.phone_number, message):
                        sent_count += 1
                        print(f"   📱 ✅ Sent reminder to {user.name} ({user.phone_number})")
                    else:
                        print(f"   📱 ❌ Failed to send to {user.name}")
                else:
                    print(f"   ✅ Still active, no reminder needed")
            else:
                print(f"   ⏭️  Skipped (not Sunday for this user, it's {today_for_user})")
        
        print(f"\n✅ Sent {sent_count} reminder(s)")
        return sent_count

if __name__ == '__main__':
    print("🔔 Running reminder cron job...")
    send_reminders()
    print("✅ Reminder job complete")

