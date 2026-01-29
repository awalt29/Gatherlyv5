#!/usr/bin/env python3
"""
Cron job script to send aggregated availability notifications.
Run every minute to check for users whose availability was updated more than 5 minutes ago.
"""

import os
import sys
from datetime import datetime, timedelta

# Add the app directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, send_push_notification
from models import User, Notification, Friendship

NOTIFICATION_DELAY_MINUTES = 15  # Wait 15 minutes after last update before sending

def send_pending_availability_notifications():
    """Send notifications for users whose availability was updated 5+ minutes ago"""
    
    with app.app_context():
        cutoff_time = datetime.utcnow() - timedelta(minutes=NOTIFICATION_DELAY_MINUTES)
        
        # Find users with pending notifications that are old enough
        pending_users = User.query.filter(
            User.availability_notification_pending == True,
            User.availability_updated_at <= cutoff_time
        ).all()
        
        if not pending_users:
            print(f"[AVAILABILITY NOTIFICATIONS] No pending notifications to send")
            return
        
        print(f"[AVAILABILITY NOTIFICATIONS] Found {len(pending_users)} users with pending notifications")
        
        for user in pending_users:
            print(f"[AVAILABILITY NOTIFICATIONS] Processing {user.name} (updated at {user.availability_updated_at})")
            
            # Find users who have this user in their notification_friend_ids
            all_watchers = User.query.filter(User.notification_friend_ids.isnot(None)).all()
            
            notifications_sent = 0
            for watcher in all_watchers:
                # Check if this user is in their notification list
                if watcher.notification_friend_ids and user.id in watcher.notification_friend_ids:
                    # Check if they're actually linked friends
                    if Friendship.are_friends(watcher.id, user.id):
                        # In-app notification
                        notification = Notification(
                            planner_id=watcher.id,
                            contact_id=None,
                            message=f"{user.name} added new availability",
                            from_user_id=user.id
                        )
                        db.session.add(notification)
                        
                        # Send push notification
                        send_push_notification(
                            watcher.id,
                            user.name,
                            'Added new availability 📅'
                        )
                        notifications_sent += 1
                        print(f"   -> Notified {watcher.name}")
            
            # Clear the pending flag
            user.availability_notification_pending = False
            print(f"   Total notifications sent: {notifications_sent}")
        
        db.session.commit()
        print(f"[AVAILABILITY NOTIFICATIONS] Done processing {len(pending_users)} users")

if __name__ == '__main__':
    send_pending_availability_notifications()

