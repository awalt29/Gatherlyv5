from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
import secrets

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone_number = db.Column(db.String(20), nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    reminder_days = db.Column(db.JSON, default=lambda: ["monday", "tuesday", "wednesday", "thursday"])  # List of days to send reminders
    timezone = db.Column(db.String(50), default='America/New_York')  # User's timezone (e.g., 'America/New_York', 'America/Los_Angeles')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    plans_created = db.relationship('Plan', backref='planner', lazy=True, foreign_keys='Plan.planner_id')
    contacts = db.relationship('Contact', backref='owner', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'phone_number': self.phone_number,
            'timezone': self.timezone,
            'created_at': self.created_at.isoformat()
        }


class Contact(db.Model):
    __tablename__ = 'contacts'
    
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone_number = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # A user can't have duplicate contacts
    __table_args__ = (
        db.UniqueConstraint('owner_id', 'phone_number', name='unique_contact_per_user'),
    )
    
    # Relationships
    plan_guests = db.relationship('PlanGuest', backref='contact', lazy=True)
    availabilities = db.relationship('Availability', backref='contact', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'owner_id': self.owner_id,
            'name': self.name,
            'phone_number': self.phone_number,
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
    __tablename__ = 'availability'
    
    id = db.Column(db.Integer, primary_key=True)
    week_start_date = db.Column(db.Date, nullable=False)
    planner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    contact_id = db.Column(db.Integer, db.ForeignKey('contacts.id'), nullable=True)  # Null if it's the planner's own availability
    time_slots = db.Column(db.JSON, nullable=False)  # [{"day": 0, "slot": "morning"}, ...]
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        db.UniqueConstraint('week_start_date', 'planner_id', 'contact_id', name='unique_availability_per_week'),
    )
    
    def to_dict(self):
        if self.contact_id:
            name = self.contact.name
        else:
            # It's the planner's own availability
            planner = User.query.get(self.planner_id)
            name = planner.name
        
        return {
            'id': self.id,
            'week_start_date': self.week_start_date.isoformat(),
            'planner_id': self.planner_id,
            'contact_id': self.contact_id,
            'contact_name': name,
            'user_name': name,  # Alias for admin dashboard compatibility
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
    
    # Relationships
    planner = db.relationship('User', foreign_keys=[planner_id])
    contact = db.relationship('Contact', foreign_keys=[contact_id])
    
    def to_dict(self):
        return {
            'id': self.id,
            'planner_id': self.planner_id,
            'contact_id': self.contact_id,
            'contact_name': self.contact.name if self.contact else None,
            'message': self.message,
            'read': self.read,
            'created_at': self.created_at.isoformat() + 'Z'  # Add Z to indicate UTC
        }
