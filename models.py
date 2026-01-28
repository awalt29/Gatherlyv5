from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import re

db = SQLAlchemy()

def normalize_phone(phone):
    """Normalize phone number by removing all non-digit characters"""
    if not phone:
        return phone
    digits = re.sub(r'\D', '', phone)
    if len(digits) == 10:
        digits = '1' + digits
    return '+' + digits

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone_number = db.Column(db.String(20), nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    reminder_days = db.Column(db.JSON, default=lambda: ["monday", "tuesday", "wednesday", "thursday"])  # Legacy - kept for compatibility
    notification_friend_ids = db.Column(db.JSON, default=list)  # List of friend user IDs to notify about availability updates
    weekly_reminders_enabled = db.Column(db.Boolean, default=True)  # Whether to receive Sunday evening reminders
    has_seen_install_prompt = db.Column(db.Boolean, default=False)  # Whether user has seen the "Add to Home Screen" prompt
    timezone = db.Column(db.String(50), default='America/New_York')  # User's timezone
    weekly_availability_date = db.Column(db.Date)  # Date of the Monday when user submitted availability this week
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    plans_created = db.relationship('Plan', backref='planner', lazy=True, foreign_keys='Plan.planner_id')
    contacts = db.relationship('Contact', backref='owner', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def is_active(self):
        """Check if user has saved availability within the last 7 days"""
        if not self.weekly_availability_date:
            return False
        today = datetime.utcnow().date()
        # User is active if they saved within the last 7 days
        return (today - self.weekly_availability_date).days < 7
    
    # Keep old method name for backwards compatibility
    def is_active_this_week(self):
        return self.is_active()
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'phone_number': self.phone_number,
            'timezone': self.timezone,
            'is_active_this_week': self.is_active_this_week(),
            'weekly_reminders_enabled': self.weekly_reminders_enabled if self.weekly_reminders_enabled is not None else True,
            'has_seen_install_prompt': self.has_seen_install_prompt if self.has_seen_install_prompt is not None else False,
            'created_at': self.created_at.isoformat()
        }


class Contact(db.Model):
    __tablename__ = 'contacts'
    
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone_number = db.Column(db.String(20), nullable=False)
    display_order = db.Column(db.Integer, default=0)  # Order for displaying contacts
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # A user can't have duplicate contacts
    __table_args__ = (
        db.UniqueConstraint('owner_id', 'phone_number', name='unique_contact_per_user'),
    )
    
    # Relationships
    plan_guests = db.relationship('PlanGuest', backref='contact', lazy=True)
    availabilities = db.relationship('Availability', backref='contact', lazy=True)
    
    def to_dict(self):
        # Check if this contact is a linked friend (mutual connection) or has pending request
        is_linked = False
        is_pending = False
        linked_user_id = None
        
        # Find if contact's phone number belongs to a registered user (with normalized matching)
        linked_user = None
        normalized = normalize_phone(self.phone_number)
        
        # Try exact match first, then normalized
        linked_user = User.query.filter_by(phone_number=self.phone_number).first()
        if not linked_user:
            linked_user = User.query.filter_by(phone_number=normalized).first()
        if not linked_user:
            # Try matching last 10 digits
            digits = re.sub(r'\D', '', self.phone_number) if self.phone_number else ''
            if len(digits) >= 10:
                last_10 = digits[-10:]
                for u in User.query.all():
                    if not u.phone_number:
                        continue
                    u_digits = re.sub(r'\D', '', u.phone_number)
                    if len(u_digits) >= 10 and u_digits[-10:] == last_10:
                        linked_user = u
                        break
        if linked_user and linked_user.id != self.owner_id:
            # Check if there's an accepted friendship
            friendship = Friendship.query.filter(
                ((Friendship.user_id_1 == self.owner_id) & (Friendship.user_id_2 == linked_user.id)) |
                ((Friendship.user_id_1 == linked_user.id) & (Friendship.user_id_2 == self.owner_id))
            ).first()
            if friendship:
                is_linked = True
                linked_user_id = linked_user.id
            else:
                # Check if there's a pending friend request
                pending_request = FriendRequest.query.filter(
                    ((FriendRequest.from_user_id == self.owner_id) & (FriendRequest.to_user_id == linked_user.id)) |
                    ((FriendRequest.from_user_id == linked_user.id) & (FriendRequest.to_user_id == self.owner_id))
                ).filter(FriendRequest.status == 'pending').first()
                if pending_request:
                    is_pending = True
                    linked_user_id = linked_user.id
        
        return {
            'id': self.id,
            'owner_id': self.owner_id,
            'name': self.name,
            'phone_number': self.phone_number,
            'display_order': self.display_order,
            'is_linked': is_linked,
            'is_pending': is_pending,
            'linked_user_id': linked_user_id,
            'created_at': self.created_at.isoformat()
        }


class FriendRequest(db.Model):
    """Pending friend requests between users"""
    __tablename__ = 'friend_requests'
    
    id = db.Column(db.Integer, primary_key=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    to_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, accepted, rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    responded_at = db.Column(db.DateTime)
    
    # Prevent duplicate requests
    __table_args__ = (
        db.UniqueConstraint('from_user_id', 'to_user_id', name='unique_friend_request'),
    )
    
    # Relationships
    from_user = db.relationship('User', foreign_keys=[from_user_id], backref='sent_friend_requests')
    to_user = db.relationship('User', foreign_keys=[to_user_id], backref='received_friend_requests')
    
    def to_dict(self):
        return {
            'id': self.id,
            'from_user_id': self.from_user_id,
            'from_user_name': self.from_user.name,
            'to_user_id': self.to_user_id,
            'to_user_name': self.to_user.name,
            'status': self.status,
            'created_at': self.created_at.isoformat() + 'Z'
        }


class Friendship(db.Model):
    """Mutual friendships between users (accepted friend requests)"""
    __tablename__ = 'friendships'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id_1 = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # Always the lower ID
    user_id_2 = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # Always the higher ID
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Prevent duplicate friendships
    __table_args__ = (
        db.UniqueConstraint('user_id_1', 'user_id_2', name='unique_friendship'),
    )
    
    # Relationships
    user_1 = db.relationship('User', foreign_keys=[user_id_1])
    user_2 = db.relationship('User', foreign_keys=[user_id_2])
    
    @staticmethod
    def create_friendship(user_a_id, user_b_id):
        """Create friendship ensuring user_id_1 < user_id_2 to prevent duplicates"""
        lower_id = min(user_a_id, user_b_id)
        higher_id = max(user_a_id, user_b_id)
        return Friendship(user_id_1=lower_id, user_id_2=higher_id)
    
    @staticmethod
    def are_friends(user_a_id, user_b_id):
        """Check if two users are friends"""
        lower_id = min(user_a_id, user_b_id)
        higher_id = max(user_a_id, user_b_id)
        return Friendship.query.filter_by(user_id_1=lower_id, user_id_2=higher_id).first() is not None
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id_1': self.user_id_1,
            'user_id_2': self.user_id_2,
            'user_1_name': self.user_1.name,
            'user_2_name': self.user_2.name,
            'created_at': self.created_at.isoformat()
        }


class Plan(db.Model):
    __tablename__ = 'plans'
    
    id = db.Column(db.Integer, primary_key=True)
    planner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    week_start_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), default='draft')  # draft, active, completed, cancelled
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    guests = db.relationship('PlanGuest', backref='plan', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'planner_id': self.planner_id,
            'planner_name': self.planner.name,
            'week_start_date': self.week_start_date.isoformat(),
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'total_guests': len(self.guests),
            'responded_guests': len([g for g in self.guests if g.has_responded])
        }


class PlanGuest(db.Model):
    __tablename__ = 'plan_guests'
    
    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'), nullable=False)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=False)
    unique_token = db.Column(db.String(64), unique=True, nullable=False, default=lambda: secrets.token_urlsafe(32))
    has_responded = db.Column(db.Boolean, default=False)
    notified_at = db.Column(db.DateTime)
    link_clicked_at = db.Column(db.DateTime)  # Track when guest first clicked the link
    
    def to_dict(self):
        return {
            'id': self.id,
            'plan_id': self.plan_id,
            'contact_id': self.contact_id,
            'contact_name': self.contact.name,
            'contact_phone': self.contact.phone_number,
            'unique_token': self.unique_token,
            'has_responded': self.has_responded,
            'notified_at': self.notified_at.isoformat() if self.notified_at else None,
            'link_clicked_at': self.link_clicked_at.isoformat() if self.link_clicked_at else None
        }


class Availability(db.Model):
    """Legacy availability model - kept for backwards compatibility"""
    __tablename__ = 'availability'
    
    id = db.Column(db.Integer, primary_key=True)
    week_start_date = db.Column(db.Date, nullable=False)
    planner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=True)
    time_slots = db.Column(db.JSON, nullable=False)
    message = db.Column(db.String(200))
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        db.UniqueConstraint('week_start_date', 'planner_id', 'contact_id', name='unique_availability_per_week'),
    )
    
    def to_dict(self):
        if self.contact_id:
            name = self.contact.name
        else:
            planner = User.query.get(self.planner_id)
            name = planner.name
        
        return {
            'id': self.id,
            'week_start_date': self.week_start_date.isoformat(),
            'planner_id': self.planner_id,
            'contact_id': self.contact_id,
            'contact_name': name,
            'user_name': name,
            'time_slots': self.time_slots,
            'message': self.message,
            'submitted_at': self.submitted_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }


class UserAvailability(db.Model):
    """User's weekly availability - shown to their linked friends"""
    __tablename__ = 'user_availability'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    week_start_date = db.Column(db.Date, nullable=False)  # Monday of the week
    time_slots = db.Column(db.JSON, nullable=False)  # [{"date": "2025-11-12", "slot": "morning"}, ...]
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # One availability record per user per week
    __table_args__ = (
        db.UniqueConstraint('user_id', 'week_start_date', name='unique_user_availability_per_week'),
    )
    
    # Relationship
    user = db.relationship('User', backref='weekly_availabilities')
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.name,
            'week_start_date': self.week_start_date.isoformat(),
            'time_slots': self.time_slots,
            'submitted_at': self.submitted_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }


class Notification(db.Model):
    __tablename__ = 'notifications'
    
    id = db.Column(db.Integer, primary_key=True)
    planner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=True)  # Nullable for system notifications
    message = db.Column(db.String(500), nullable=False)
    read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Hangout-related fields
    notification_type = db.Column(db.String(30), default='general')  # general, friend_request, hangout_invite, hangout_response
    hangout_id = db.Column(db.Integer, db.ForeignKey('hangouts.id'), nullable=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # Who triggered this notification
    
    # Relationships
    planner = db.relationship('User', foreign_keys=[planner_id])
    contact = db.relationship('Contact', foreign_keys=[contact_id])
    hangout = db.relationship('Hangout', foreign_keys=[hangout_id])
    from_user = db.relationship('User', foreign_keys=[from_user_id])
    
    def to_dict(self):
        result = {
            'id': self.id,
            'planner_id': self.planner_id,
            'contact_id': self.contact_id,
            'contact_name': self.contact.name if self.contact else None,
            'message': self.message,
            'read': self.read,
            'notification_type': self.notification_type or 'general',
            'hangout_id': self.hangout_id,
            'from_user_id': self.from_user_id,
            'from_user_name': self.from_user.name if self.from_user else None,
            'created_at': self.created_at.isoformat() + 'Z'  # Add Z to indicate UTC
        }
        
        # Include hangout details if this is a hangout notification
        if self.hangout:
            result['hangout'] = self.hangout.to_dict()
        
        return result


class PasswordReset(db.Model):
    __tablename__ = 'password_resets'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False)
    reset_token = db.Column(db.String(64), unique=True, nullable=False, default=lambda: secrets.token_urlsafe(32))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    
    def is_valid(self):
        """Check if token is still valid (not expired and not used)"""
        return not self.used and datetime.utcnow() < self.expires_at
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'created_at': self.created_at.isoformat(),
            'expires_at': self.expires_at.isoformat(),
            'used': self.used
        }


class Hangout(db.Model):
    """A hangout invitation for a specific time slot"""
    __tablename__ = 'hangouts'
    
    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD format
    time_slot = db.Column(db.String(20), nullable=False)  # morning, afternoon, evening
    description = db.Column(db.String(500))  # Optional message/description
    status = db.Column(db.String(20), default='active')  # active, cancelled
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    creator = db.relationship('User', backref='hangouts_created')
    invitees = db.relationship('HangoutInvitee', backref='hangout', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'creator_id': self.creator_id,
            'creator_name': self.creator.name,
            'date': self.date,
            'time_slot': self.time_slot,
            'description': self.description,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'invitees': [inv.to_dict() for inv in self.invitees]
        }


class HangoutInvitee(db.Model):
    """Tracks each invitee for a hangout and their response"""
    __tablename__ = 'hangout_invitees'
    
    id = db.Column(db.Integer, primary_key=True)
    hangout_id = db.Column(db.Integer, db.ForeignKey('hangouts.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, accepted, declined
    responded_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    user = db.relationship('User', backref='hangout_invitations')
    
    # Each user can only be invited once per hangout
    __table_args__ = (
        db.UniqueConstraint('hangout_id', 'user_id', name='unique_invitee_per_hangout'),
    )
    
    def to_dict(self):
        return {
            'id': self.id,
            'hangout_id': self.hangout_id,
            'user_id': self.user_id,
            'user_name': self.user.name,
            'status': self.status,
            'responded_at': self.responded_at.isoformat() if self.responded_at else None,
            'created_at': self.created_at.isoformat()
        }


class PushSubscription(db.Model):
    """Stores push notification subscriptions for users"""
    __tablename__ = 'push_subscriptions'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    endpoint = db.Column(db.Text, nullable=False, unique=True)
    p256dh_key = db.Column(db.Text, nullable=False)  # Public key for encryption
    auth_key = db.Column(db.Text, nullable=False)  # Auth secret
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    user = db.relationship('User', backref='push_subscriptions')
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'endpoint': self.endpoint,
            'created_at': self.created_at.isoformat()
        }


class HangoutMessage(db.Model):
    """Chat messages for hangouts/plans"""
    __tablename__ = 'hangout_messages'
    
    id = db.Column(db.Integer, primary_key=True)
    hangout_id = db.Column(db.Integer, db.ForeignKey('hangouts.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message = db.Column(db.Text, nullable=False)
    image_data = db.Column(db.Text, nullable=True)  # Base64 encoded image
    is_ai_message = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    hangout = db.relationship('Hangout', backref='messages')
    user = db.relationship('User', backref='hangout_messages')
    
    def to_dict(self):
        return {
            'id': self.id,
            'hangout_id': self.hangout_id,
            'user_id': self.user_id,
            'user_name': self.user.name,
            'message': self.message,
            'image_data': self.image_data,
            'is_ai_message': self.is_ai_message or False,
            'created_at': self.created_at.isoformat() + 'Z'
        }
