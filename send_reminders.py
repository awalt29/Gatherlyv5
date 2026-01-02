#!/usr/bin/env python3
"""
Send weekly planning reminders to users via SMS
This script is run by Railway cron job on Sunday evenings (0 23 * * 0)
"""

import os
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
    """Send Sunday evening reminders to all users who have weekly reminders enabled"""
    with app.app_context():
        # Find all users
        users = User.query.all()
        print(f"📋 Found {len(users)} users")
        
        sent_count = 0
        
        for user in users:
            print(f"👤 {user.name}")
            
            # Check if user has weekly reminders enabled (default to True if not set)
            reminders_enabled = user.weekly_reminders_enabled if user.weekly_reminders_enabled is not None else True
            
            if not reminders_enabled:
                print(f"   ⏭️  Skipped (weekly reminders disabled)")
                continue
            
            # Send reminder to all users with reminders enabled
            base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
            message = f"Hi {user.name.split()[0]}! 👋 Share your availability for the week: {base_url}\n\nTo turn off these reminders, visit Settings in the app."
            
            if send_sms(user.phone_number, message):
                sent_count += 1
                print(f"   📱 ✅ Sent reminder to {user.name} ({user.phone_number})")
            else:
                print(f"   📱 ❌ Failed to send to {user.name}")
        
        print(f"\n✅ Sent {sent_count} reminder(s)")
        return sent_count

if __name__ == '__main__':
    print("🔔 Running reminder cron job...")
    send_reminders()
    print("✅ Reminder job complete")

