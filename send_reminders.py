#!/usr/bin/env python3
"""
Send weekly planning reminders to users via push notifications
This script is run by Railway cron jobs:
- Sunday evening (0 23 * * 0): General weekly reminder
- Wednesday evening (0 23 * * 3): Weekend planning reminder with friend count
"""

import os
import sys
import json
from datetime import date
from dotenv import load_dotenv
from models import db, User, Friendship, UserAvailability, PushSubscription
from flask import Flask

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

# VAPID setup for push notifications
VAPID_PUBLIC_KEY = os.getenv('VAPID_PUBLIC_KEY')
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY')
VAPID_EMAIL = os.getenv('VAPID_EMAIL', 'hello@trygatherly.com')


def send_push_notification(user_id, title, body, url=None):
    """Send push notification to all subscriptions for a user"""
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        print(f"   ⚠️  VAPID keys not configured")
        return False
    
    try:
        from pywebpush import webpush
    except ImportError:
        print(f"   ⚠️  pywebpush not installed")
        return False
    
    subscriptions = PushSubscription.query.filter_by(user_id=user_id).all()
    if not subscriptions:
        print(f"   ⚠️  No push subscriptions")
        return False
    
    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url or '/'
    })
    
    vapid_claims = {
        'sub': f'mailto:{VAPID_EMAIL}'
    }
    
    success_count = 0
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {
                        'p256dh': sub.p256dh_key,
                        'auth': sub.auth_key
                    }
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=vapid_claims
            )
            success_count += 1
        except Exception as e:
            error_msg = str(e)
            # Remove invalid subscriptions (410 Gone or 404 Not Found)
            if '410' in error_msg or '404' in error_msg:
                db.session.delete(sub)
                db.session.commit()
    
    return success_count > 0


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
            
            if send_push_notification(
                user.id,
                "Time to plan your week! 📅",
                "Share your availability so friends know when you're free.",
                "/"
            ):
                sent_count += 1
                print(f"   🔔 ✅ Sent push reminder")
            else:
                print(f"   🔔 ❌ Failed to send (no subscription)")
        
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
            
            # Count friends with availability
            friends_with_avail = get_friends_with_availability(user.id)
            
            # Only send if friends have availability
            if friends_with_avail == 0:
                print(f"   ⏭️  Skipped (no friends with availability)")
                continue
            
            friend_text = f"{friends_with_avail} {'friend has' if friends_with_avail == 1 else 'friends have'}"
            
            if send_push_notification(
                user.id,
                "Time to plan your weekend! 🎉",
                f"{friend_text} shared their availability!",
                "/"
            ):
                sent_count += 1
                print(f"   🔔 ✅ Sent push reminder ({friends_with_avail} friends with availability)")
            else:
                print(f"   🔔 ❌ Failed to send (no subscription)")
        
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
