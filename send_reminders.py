#!/usr/bin/env python3
"""
Send weekly planning reminders to users via SMS
This script is run by Railway cron jobs:
- Sunday evening (0 23 * * 0): General weekly reminder
- Wednesday evening (0 23 * * 3): Weekend planning reminder with friend count
"""

import os
import sys
from datetime import date
from dotenv import load_dotenv
from models import db, User, Friendship, UserAvailability
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

def get_friends_with_availability(user_id):
    """Count how many friends have future availability"""
    today_str = date.today().isoformat()
    
    # Get all friendships
    friendships = Friendship.query.filter(
        (Friendship.user_id_1 == user_id) | (Friendship.user_id_2 == user_id)
    ).all()
    
    count = 0
    for f in friendships:
        friend_id = f.user_id_2 if f.user_id_1 == user_id else f.user_id_1
        
        # Check if friend has future availability
        avail = UserAvailability.query.filter_by(user_id=friend_id).order_by(UserAvailability.updated_at.desc()).first()
        if avail and avail.time_slots:
            future_slots = [s for s in avail.time_slots if s.get('date', '') >= today_str]
            if len(future_slots) > 0:
                count += 1
    
    return count

def send_sunday_reminders():
    """Send Sunday evening reminders to all users who have weekly reminders enabled"""
    with app.app_context():
        users = User.query.all()
        print(f"📋 Found {len(users)} users")
        
        sent_count = 0
        
        for user in users:
            print(f"👤 {user.name}")
            
            reminders_enabled = user.weekly_reminders_enabled if user.weekly_reminders_enabled is not None else True
            
            if not reminders_enabled:
                print(f"   ⏭️  Skipped (weekly reminders disabled)")
                continue
            
            base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
            message = f"Hi {user.name.split()[0]}! 👋 Share your availability for the week: {base_url}\n\nTo turn off these reminders, visit Settings in the app."
            
            if send_sms(user.phone_number, message):
                sent_count += 1
                print(f"   📱 ✅ Sent reminder")
            else:
                print(f"   📱 ❌ Failed to send")
        
        print(f"\n✅ Sent {sent_count} Sunday reminder(s)")
        return sent_count

def send_wednesday_reminders():
    """Send Wednesday evening reminders with friend availability count"""
    with app.app_context():
        users = User.query.all()
        print(f"📋 Found {len(users)} users")
        
        sent_count = 0
        
        for user in users:
            print(f"👤 {user.name}")
            
            reminders_enabled = user.weekly_reminders_enabled if user.weekly_reminders_enabled is not None else True
            
            if not reminders_enabled:
                print(f"   ⏭️  Skipped (weekly reminders disabled)")
                continue
            
            # Check if user has added their own availability
            today_str = date.today().isoformat()
            user_avail = UserAvailability.query.filter_by(user_id=user.id).order_by(UserAvailability.updated_at.desc()).first()
            has_own_availability = False
            if user_avail and user_avail.time_slots:
                future_slots = [s for s in user_avail.time_slots if s.get('date', '') >= today_str]
                has_own_availability = len(future_slots) > 0
            
            if not has_own_availability:
                print(f"   ⏭️  Skipped (user hasn't added availability)")
                continue
            
            # Count friends with availability
            friends_with_avail = get_friends_with_availability(user.id)
            
            # Only send if friends have availability
            if friends_with_avail == 0:
                print(f"   ⏭️  Skipped (no friends with availability)")
                continue
            
            base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
            
            friend_text = f"{friends_with_avail} {'friend has' if friends_with_avail == 1 else 'friends have'}"
            message = f"Time to plan your weekend! 🎉\n\n{friend_text} shared their availability.\n\nSee when everyone's free: {base_url}"
            
            if send_sms(user.phone_number, message):
                sent_count += 1
                print(f"   📱 ✅ Sent reminder ({friends_with_avail} friends with availability)")
            else:
                print(f"   📱 ❌ Failed to send")
        
        print(f"\n✅ Sent {sent_count} Wednesday reminder(s)")
        return sent_count

if __name__ == '__main__':
    # Check command line argument for which type of reminder to send
    reminder_type = sys.argv[1] if len(sys.argv) > 1 else 'sunday'
    
    print(f"🔔 Running {reminder_type} reminder cron job...")
    
    if reminder_type == 'wednesday':
        send_wednesday_reminders()
    else:
        send_sunday_reminders()
    
    print("✅ Reminder job complete")
