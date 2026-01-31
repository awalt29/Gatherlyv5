from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from flask_migrate import Migrate
from models import db, User, Contact, Plan, PlanGuest, Availability, Notification, PasswordReset, FriendRequest, Friendship, UserAvailability, Hangout, HangoutInvitee, PushSubscription, HangoutMessage
from datetime import datetime, timedelta, date
from twilio.rest import Client
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content
import json
import os
import openai
from dotenv import load_dotenv

load_dotenv()

import re

def normalize_phone(phone):
    """Normalize phone number by removing all non-digit characters except leading +"""
    if not phone:
        return phone
    # Remove all non-digit characters
    digits = re.sub(r'\D', '', phone)
    # If it's a US number without country code, add 1
    if len(digits) == 10:
        digits = '1' + digits
    return '+' + digits

def find_user_by_phone(phone):
    """Find a user by phone number, trying multiple formats"""
    if not phone:
        print(f"[FIND_USER] No phone provided")
        return None
    
    normalized = normalize_phone(phone)
    print(f"[FIND_USER] Searching for phone: {phone} (normalized: {normalized})")
    
    # Try exact match first
    user = User.query.filter_by(phone_number=phone).first()
    if user:
        print(f"[FIND_USER] Found by exact match: {user.name}")
        return user
    
    # Try normalized match
    user = User.query.filter_by(phone_number=normalized).first()
    if user:
        print(f"[FIND_USER] Found by normalized match: {user.name}")
        return user
    
    # Try matching just the digits (last 10)
    digits = re.sub(r'\D', '', phone)
    if len(digits) >= 10:
        last_10 = digits[-10:]
        print(f"[FIND_USER] Trying last 10 digits match: {last_10}")
        # Search for any phone containing these last 10 digits
        users = User.query.all()
        for u in users:
            if not u.phone_number:
                continue
            u_digits = re.sub(r'\D', '', u.phone_number)
            if len(u_digits) >= 10 and u_digits[-10:] == last_10:
                print(f"[FIND_USER] Found by last 10 digits: {u.name} (phone: {u.phone_number})")
                return u
    
    print(f"[FIND_USER] No user found for phone: {phone}")
    return None

app = Flask(__name__)

# Fix Railway's DATABASE_URL (postgres:// -> postgresql://)
database_url = os.getenv('DATABASE_URL', 'sqlite:///instance/gatherly.db')
if database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = True if os.getenv('APP_BASE_URL', '').startswith('https') else False
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)  # Remember Me for 30 days

db.init_app(app)
migrate = Migrate(app, db)
CORS(app, supports_credentials=True)

# Twilio setup
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')
APP_BASE_URL = os.getenv('APP_BASE_URL', 'http://localhost:5000')

twilio_client = None
if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

# SendGrid setup
SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
SENDGRID_FROM_EMAIL = os.getenv('SENDGRID_FROM_EMAIL', os.getenv('MAIL_USERNAME'))

# VAPID setup for web push notifications
VAPID_PUBLIC_KEY = os.getenv('VAPID_PUBLIC_KEY')
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY')
VAPID_EMAIL = os.getenv('VAPID_EMAIL', 'hello@trygatherly.com')

# OpenAI for AI suggestions
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY

sendgrid_client = None
if SENDGRID_API_KEY:
    sendgrid_client = SendGridAPIClient(SENDGRID_API_KEY)


# Helper functions
def get_monday_of_week(date=None):
    """Get the Monday of the current or specified week"""
    if date is None:
        date = datetime.now().date()
    return date - timedelta(days=date.weekday())


def send_sms(to_phone, message):
    """Send SMS via Twilio"""
    # Normalize phone number for Twilio (E.164 format)
    normalized_to = normalize_phone(to_phone)
    
    if not twilio_client:
        print(f"[SMS Mock] To: {normalized_to}")
        print(f"[SMS Mock] Message: {message}")
        return {'status': 'mocked', 'message': 'Twilio not configured'}
    
    print(f"[SMS] Sending to: {to_phone} (normalized: {normalized_to})")
    
    try:
        result = twilio_client.messages.create(
            body=message,
            from_=TWILIO_PHONE_NUMBER,
            to=normalized_to
        )
        return {'status': 'sent', 'sid': result.sid}
    except Exception as e:
        print(f"[SMS] Error sending to {normalized_to}: {e}")
        return {'status': 'error', 'message': str(e)}


def send_password_reset_email(email, reset_token):
    """Send password reset email via SendGrid"""
    print(f"[SENDGRID] Attempting to send password reset email to: {email}")
    print(f"[SENDGRID] SendGrid configured: {sendgrid_client is not None}")
    print(f"[SENDGRID] From email: {SENDGRID_FROM_EMAIL}")
    
    if not sendgrid_client or not SENDGRID_FROM_EMAIL:
        print(f"[Email Mock] To: {email}")
        print(f"[Email Mock] Reset token: {reset_token}")
        return {'status': 'mocked', 'message': 'SendGrid not configured'}
    
    try:
        base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
        reset_link = f"{base_url}/reset-password?token={reset_token}"
        
        print(f"[SENDGRID] Reset link: {reset_link}")
        
        message = Mail(
            from_email=Email(SENDGRID_FROM_EMAIL),
            to_emails=To(email),
            subject='Password Reset - Gatherly',
            html_content=f"""
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #37558C;">Password Reset</h2>
                    <p>Hi there!</p>
                    <p>You requested to reset your password for your Gatherly account.</p>
                    <p style="margin: 30px 0;">
                        <a href="{reset_link}" style="background-color: #5BA3FF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
                            Reset Password
                        </a>
                    </p>
                    <p style="color: #666; font-size: 14px;">
                        Or copy this link: <br/>
                        <a href="{reset_link}">{reset_link}</a>
                    </p>
                    <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
                    <p style="color: #666; font-size: 14px;">If you didn't request this, please ignore this email.</p>
                    <p style="margin-top: 30px; color: #999; font-size: 12px;">- The Gatherly Team</p>
                </body>
            </html>
            """
        )
        
        print(f"[SENDGRID] Sending email via SendGrid...")
        response = sendgrid_client.send(message)
        print(f"[SENDGRID] Response status code: {response.status_code}")
        print(f"[SENDGRID] Response body: {response.body}")
        print(f"[SENDGRID] Response headers: {response.headers}")
        
        return {'status': 'sent', 'status_code': response.status_code}
    except Exception as e:
        print(f"[SENDGRID ERROR] Failed to send email: {e}")
        print(f"[SENDGRID ERROR] Exception type: {type(e).__name__}")
        import traceback
        print(f"[SENDGRID ERROR] Traceback: {traceback.format_exc()}")
        return {'status': 'error', 'message': str(e)}


# Routes - Main App
# Auth routes
@app.route('/')
def index():
    # Check if user is logged in
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')


@app.route('/sw.js')
def service_worker():
    """Serve service worker from root for proper scope"""
    from flask import send_from_directory
    response = send_from_directory('static', 'sw.js')
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@app.route('/login')
def login():
    # If already logged in, redirect to main app
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/signup')
def signup():
    # If already logged in, redirect to main app
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('signup.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/forgot-password')
def forgot_password_page():
    # If already logged in, redirect to main app
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('forgot_password.html')


@app.route('/reset-password')
def reset_password_page():
    # Allow access to reset page even if logged in
    # (in case user wants to reset password from email link while logged in)
    return render_template('reset_password.html')


@app.route('/api/auth/signup', methods=['POST'])
def auth_signup():
    data = request.json
    
    # Check if email already exists
    existing_user = User.query.filter_by(email=data['email']).first()
    if existing_user:
        return jsonify({'error': 'Email already registered'}), 400
    
    # Create new user - set weekly_availability_date to today so they're "active" for 7 days
    # This lets them see friends' availability immediately without having to add their own first
    today = date.today()
    
    # Normalize phone number on save for consistent matching
    normalized_phone = normalize_phone(data['phone_number'])
    print(f"[SIGNUP] Normalizing phone: {data['phone_number']} → {normalized_phone}")
    
    user = User(
        name=data['name'],
        email=data['email'],
        phone_number=normalized_phone,  # Store normalized for consistent matching
        timezone=data.get('timezone', 'America/New_York'),  # Default to EST
        weekly_availability_date=today  # Start active so they can see friends' availability
    )
    user.set_password(data['password'])
    
    db.session.add(user)
    db.session.commit()
    
    # Auto-connect with anyone who has this user as a contact (invited them)
    # Find contacts with matching phone number
    new_user_phone_normalized = normalize_phone(data['phone_number'])
    new_user_digits = re.sub(r'\D', '', data['phone_number'])[-10:] if data['phone_number'] else ''
    
    all_contacts = Contact.query.all()
    for contact in all_contacts:
        # Check if this contact matches the new user's phone
        contact_normalized = normalize_phone(contact.phone_number)
        contact_digits = re.sub(r'\D', '', contact.phone_number)[-10:] if contact.phone_number else ''
        
        if (contact.phone_number == data['phone_number'] or 
            contact_normalized == new_user_phone_normalized or 
            (contact_digits and contact_digits == new_user_digits)):
            
            inviter = User.query.get(contact.owner_id)
            if inviter and inviter.id != user.id:
                # Check if friendship doesn't already exist
                existing_friendship = Friendship.query.filter(
                    ((Friendship.user_id_1 == inviter.id) & (Friendship.user_id_2 == user.id)) |
                    ((Friendship.user_id_1 == user.id) & (Friendship.user_id_2 == inviter.id))
                ).first()
                
                if not existing_friendship:
                    # Create mutual friendship
                    friendship = Friendship(user_id_1=inviter.id, user_id_2=user.id)
                    db.session.add(friendship)
                    
                    # Update the contact name to the user's actual name
                    contact.name = user.name
                    
                    # Create reciprocal contact for new user
                    reciprocal_exists = Contact.query.filter_by(
                        owner_id=user.id,
                        phone_number=inviter.phone_number
                    ).first()
                    
                    if not reciprocal_exists:
                        reciprocal_contact = Contact(
                            owner_id=user.id,
                            name=inviter.name,
                            phone_number=inviter.phone_number
                        )
                        db.session.add(reciprocal_contact)
                    
                    # Notify the inviter
                    notification = Notification(
                        planner_id=inviter.id,
                        contact_id=None,
                        message=f"{user.name} joined Gatherly! You're now connected.",
                        from_user_id=user.id
                    )
                    
                    # Send push notification
                    send_push_notification(
                        inviter.id,
                        user.name,
                        'Joined Gatherly! You\'re now connected 🎉'
                    )
                    db.session.add(notification)
                    
                    print(f"[AUTO-CONNECT] {user.name} auto-connected with {inviter.name} (inviter)")
    
    db.session.commit()
    
    # Log the user in
    session['user_id'] = user.id
    session['user_email'] = user.email
    session['user_name'] = user.name
    
    return jsonify({'user': user.to_dict()}), 201


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json
    
    # Find user by email
    user = User.query.filter_by(email=data['email']).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid email or password'}), 401
    
    # Log the user in
    session['user_id'] = user.id
    session['user_email'] = user.email
    session['user_name'] = user.name
    
    # Handle "Remember Me" - make session permanent if requested
    remember_me = data.get('remember_me', False)
    if remember_me:
        session.permanent = True
    else:
        session.permanent = False
    
    return jsonify({'user': user.to_dict()}), 200


@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json
    email = data.get('email')
    
    print(f"[PASSWORD RESET] Request received for email: {email}")
    
    if not email:
        return jsonify({'error': 'Email is required'}), 400
    
    # Check if user exists
    user = User.query.filter_by(email=email).first()
    
    if not user:
        print(f"[PASSWORD RESET] No user found for email: {email}")
        # Don't reveal whether email exists or not for security
        return jsonify({'message': 'If an account exists with this email, a password reset link has been sent.'}), 200
    
    print(f"[PASSWORD RESET] User found: {user.name} ({email})")
    
    # Create password reset token
    reset = PasswordReset(
        email=email,
        expires_at=datetime.utcnow() + timedelta(hours=1)
    )
    db.session.add(reset)
    db.session.commit()
    
    print(f"[PASSWORD RESET] Token created: {reset.reset_token[:20]}...")
    
    # Send reset email
    result = send_password_reset_email(email, reset.reset_token)
    print(f"[PASSWORD RESET] Email send result: {result}")
    
    return jsonify({'message': 'If an account exists with this email, a password reset link has been sent.'}), 200


@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.json
    token = data.get('token')
    new_password = data.get('password')
    
    if not token or not new_password:
        return jsonify({'error': 'Token and password are required'}), 400
    
    # Find valid reset token
    reset = PasswordReset.query.filter_by(reset_token=token).first()
    
    if not reset or not reset.is_valid():
        return jsonify({'error': 'Invalid or expired reset link'}), 400
    
    # Find user by email
    user = User.query.filter_by(email=reset.email).first()
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Update password
    user.set_password(new_password)
    reset.used = True
    db.session.commit()
    
    # Log out the user if they're logged in (clear any existing session)
    session.clear()
    
    return jsonify({'message': 'Password successfully reset'}), 200


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user = User.query.get(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify({'user': user.to_dict()}), 200


@app.route('/guest/<token>')
def guest_response(token):
    plan_guest = PlanGuest.query.filter_by(unique_token=token).first_or_404()
    
    # Track first click if not already tracked
    if not plan_guest.link_clicked_at:
        plan_guest.link_clicked_at = datetime.utcnow()
        db.session.commit()
    
    return render_template('guest.html', token=token)


# API Routes - Users (Planners only)
@app.route('/api/users', methods=['GET', 'POST'])
def users():
    if request.method == 'POST':
        data = request.json
        
        # Check if user already exists
        existing_user = User.query.filter_by(phone_number=data['phone_number']).first()
        if existing_user:
            return jsonify(existing_user.to_dict()), 200
        
        # Create new user
        user = User(
            name=data['name'],
            phone_number=data['phone_number']
        )
        db.session.add(user)
        db.session.commit()
        return jsonify(user.to_dict()), 201
    
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])


@app.route('/api/users/<int:user_id>', methods=['GET', 'PUT', 'DELETE'])
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    
    if request.method == 'PUT':
        data = request.json
        user.name = data.get('name', user.name)
        user.phone_number = data.get('phone_number', user.phone_number)
        user.timezone = data.get('timezone', user.timezone)
        db.session.commit()
        return jsonify(user.to_dict()), 200
    
    if request.method == 'DELETE':
        try:
            print(f"[DELETE ACCOUNT] Starting deletion for user {user_id}")
            
            # Delete notifications for this user
            Notification.query.filter_by(planner_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted notifications")
            
            # Delete user availabilities
            UserAvailability.query.filter_by(user_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted user availabilities")
            
            # Delete friendships involving this user
            Friendship.query.filter(
                (Friendship.user_id_1 == user_id) | (Friendship.user_id_2 == user_id)
            ).delete(synchronize_session='fetch')
            print(f"[DELETE ACCOUNT] Deleted friendships")
            
            # Delete friend requests involving this user
            FriendRequest.query.filter(
                (FriendRequest.from_user_id == user_id) | (FriendRequest.to_user_id == user_id)
            ).delete(synchronize_session='fetch')
            print(f"[DELETE ACCOUNT] Deleted friend requests")
            
            # Remove this user from everyone's notification_friend_ids
            all_users = User.query.filter(User.notification_friend_ids.isnot(None)).all()
            for other_user in all_users:
                if other_user.notification_friend_ids and user_id in other_user.notification_friend_ids:
                    other_user.notification_friend_ids = [uid for uid in other_user.notification_friend_ids if uid != user_id]
            print(f"[DELETE ACCOUNT] Removed from notification lists")
            
            # Delete contacts in OTHER users' lists that reference this user (by phone number)
            user_phone = user.phone_number
            user_phone_normalized = normalize_phone(user_phone)
            user_digits = re.sub(r'\D', '', user_phone)[-10:] if user_phone else ''
            
            # Find all contacts that match this user's phone number
            all_contacts = Contact.query.filter(Contact.owner_id != user_id).all()
            for contact in all_contacts:
                contact_normalized = normalize_phone(contact.phone_number)
                contact_digits = re.sub(r'\D', '', contact.phone_number)[-10:] if contact.phone_number else ''
                
                if (contact.phone_number == user_phone or 
                    contact_normalized == user_phone_normalized or 
                    (contact_digits and contact_digits == user_digits)):
                    # Delete related data first
                    Notification.query.filter_by(contact_id=contact.id).delete()
                    PlanGuest.query.filter_by(contact_id=contact.id).delete()
                    Availability.query.filter_by(contact_id=contact.id).delete()
                    db.session.delete(contact)
            print(f"[DELETE ACCOUNT] Deleted contacts from other users' lists")
            
            # Delete old-style availabilities where this user is the planner
            Availability.query.filter_by(planner_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted planner availabilities")
            
            # Get contacts owned by this user (need to delete related data first)
            contacts = Contact.query.filter_by(owner_id=user_id).all()
            for contact in contacts:
                # Delete notifications referencing this contact
                Notification.query.filter_by(contact_id=contact.id).delete()
                # Delete plan guests for this contact
                PlanGuest.query.filter_by(contact_id=contact.id).delete()
                # Delete availabilities for this contact
                Availability.query.filter_by(contact_id=contact.id).delete()
            
            # Now delete contacts
            Contact.query.filter_by(owner_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted contacts")
            
            # Delete plans where user is the planner
            plans = Plan.query.filter_by(planner_id=user_id).all()
            for plan in plans:
                # Delete plan guests
                PlanGuest.query.filter_by(plan_id=plan.id).delete()
                # Delete availabilities for this plan
                Availability.query.filter_by(week_start_date=plan.week_start_date, planner_id=plan.planner_id).delete()
                db.session.delete(plan)
            print(f"[DELETE ACCOUNT] Deleted plans")
            
            # Delete hangout invitations where user is invitee
            HangoutInvitee.query.filter_by(user_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted hangout invitations (as invitee)")
            
            # Delete hangouts created by user (and their invitees)
            hangouts = Hangout.query.filter_by(creator_id=user_id).all()
            for hangout in hangouts:
                HangoutInvitee.query.filter_by(hangout_id=hangout.id).delete()
                # Also delete notifications referencing this hangout
                Notification.query.filter_by(hangout_id=hangout.id).delete()
                db.session.delete(hangout)
            print(f"[DELETE ACCOUNT] Deleted hangouts (as creator)")
            
            # Delete push subscriptions
            PushSubscription.query.filter_by(user_id=user_id).delete()
            print(f"[DELETE ACCOUNT] Deleted push subscriptions")
            
            # Finally delete the user
            db.session.delete(user)
            db.session.commit()
            print(f"[DELETE ACCOUNT] User {user_id} deleted successfully")
            
            # Clear the session
            session.clear()
            
            return jsonify({'message': 'User deleted successfully'}), 200
        except Exception as e:
            db.session.rollback()
            print(f"[DELETE ACCOUNT] Error: {e}")
            return jsonify({'error': str(e)}), 500
    
    return jsonify(user.to_dict())


@app.route('/api/users/<int:user_id>/reminders', methods=['GET', 'PUT'])
def user_reminders(user_id):
    """Get or update user reminder preferences"""
    user = User.query.get_or_404(user_id)
    
    if request.method == 'PUT':
        data = request.json
        reminder_days = data.get('reminder_days', [])
        user.reminder_days = reminder_days
        db.session.commit()
        return jsonify({'message': 'Reminder preferences updated', 'reminder_days': user.reminder_days}), 200
    
    # GET request
    return jsonify({'reminder_days': user.reminder_days or []}), 200


@app.route('/api/users/<int:user_id>/notification-friends', methods=['GET', 'PUT'])
def notification_friends(user_id):
    """Get or update which friends to notify about availability updates"""
    user = User.query.get_or_404(user_id)
    
    if request.method == 'PUT':
        data = request.json
        friend_ids = data.get('friend_ids', [])
        user.notification_friend_ids = friend_ids
        db.session.commit()
        return jsonify({'message': 'Notification preferences updated', 'friend_ids': user.notification_friend_ids}), 200
    
    # GET request - return friend IDs
    return jsonify({'friend_ids': user.notification_friend_ids or []}), 200


@app.route('/api/users/<int:user_id>/weekly-reminders', methods=['PUT'])
def update_weekly_reminders(user_id):
    """Update whether user wants weekly Sunday reminders"""
    user = User.query.get_or_404(user_id)
    
    data = request.json
    enabled = data.get('enabled', True)
    user.weekly_reminders_enabled = enabled
    db.session.commit()
    
    return jsonify({'message': 'Weekly reminders updated', 'weekly_reminders_enabled': user.weekly_reminders_enabled}), 200


@app.route('/api/users/<int:user_id>/install-prompt-seen', methods=['POST'])
def mark_install_prompt_seen(user_id):
    """Mark that user has seen the 'Add to Home Screen' prompt"""
    user = User.query.get_or_404(user_id)
    user.has_seen_install_prompt = True
    db.session.commit()
    return jsonify({'message': 'Install prompt marked as seen'}), 200


# API Routes - Contacts
@app.route('/api/contacts', methods=['GET', 'POST'])
def contacts():
    owner_id = request.args.get('owner_id') or request.json.get('owner_id')
    
    if not owner_id:
        return jsonify({'error': 'owner_id required'}), 400
    
    if request.method == 'POST':
        data = request.json
        input_phone = data.get('phone_number', '')
        normalized_input = normalize_phone(input_phone)
        print(f"[ADD CONTACT] Attempting to add contact with phone: {input_phone} (normalized: {normalized_input})")
        
        # Check if contact already exists for this owner (check both original and normalized)
        existing_contact = Contact.query.filter_by(
            owner_id=data['owner_id'],
            phone_number=normalized_input
        ).first()
        
        # Also check for old non-normalized format
        if not existing_contact:
            existing_contact = Contact.query.filter_by(
                owner_id=data['owner_id'],
                phone_number=input_phone
            ).first()
        
        if existing_contact:
            print(f"[ADD CONTACT] Contact already exists: {existing_contact.name}")
            return jsonify(existing_contact.to_dict()), 200
        
        # Check if this phone number belongs to a registered user on the platform
        existing_user = find_user_by_phone(input_phone)
        print(f"[ADD CONTACT] find_user_by_phone result: {existing_user.name if existing_user else 'NOT FOUND'}")
        
        # Determine the name to use
        if existing_user and existing_user.id != int(data['owner_id']):
            # Use the platform user's name
            contact_name = existing_user.name
        elif data.get('name') and data['name'].strip():
            # Use the provided name
            contact_name = data['name'].strip()
        else:
            # Not on platform - use phone number as placeholder name
            contact_name = data['phone_number']
        
        # Get max display_order for this owner to append new contact at the end
        max_order = db.session.query(db.func.max(Contact.display_order)).filter_by(owner_id=data['owner_id']).scalar() or 0
        
        # Normalize phone number for consistent matching
        normalized_contact_phone = normalize_phone(data['phone_number'])
        print(f"[ADD CONTACT] Normalizing phone: {data['phone_number']} → {normalized_contact_phone}")
        
        # Create new contact
        contact = Contact(
            owner_id=data['owner_id'],
            name=contact_name,
            phone_number=normalized_contact_phone,  # Store normalized
            display_order=max_order + 1
        )
        db.session.add(contact)
        db.session.commit()
        if existing_user and existing_user.id != int(data['owner_id']):
            # Check if there's already a pending/accepted friend request
            existing_request = FriendRequest.query.filter(
                ((FriendRequest.from_user_id == data['owner_id']) & (FriendRequest.to_user_id == existing_user.id)) |
                ((FriendRequest.from_user_id == existing_user.id) & (FriendRequest.to_user_id == data['owner_id']))
            ).first()
            
            # Check if they're already friends
            already_friends = Friendship.are_friends(int(data['owner_id']), existing_user.id)
            
            if not existing_request and not already_friends:
                # Send a friend request to the existing user
                owner = User.query.get(data['owner_id'])
                friend_request = FriendRequest(
                    from_user_id=data['owner_id'],
                    to_user_id=existing_user.id
                )
                db.session.add(friend_request)
                
                # Send push notification to the recipient
                send_push_notification(
                    existing_user.id,
                    owner.name,
                    'Sent you a friend request 👋',
                    '/#notifications'
                )
                
                # Create notification for the sender
                sender_notification = Notification(
                    planner_id=data['owner_id'],
                    contact_id=None,
                    message=f"Friend request sent to {existing_user.name}"
                )
                db.session.add(sender_notification)
                db.session.commit()
                
                print(f"[FRIEND REQUEST] {owner.name} sent friend request to {existing_user.name}")
        
        # Return contact with platform status
        response = contact.to_dict()
        response['is_on_platform'] = existing_user is not None
        return jsonify(response), 201
    
    # GET - fetch all contacts for this owner, sorted by display_order
    contacts = Contact.query.filter_by(owner_id=int(owner_id)).order_by(Contact.display_order).all()
    return jsonify([c.to_dict() for c in contacts])


@app.route('/api/contacts/<int:contact_id>/invite', methods=['POST'])
def invite_contact(contact_id):
    """Send an SMS invite to a contact who isn't on the platform"""
    print(f"[INVITE] Starting invite for contact {contact_id}")
    
    if 'user_id' not in session:
        print(f"[INVITE] Not authenticated")
        return jsonify({'error': 'Not authenticated'}), 401
    
    contact = Contact.query.get_or_404(contact_id)
    user = User.query.get(session['user_id'])
    
    print(f"[INVITE] Contact: {contact.name}, Phone: {contact.phone_number}")
    print(f"[INVITE] User: {user.name}")
    
    # Check if contact is already on platform
    existing_user = find_user_by_phone(contact.phone_number)
    if existing_user:
        print(f"[INVITE] Contact already on platform")
        return jsonify({'error': 'This person is already on Gatherly'}), 400
    
    # Send invite SMS
    app_url = os.getenv('APP_BASE_URL', 'https://trygatherly.com')
    if not app_url.startswith('http'):
        app_url = f'https://{app_url}'
    
    message = f"Hey! {user.name} wants to share availability with you on Gatherly. Join here: {app_url}"
    print(f"[INVITE] Message: {message}")
    print(f"[INVITE] Sending to: {contact.phone_number}")
    
    try:
        twilio_client = Client(
            os.getenv('TWILIO_ACCOUNT_SID'),
            os.getenv('TWILIO_AUTH_TOKEN')
        )
        result = twilio_client.messages.create(
            body=message,
            from_=os.getenv('TWILIO_PHONE_NUMBER'),
            to=contact.phone_number
        )
        print(f"[INVITE] SMS sent successfully, SID: {result.sid}")
        
        # Create notification for sender
        notification = Notification(
            planner_id=user.id,
            contact_id=None,
            message=f"Invite sent to {contact.name}"
        )
        db.session.add(notification)
        db.session.commit()
        
        return jsonify({'message': 'Invite sent successfully', 'contact': contact.to_dict()}), 200
    except Exception as e:
        print(f"[INVITE] Error sending invite SMS: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to send invite: {str(e)}'}), 500


@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    contact = Contact.query.get_or_404(contact_id)
    owner_id = contact.owner_id
    owner = User.query.get(owner_id)
    
    # Check if this contact is linked to a user on the platform (use normalized phone matching)
    linked_user = find_user_by_phone(contact.phone_number)
    if linked_user and linked_user.id != owner_id:
        print(f"[DELETE] Deleting friendship between {owner_id} and {linked_user.id}")
        
        # Delete the friendship between owner and linked user
        Friendship.query.filter(
            ((Friendship.user_id_1 == owner_id) & (Friendship.user_id_2 == linked_user.id)) |
            ((Friendship.user_id_1 == linked_user.id) & (Friendship.user_id_2 == owner_id))
        ).delete()
        
        # Also delete any pending friend requests between them
        FriendRequest.query.filter(
            ((FriendRequest.from_user_id == owner_id) & (FriendRequest.to_user_id == linked_user.id)) |
            ((FriendRequest.from_user_id == linked_user.id) & (FriendRequest.to_user_id == owner_id))
        ).delete()
        
        # Delete the reciprocal contact (the linked user's contact for the owner)
        # Need to find by normalized phone matching
        if owner:
            # Find reciprocal contact using normalized phone matching
            reciprocal_contact = None
            owner_normalized = normalize_phone(owner.phone_number)
            owner_digits = re.sub(r'\D', '', owner.phone_number)[-10:] if owner.phone_number else ''
            
            # Check all contacts owned by the linked user
            linked_user_contacts = Contact.query.filter_by(owner_id=linked_user.id).all()
            for c in linked_user_contacts:
                c_normalized = normalize_phone(c.phone_number)
                c_digits = re.sub(r'\D', '', c.phone_number)[-10:] if c.phone_number else ''
                
                if c.phone_number == owner.phone_number or c_normalized == owner_normalized or c_digits == owner_digits:
                    reciprocal_contact = c
                    break
            
            if reciprocal_contact:
                print(f"[DELETE] Found reciprocal contact {reciprocal_contact.id}, deleting...")
                # Delete notifications for reciprocal contact
                Notification.query.filter_by(contact_id=reciprocal_contact.id).delete()
                # Delete plan guests for reciprocal contact
                PlanGuest.query.filter_by(contact_id=reciprocal_contact.id).delete()
                # Delete availabilities for reciprocal contact
                Availability.query.filter_by(contact_id=reciprocal_contact.id).delete()
                # Delete the reciprocal contact
                db.session.delete(reciprocal_contact)
            else:
                print(f"[DELETE] No reciprocal contact found for owner phone {owner.phone_number}")
    
    # Delete notifications for this contact (to avoid foreign key constraint)
    Notification.query.filter_by(contact_id=contact_id).delete()
    
    # Delete all plan guests associated with this contact
    PlanGuest.query.filter_by(contact_id=contact_id).delete()
    
    # Delete all availabilities associated with this contact
    Availability.query.filter_by(contact_id=contact_id).delete()
    
    # Delete the contact
    db.session.delete(contact)
    db.session.commit()
    
    return jsonify({'message': 'Contact deleted successfully'}), 200


@app.route('/api/contacts/reorder', methods=['POST'])
def reorder_contacts():
    data = request.json
    contact_ids = data.get('contact_ids', [])  # Array of contact IDs in new order
    
    if not contact_ids:
        return jsonify({'error': 'contact_ids required'}), 400
    
    # Update display_order for each contact based on position in array
    for index, contact_id in enumerate(contact_ids):
        contact = db.session.get(Contact, contact_id)
        if contact:
            contact.display_order = index
    
    db.session.commit()
    return jsonify({'message': 'Contact order updated successfully'}), 200


# API Routes - Friend Requests
@app.route('/api/friend-requests', methods=['GET'])
def get_friend_requests():
    """Get pending friend requests for the current user"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    # Get pending requests sent TO this user
    pending_requests = FriendRequest.query.filter_by(
        to_user_id=user_id,
        status='pending'
    ).order_by(FriendRequest.created_at.desc()).all()
    
    return jsonify([r.to_dict() for r in pending_requests])


@app.route('/api/friend-requests/<int:request_id>/accept', methods=['POST'])
def accept_friend_request(request_id):
    """Accept a friend request and create a mutual friendship"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    current_user = User.query.get(user_id)
    
    # Find the request
    friend_request = FriendRequest.query.get_or_404(request_id)
    
    # Make sure this request is for the current user
    if friend_request.to_user_id != user_id:
        return jsonify({'error': 'Not authorized'}), 403
    
    if friend_request.status != 'pending':
        return jsonify({'error': 'Request already processed'}), 400
    
    # Accept the request
    friend_request.status = 'accepted'
    friend_request.responded_at = datetime.utcnow()
    
    # Create the mutual friendship
    friendship = Friendship.create_friendship(friend_request.from_user_id, friend_request.to_user_id)
    db.session.add(friendship)
    
    # Create reciprocal contact for the accepting user (so they see the requester in their contacts)
    from_user = User.query.get(friend_request.from_user_id)
    existing_contact = Contact.query.filter_by(
        owner_id=user_id,
        phone_number=from_user.phone_number
    ).first()
    
    if not existing_contact:
        # Get highest display_order for this user's contacts
        max_order = db.session.query(db.func.max(Contact.display_order)).filter_by(owner_id=user_id).scalar() or 0
        
        new_contact = Contact(
            owner_id=user_id,
            name=from_user.name,
            phone_number=from_user.phone_number,
            display_order=max_order + 1
        )
        db.session.add(new_contact)
    
    # Create notification for the person who sent the request
    notification = Notification(
        planner_id=friend_request.from_user_id,
        contact_id=None,
        message=f"{current_user.name} accepted your friend request!",
        from_user_id=current_user.id
    )
    
    # Send push notification
    send_push_notification(
        friend_request.from_user_id,
        current_user.name,
        'Accepted your friend request! 🎉'
    )
    db.session.add(notification)
    
    db.session.commit()
    
    return jsonify({'message': 'Friend request accepted', 'friendship': friendship.to_dict()})


@app.route('/api/friend-requests/<int:request_id>/reject', methods=['POST'])
def reject_friend_request(request_id):
    """Reject a friend request"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    # Find the request
    friend_request = FriendRequest.query.get_or_404(request_id)
    
    # Make sure this request is for the current user
    if friend_request.to_user_id != user_id:
        return jsonify({'error': 'Not authorized'}), 403
    
    if friend_request.status != 'pending':
        return jsonify({'error': 'Request already processed'}), 400
    
    # Reject the request
    friend_request.status = 'rejected'
    friend_request.responded_at = datetime.utcnow()
    
    db.session.commit()
    
    return jsonify({'message': 'Friend request rejected'})


@app.route('/api/friends', methods=['GET'])
def get_friends():
    """Get all linked friends for the current user"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    # Find all friendships where user is either user_id_1 or user_id_2
    friendships = Friendship.query.filter(
        (Friendship.user_id_1 == user_id) | (Friendship.user_id_2 == user_id)
    ).all()
    
    friends = []
    for f in friendships:
        friend_id = f.user_id_2 if f.user_id_1 == user_id else f.user_id_1
        friend = User.query.get(friend_id)
        if friend:
            # Check if friend has ACTUAL future availability saved
            friend_availability = UserAvailability.query.filter_by(user_id=friend_id).order_by(UserAvailability.updated_at.desc()).first()
            has_actual_availability = False
            if friend_availability and friend_availability.time_slots:
                # Only count slots that are today or in the future
                # Use yesterday as cutoff to handle timezone differences (server is UTC)
                yesterday_str = (date.today() - timedelta(days=1)).isoformat()
                future_slots = [s for s in friend_availability.time_slots if s.get('date', '') >= yesterday_str]
                has_actual_availability = len(future_slots) > 0
            
            friends.append({
                'id': friend.id,
                'name': friend.name,
                'phone_number': friend.phone_number,
                'is_active_this_week': has_actual_availability,
                'friendship_created_at': f.created_at.isoformat()
            })
    
    return jsonify(friends)


@app.route('/api/nudge/<int:friend_user_id>', methods=['POST'])
def send_nudge(friend_user_id):
    """Send a nudge to a friend asking them to share their availability"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    friend = User.query.get_or_404(friend_user_id)
    
    # Verify they are actually friends
    if not Friendship.are_friends(user_id, friend_user_id):
        return jsonify({'error': 'You can only nudge friends'}), 403
    
    # Check if friend has ACTUAL availability saved for TODAY or FUTURE dates
    # Old availability from the past doesn't count
    friend_availability = UserAvailability.query.filter_by(user_id=friend_user_id).order_by(UserAvailability.updated_at.desc()).first()
    has_future_availability = False
    if friend_availability and friend_availability.time_slots:
        # Use yesterday as cutoff to handle timezone differences (server is UTC)
        yesterday_str = (date.today() - timedelta(days=1)).isoformat()
        for slot in friend_availability.time_slots:
            if slot.get('date', '') >= yesterday_str:
                has_future_availability = True
                break
    
    if has_future_availability:
        return jsonify({
            'error': f'{friend.name} has already shared their availability!',
            'already_active': True
        }), 400
    
    # Send SMS nudge
    app_url = os.getenv('APP_BASE_URL', 'https://trygatherly.com')
    if not app_url.startswith('http'):
        app_url = f'https://{app_url}'
    
    # SMS disabled - using push notifications instead
    # sms_message = f"👋 {user.name} wants to know when you're free! Share your availability on Gatherly: {app_url}"
    # send_sms(friend.phone_number, sms_message)
    print(f"[NUDGE] {user.name} nudged {friend.name}")
    
    # Create notification for the friend (recipient of nudge)
    friend_notification = Notification(
        planner_id=friend_user_id,
        contact_id=None,
        message=f"👋 {user.name} wants to see your availability! Add your times to connect.",
        from_user_id=user_id
    )
    db.session.add(friend_notification)
    
    # Send push notification, fall back to SMS if no push subscription
    push_sent = send_push_notification(
        friend_user_id,
        f'{user.name} nudged you 👋',
        'Share your availability so you can connect!'
    )
    
    # SMS fallback if push notification wasn't sent
    if not push_sent:
        sms_message = f"👋 {user.name} wants to know when you're free! Share your availability on Gatherly: {app_url}"
        send_sms(friend.phone_number, sms_message)
        print(f"[NUDGE] SMS fallback sent to {friend.name}")
    
    # Create notification for the sender (confirmation)
    sender_notification = Notification(
        planner_id=user_id,
        contact_id=None,
        message=f"Nudge sent to {friend.name}",
        from_user_id=friend_user_id
    )
    db.session.add(sender_notification)
    
    db.session.commit()
    
    return jsonify({'message': f'Nudge sent to {friend.name}'}), 200


@app.route('/api/friends/availability', methods=['GET'])
def get_friends_availability():
    """Get availability of all linked friends (only if user is active within rolling 7-day window)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    
    # Check if user is active (has submitted availability within last 7 days)
    if not user.is_active_this_week():
        return jsonify({'error': 'You must save your availability to see friends\' availability', 'active': False}), 403
    
    # Find all friendships
    friendships = Friendship.query.filter(
        (Friendship.user_id_1 == user_id) | (Friendship.user_id_2 == user_id)
    ).all()
    
    friend_ids = []
    for f in friendships:
        friend_id = f.user_id_2 if f.user_id_1 == user_id else f.user_id_1
        friend_ids.append(friend_id)
    
    # Get availability for all friends (only future slots)
    # Use yesterday as cutoff to handle timezone differences (server is UTC)
    yesterday_str = (date.today() - timedelta(days=1)).isoformat()
    availabilities = []
    for friend_id in friend_ids:
        friend = User.query.get(friend_id)
        if friend:
            # Get their most recent availability
            avail = UserAvailability.query.filter_by(
                user_id=friend_id
            ).order_by(UserAvailability.updated_at.desc()).first()
            if avail and avail.time_slots:
                # Filter to only include future slots
                future_slots = [s for s in avail.time_slots if s.get('date', '') >= yesterday_str]
                if len(future_slots) > 0:
                    availabilities.append({
                        'user_id': friend.id,
                        'user_name': friend.name,
                        'time_slots': future_slots,
                        'updated_at': avail.updated_at.isoformat()
                    })
    
    return jsonify({'active': True, 'availabilities': availabilities})


@app.route('/api/my-availability', methods=['GET', 'POST'])
def my_availability():
    """Save or get the current user's own weekly availability"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    
    # Get current week's Monday
    today = datetime.utcnow().date()
    monday = today - timedelta(days=today.weekday())
    
    if request.method == 'POST':
        data = request.json
        time_slots = data.get('time_slots', [])
        
        # Find or create availability for this week
        availability = UserAvailability.query.filter_by(
            user_id=user_id,
            week_start_date=monday
        ).first()
        
        # Check if there are NEW slots being added (for notifications)
        # Get the MOST RECENT availability (regardless of week) to compare against
        # This prevents false "new" notifications when the week changes
        old_slots = set()
        most_recent_availability = UserAvailability.query.filter_by(
            user_id=user_id
        ).order_by(UserAvailability.updated_at.desc()).first()
        
        if most_recent_availability:
            # Get existing slots as a set for comparison
            for slot in most_recent_availability.time_slots:
                old_slots.add(f"{slot['date']}_{slot['slot']}")
        
        new_slots = set()
        for slot in time_slots:
            new_slots.add(f"{slot['date']}_{slot['slot']}")
        
        # Check if any genuinely new slots were added
        added_slots = new_slots - old_slots
        has_new_availability = len(added_slots) > 0
        
        if availability:
            # Update existing
            availability.time_slots = time_slots
            availability.updated_at = datetime.utcnow()
        else:
            # Create new
            availability = UserAvailability(
                user_id=user_id,
                week_start_date=monday,
                time_slots=time_slots
            )
            db.session.add(availability)
        
        # Update user's weekly_availability_date to today - they're "active" for 7 days
        user.weekly_availability_date = today
        
        db.session.commit()
        
        print(f"[AVAILABILITY] {user.name} saved availability with {len(time_slots)} slots, active until {today + timedelta(days=7)}")
        print(f"[AVAILABILITY] New slots added: {len(added_slots)}, will notify: {has_new_availability}")
        
        # Only mark notification as pending if NEW availability was added (not just removed)
        # Notifications are aggregated and sent after 5 minutes by a cron job
        if has_new_availability:
            user.availability_notification_pending = True
            user.availability_updated_at = datetime.utcnow()
            db.session.commit()
            print(f"[AVAILABILITY] Marked notification as pending for {user.name}")
        
        return jsonify({
            'message': 'Availability saved',
            'availability': availability.to_dict(),
            'is_active': True,
            'days_remaining': 7
        })
    
    # GET - return user's availability (get most recent)
    # Calculate days remaining based on when they last saved
    days_remaining = 0
    is_active = False
    if user.weekly_availability_date:
        days_since = (today - user.weekly_availability_date).days
        days_remaining = max(0, 7 - days_since)
        is_active = days_remaining > 0
    
    # Get the most recent availability for this user
    availability = UserAvailability.query.filter_by(
        user_id=user_id
    ).order_by(UserAvailability.updated_at.desc()).first()
    
    return jsonify({
        'availability': availability.to_dict() if availability else None,
        'is_active': is_active,
        'days_remaining': days_remaining
    })


# API Routes - Plans
@app.route('/api/plans', methods=['POST'])
def create_plan():
    data = request.json
    print(f"[DEBUG] Received plan data: {data}")
    
    # Get planner (must already exist as a User)
    planner_id = data.get('planner_id')
    print(f"[DEBUG] Looking for planner with ID: {planner_id}")
    
    if not planner_id:
        return jsonify({'error': 'planner_id required'}), 400
    
    planner = db.session.get(User, planner_id)
    if not planner:
        print(f"[DEBUG] Planner not found with ID: {planner_id}")
        return jsonify({'error': 'Planner not found'}), 404
    
    print(f"[DEBUG] Found planner: {planner.name}")
    
    # Parse week start date
    week_start = datetime.fromisoformat(data['week_start_date']).date()
    
    # Create plan
    plan = Plan(
        planner_id=planner.id,
        week_start_date=week_start,
        status='active'
    )
    db.session.add(plan)
    db.session.flush()
    
    # Save planner's availability (always replace old records)
    if data.get('planner_availability'):
        print(f"[DEBUG] Planner availability slots: {data['planner_availability']}")
        
        # Delete ALL old planner availability records (fresh start each time)
        old_count = Availability.query.filter_by(
            planner_id=planner.id,
            contact_id=None
        ).delete()
        print(f"[DEBUG] Deleted {old_count} old planner availability records")
        
        # Create new availability record
        availability = Availability(
            week_start_date=week_start,
            planner_id=planner.id,
            contact_id=None,  # Planner's own availability
            time_slots=data['planner_availability']
        )
        db.session.add(availability)
        print(f"[DEBUG] Created new availability with {len(data['planner_availability'])} slots")
    
    # Format available days for SMS
    available_days = []
    if data.get('planner_availability'):
        # Get unique dates from planner availability
        unique_dates = set()
        for slot in data['planner_availability']:
            if 'date' in slot:
                unique_dates.add(slot['date'])
        
        # Convert dates to day names
        for date_str in sorted(unique_dates):
            date_obj = datetime.fromisoformat(date_str).date()
            day_name = date_obj.strftime('%A')
            available_days.append(day_name)
    
    # Format days as "Thursday, Friday, or Saturday"
    if len(available_days) == 0:
        days_text = "this week"
    elif len(available_days) == 1:
        days_text = available_days[0]
    elif len(available_days) == 2:
        days_text = f"{available_days[0]} or {available_days[1]}"
    else:
        days_text = ", ".join(available_days[:-1]) + f", or {available_days[-1]}"
    
    # Add guests and send notifications
    contact_ids = data.get('contact_ids', [])
    print(f"[DEBUG] Processing {len(contact_ids)} contacts")
    
    # Delete old guest availability for these contacts (fresh start for new plan)
    for contact_id in contact_ids:
        Availability.query.filter_by(
            planner_id=planner.id,
            contact_id=contact_id
        ).delete()
    print(f"[DEBUG] Cleared old guest availability for {len(contact_ids)} contacts")
    
    invited_contacts = []
    for contact_id in contact_ids:
        contact = db.session.get(Contact, contact_id)
        if not contact:
            continue
        
        invited_contacts.append(contact.name)
        
        plan_guest = PlanGuest(
            plan_id=plan.id,
            contact_id=contact.id,
            notified_at=datetime.utcnow()
        )
        db.session.add(plan_guest)
        db.session.flush()
        
        # Send SMS
        base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
        guest_url = f"{base_url}/guest/{plan_guest.unique_token}"
        contact_first_name = contact.name.split()[0]
        message = f"Hey {contact_first_name}, {planner.name} wants to hang out {days_text}. Click the link to share your availability: {guest_url}"
        send_sms(contact.phone_number, message)
    
    # Create notification for planner about sent invites
    if invited_contacts:
        # Format names: "John, Jane, and Bob" or "John and Jane" or "John"
        if len(invited_contacts) == 1:
            names_text = invited_contacts[0]
        elif len(invited_contacts) == 2:
            names_text = f"{invited_contacts[0]} and {invited_contacts[1]}"
        else:
            names_text = ", ".join(invited_contacts[:-1]) + f", and {invited_contacts[-1]}"
        
        notification = Notification(
            planner_id=planner.id,
            contact_id=None,  # System notification
            message=f"Availability request sent to {names_text}"
        )
        db.session.add(notification)
    
    db.session.commit()
    return jsonify(plan.to_dict()), 201


@app.route('/api/plans/<int:plan_id>', methods=['GET'])
def get_plan(plan_id):
    plan = Plan.query.get_or_404(plan_id)
    return jsonify(plan.to_dict())


@app.route('/api/plans', methods=['GET'])
def get_plans():
    plans = Plan.query.order_by(Plan.created_at.desc()).all()
    return jsonify([p.to_dict() for p in plans])


# API Routes - Availability
@app.route('/api/availability', methods=['POST'])
def submit_availability():
    data = request.json
    token = data.get('token')
    
    if token:
        # Guest submission
        plan_guest = PlanGuest.query.filter_by(unique_token=token).first_or_404()
        plan = db.session.get(Plan, plan_guest.plan_id)
        
        # Create or update availability
        availability = Availability.query.filter_by(
            week_start_date=plan.week_start_date,
            planner_id=plan.planner_id,
            contact_id=plan_guest.contact_id
        ).first()
        
        guest_message = data.get('message', '').strip()
        
        if availability:
            availability.time_slots = data['time_slots']
            availability.message = guest_message if guest_message else None
            availability.updated_at = datetime.utcnow()
        else:
            availability = Availability(
                week_start_date=plan.week_start_date,
                planner_id=plan.planner_id,
                contact_id=plan_guest.contact_id,
                time_slots=data['time_slots'],
                message=guest_message if guest_message else None
            )
            db.session.add(availability)
        
        plan_guest.has_responded = True
        
        # Create notification for planner
        contact = db.session.get(Contact, plan_guest.contact_id)
        guest_message = data.get('message', '').strip()
        
        if contact and len(data['time_slots']) > 0:
            # Get date range from time slots (use 'date' field, fallback to 'day' for backwards compatibility)
            dates = []
            for slot in data['time_slots']:
                if 'date' in slot:
                    dates.append(datetime.fromisoformat(slot['date']).date())
                elif 'day' in slot:
                    # Backwards compatibility
                    dates.append(plan.week_start_date + timedelta(days=slot['day']))
            
            if len(dates) > 0:
                dates = sorted(set(dates))
                start_date = dates[0]
                end_date = dates[-1]
                date_range = f"{start_date.strftime('%a %-m/%-d')}"
                if len(dates) > 1:
                    date_range += f" - {end_date.strftime('%a %-m/%-d')}"
                
                message = f"shared their availability for {date_range}"
                
                # Append guest message if provided
                if guest_message:
                    message += f': "{guest_message}"'
                
                notification = Notification(
                    planner_id=plan.planner_id,
                    contact_id=contact.id,
                    message=message
                )
                db.session.add(notification)
        elif contact:
            # No availability shared
            message = f"is not available this week"
            
            # Append guest message if provided
            if guest_message:
                message += f': "{guest_message}"'
            
            notification = Notification(
                planner_id=plan.planner_id,
                contact_id=contact.id,
                message=message
            )
            db.session.add(notification)
        
        db.session.commit()
        
        return jsonify(availability.to_dict()), 201
    else:
        return jsonify({'error': 'Token required'}), 400


@app.route('/api/availability/plan/<int:plan_id>', methods=['GET'])
def get_plan_availability(plan_id):
    """Get all availability for a specific plan"""
    plan = Plan.query.get_or_404(plan_id)
    
    availabilities = Availability.query.filter_by(
        week_start_date=plan.week_start_date,
        planner_id=plan.planner_id
    ).all()
    
    return jsonify([a.to_dict() for a in availabilities])


@app.route('/api/availability/week/<date_str>', methods=['GET'])
def get_week_availability(date_str):
    """Get all availability for a specific week and planner"""
    planner_id = request.args.get('planner_id')
    if not planner_id:
        return jsonify({'error': 'planner_id required'}), 400
    
    week_start = datetime.fromisoformat(date_str).date()
    
    availabilities = Availability.query.filter_by(
        week_start_date=week_start,
        planner_id=int(planner_id)
    ).all()
    
    return jsonify([a.to_dict() for a in availabilities])


@app.route('/api/availability/daterange', methods=['GET'])
def get_availability_by_daterange():
    """Get all availability for a specific date range and planner"""
    planner_id = request.args.get('planner_id')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if not all([planner_id, start_date, end_date]):
        return jsonify({'error': 'planner_id, start_date, and end_date required'}), 400
    
    start = datetime.fromisoformat(start_date).date()
    end = datetime.fromisoformat(end_date).date()
    
    # Get all availability for this planner
    all_avails = Availability.query.filter_by(planner_id=int(planner_id)).all()
    
    # Filter to only include availability with time_slots in the date range
    filtered_avails = []
    for avail in all_avails:
        matching_slots = []
        for slot in avail.time_slots:
            if 'date' in slot:
                slot_date = datetime.fromisoformat(slot['date']).date()
                if start <= slot_date <= end:
                    matching_slots.append(slot)
        
        if matching_slots:
            # Create a copy with only matching slots
            avail_dict = avail.to_dict()
            avail_dict['time_slots'] = matching_slots
            filtered_avails.append(avail_dict)
    
    return jsonify(filtered_avails)


@app.route('/api/guest/<token>', methods=['GET'])
def get_guest_info(token):
    """Get guest and plan info from token"""
    plan_guest = PlanGuest.query.filter_by(unique_token=token).first_or_404()
    plan = db.session.get(Plan, plan_guest.plan_id)
    contact = db.session.get(Contact, plan_guest.contact_id)
    planner = db.session.get(User, plan.planner_id)
    
    # Check if guest has already submitted availability
    existing_availability = Availability.query.filter_by(
        week_start_date=plan.week_start_date,
        planner_id=plan.planner_id,
        contact_id=contact.id
    ).first()
    
    return jsonify({
        'contact': contact.to_dict(),
        'planner': planner.to_dict(),
        'plan': plan.to_dict(),
        'existing_availability': existing_availability.to_dict() if existing_availability else None
    })


# Admin Routes
@app.route('/admin')
def admin_dashboard():
    return render_template('admin/dashboard.html')


@app.route('/admin/users')
def admin_users():
    return render_template('admin/users.html')


@app.route('/admin/plans')
def admin_plans():
    return render_template('admin/plans.html')


@app.route('/admin/plans/<int:plan_id>')
def admin_plan_detail(plan_id):
    return render_template('admin/plan_detail.html', plan_id=plan_id)


@app.route('/admin/availability')
def admin_availability():
    return render_template('admin/availability.html')


# Admin API Routes
@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    total_users = User.query.count()
    total_plans = Plan.query.count()
    active_plans = Plan.query.filter_by(status='active').count()
    total_responses = PlanGuest.query.filter_by(has_responded=True).count()
    total_invites = PlanGuest.query.count()
    
    return jsonify({
        'total_users': total_users,
        'total_plans': total_plans,
        'active_plans': active_plans,
        'response_rate': round(total_responses / total_invites * 100, 1) if total_invites > 0 else 0
    })


@app.route('/api/admin/plans/<int:plan_id>/details', methods=['GET'])
def admin_plan_details(plan_id):
    plan = Plan.query.get_or_404(plan_id)
    
    # Get all availabilities for this plan
    availabilities = Availability.query.filter_by(
        week_start_date=plan.week_start_date,
        planner_id=plan.planner_id
    ).all()
    
    # Get all guests
    guests = [pg.to_dict() for pg in plan.guests]
    
    return jsonify({
        'plan': plan.to_dict(),
        'planner': plan.planner.to_dict(),
        'guests': guests,
        'availabilities': [a.to_dict() for a in availabilities]
    })


@app.route('/api/admin/availability', methods=['GET'])
def admin_all_availability():
    availabilities = Availability.query.order_by(Availability.submitted_at.desc()).all()
    return jsonify([a.to_dict() for a in availabilities])


# Notifications API
@app.route('/api/notifications/<int:planner_id>', methods=['GET'])
def get_notifications(planner_id):
    """Get all notifications for a planner"""
    notifications = Notification.query.filter_by(planner_id=planner_id).order_by(Notification.created_at.desc()).all()
    return jsonify([n.to_dict() for n in notifications])


@app.route('/api/notifications/<int:planner_id>/mark-read', methods=['POST'])
def mark_notifications_read(planner_id):
    """Mark all notifications as read for a planner"""
    Notification.query.filter_by(planner_id=planner_id, read=False).update({'read': True})
    db.session.commit()
    return jsonify({'message': 'Notifications marked as read'}), 200


# ============================================
# HANGOUT API ENDPOINTS
# ============================================

@app.route('/api/hangouts', methods=['POST'])
def create_hangout():
    """Create a new hangout invitation"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    creator_id = session['user_id']
    creator = User.query.get(creator_id)
    data = request.json
    
    date = data.get('date')
    time_slot = data.get('time_slot')
    description = data.get('description', '')
    invitee_ids = data.get('invitee_ids', [])
    
    if not date or not time_slot:
        return jsonify({'error': 'Date and time slot are required'}), 400
    
    if not invitee_ids:
        return jsonify({'error': 'At least one invitee is required'}), 400
    
    # Create the hangout
    hangout = Hangout(
        creator_id=creator_id,
        date=date,
        time_slot=time_slot,
        description=description
    )
    db.session.add(hangout)
    db.session.flush()  # Get the hangout ID
    
    # Add invitees
    for user_id in invitee_ids:
        invitee = HangoutInvitee(
            hangout_id=hangout.id,
            user_id=user_id
        )
        db.session.add(invitee)
        
        # Create notification for the invitee
        invitee_user = User.query.get(user_id)
        if invitee_user:
            # Format the date and time nicely (e.g., "Sunday afternoon (12/21)")
            from datetime import datetime as dt
            date_obj = dt.strptime(date, '%Y-%m-%d')
            day_name = date_obj.strftime('%A')  # e.g., "Sunday"
            month_day = date_obj.strftime('%-m/%-d')  # e.g., "12/21"
            time_display = time_slot.lower()  # e.g., "afternoon"
            
            notification = Notification(
                planner_id=user_id,  # The invitee receives the notification
                message=f"{creator.name} invited you to hang out {day_name} {time_display} ({month_day})",
                notification_type='hangout_invite',
                hangout_id=hangout.id,
                from_user_id=creator_id
            )
            db.session.add(notification)
            
            # Send push notification - link to the plan detail
            push_sent = send_push_notification(
                user_id,
                creator.name,
                f'Invited you to hang out {day_name} {time_display} 🎉',
                f'/?openPlan={hangout.id}'
            )
            
            # SMS fallback if push notification wasn't sent
            if not push_sent:
                try:
                    app_url = os.getenv('APP_BASE_URL', 'https://trygatherly.com')
                    if not app_url.startswith('http'):
                        app_url = f'https://{app_url}'
                    
                    sms_message = f"{creator.name} invited you to hang out {day_name} {time_display}! RSVP here: {app_url}/?openPlan={hangout.id}"
                    send_sms(invitee_user.phone_number, sms_message)
                    print(f"[HANGOUT] SMS fallback sent to {invitee_user.name}")
                except Exception as e:
                    print(f"[HANGOUT] Error sending SMS fallback to {invitee_user.name}: {e}")
    
    # Create notification for the creator (confirmation)
    invitee_names = [User.query.get(uid).name for uid in invitee_ids if User.query.get(uid)]
    names_str = ', '.join(invitee_names)
    # Format the date nicely
    from datetime import datetime as dt
    date_obj = dt.strptime(date, '%Y-%m-%d')
    day_name = date_obj.strftime('%A')
    month_day = date_obj.strftime('%-m/%-d')
    creator_notification = Notification(
        planner_id=creator_id,
        message=f"You invited {names_str} to hang out {day_name} {time_slot.lower()} ({month_day})",
        notification_type='hangout_invite',
        hangout_id=hangout.id,
        from_user_id=creator_id
    )
    db.session.add(creator_notification)
    
    db.session.commit()
    
    print(f"[HANGOUT] Created hangout {hangout.id} by {creator.name} for {date} {time_slot}")
    
    return jsonify({
        'message': 'Hangout invitation sent!',
        'hangout': hangout.to_dict()
    }), 201


@app.route('/api/hangouts/<int:hangout_id>/respond', methods=['POST'])
def respond_to_hangout(hangout_id):
    """Accept or decline a hangout invitation"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    data = request.json
    
    response = data.get('response')  # 'accepted', 'declined', or 'maybe'
    if response not in ['accepted', 'declined', 'maybe']:
        return jsonify({'error': 'Invalid response. Must be "accepted" or "declined"'}), 400
    
    # Find the invitation
    invitee = HangoutInvitee.query.filter_by(
        hangout_id=hangout_id,
        user_id=user_id
    ).first()
    
    if not invitee:
        return jsonify({'error': 'Invitation not found'}), 404
    
    hangout = Hangout.query.get(hangout_id)
    if not hangout:
        return jsonify({'error': 'Hangout not found'}), 404
    
    # Update the response
    invitee.status = response
    invitee.responded_at = datetime.utcnow()
    
    # Create notification for the hangout creator
    response_text = response  # 'accepted', 'declined', or 'maybe'
    if response == 'maybe':
        response_text = 'said maybe to'
    # Format the date nicely
    from datetime import datetime as dt
    date_obj = dt.strptime(hangout.date, '%Y-%m-%d')
    day_name = date_obj.strftime('%A')
    month_day = date_obj.strftime('%-m/%-d')
    creator_notification = Notification(
        planner_id=hangout.creator_id,
        message=f"{user.name} {response_text} your hangout invite for {day_name} {hangout.time_slot.lower()} ({month_day})",
        notification_type='hangout_response',
        hangout_id=hangout_id,
        from_user_id=user_id
    )
    db.session.add(creator_notification)
    
    # Send push notification to creator - link to the plan detail
    emoji = '✅' if response == 'accepted' else ('🤔' if response == 'maybe' else '❌')
    send_push_notification(
        hangout.creator_id,
        user.name,
        f'{response_text.capitalize()} your {day_name} invite {emoji}',
        f'/?openPlan={hangout.id}'
    )
    
    db.session.commit()
    
    print(f"[HANGOUT] {user.name} {response_text} hangout {hangout_id}")
    
    return jsonify({
        'message': f'You have {response_text} the hangout invitation',
        'hangout': hangout.to_dict()
    }), 200


@app.route('/api/hangouts', methods=['GET'])
def get_user_hangouts():
    """Get all hangouts for the current user (as creator or invitee)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    # Get hangouts created by user
    created = Hangout.query.filter_by(creator_id=user_id, status='active').all()
    
    # Get hangouts user is invited to
    invitations = HangoutInvitee.query.filter_by(user_id=user_id).all()
    invited_hangout_ids = [inv.hangout_id for inv in invitations]
    invited = Hangout.query.filter(
        Hangout.id.in_(invited_hangout_ids),
        Hangout.status == 'active'
    ).all() if invited_hangout_ids else []
    
    # Add message count and latest message info to each hangout
    def hangout_with_messages(h):
        data = h.to_dict()
        messages = HangoutMessage.query.filter_by(hangout_id=h.id).order_by(HangoutMessage.created_at.desc()).all()
        data['message_count'] = len(messages)
        if messages:
            data['latest_message_id'] = messages[0].id
            data['latest_message_at'] = messages[0].created_at.isoformat() + 'Z'
            data['latest_message_user_id'] = messages[0].user_id
        else:
            data['latest_message_id'] = None
            data['latest_message_at'] = None
            data['latest_message_user_id'] = None
        return data
    
    return jsonify({
        'created': [hangout_with_messages(h) for h in created],
        'invited': [hangout_with_messages(h) for h in invited]
    })


@app.route('/api/hangouts/<int:hangout_id>', methods=['GET'])
def get_hangout(hangout_id):
    """Get a single hangout by ID"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Check if user is creator or invitee
    is_creator = hangout.creator_id == user_id
    is_invitee = any(inv.user_id == user_id for inv in hangout.invitees)
    
    if not is_creator and not is_invitee:
        return jsonify({'error': 'Not authorized to view this plan'}), 403
    
    creator = User.query.get(hangout.creator_id)
    
    return jsonify({
        'id': hangout.id,
        'date': hangout.date,
        'time_slot': hangout.time_slot,
        'description': hangout.description,
        'creator_id': hangout.creator_id,
        'creator_name': creator.name if creator else 'Unknown',
        'created_at': hangout.created_at.isoformat() if hangout.created_at else None,
        'invitees': [{
            'user_id': inv.user_id,
            'user_name': User.query.get(inv.user_id).name if User.query.get(inv.user_id) else 'Unknown',
            'status': inv.status
        } for inv in hangout.invitees]
    }), 200


@app.route('/api/hangouts/<int:hangout_id>', methods=['PUT'])
def update_hangout(hangout_id):
    """Update a hangout (only by creator)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Only creator can update
    if hangout.creator_id != user_id:
        return jsonify({'error': 'Only the host can edit this plan'}), 403
    
    data = request.get_json()
    creator = User.query.get(user_id)
    
    # Track what changed for notifications
    date_changed = data.get('date') and data['date'] != hangout.date
    time_changed = data.get('time_slot') and data['time_slot'] != hangout.time_slot
    
    # Update basic fields
    if data.get('date'):
        hangout.date = data['date']
    if data.get('time_slot'):
        hangout.time_slot = data['time_slot']
    if 'description' in data:
        hangout.description = data.get('description', '')
    
    # Handle invitee changes
    if 'invitee_ids' in data:
        current_invitee_ids = {inv.user_id for inv in hangout.invitees}
        new_invitee_ids = set(data['invitee_ids'])
        
        # Remove invitees no longer in the list
        removed_ids = current_invitee_ids - new_invitee_ids
        for inv in list(hangout.invitees):
            if inv.user_id in removed_ids:
                # Notify removed invitee
                notification = Notification(
                    planner_id=inv.user_id,
                    message=f"{creator.name} removed you from the plan on {hangout.date}",
                    from_user_id=user_id
                )
                db.session.add(notification)
                db.session.delete(inv)
        
        # Add new invitees
        added_ids = new_invitee_ids - current_invitee_ids
        for invitee_id in added_ids:
            invitee = HangoutInvitee(
                hangout_id=hangout.id,
                user_id=invitee_id,
                status='pending'
            )
            db.session.add(invitee)
            
            # Create notification for new invitee
            notification = Notification(
                planner_id=invitee_id,
                message=f"{creator.name} invited you to hang out on {hangout.date} ({hangout.time_slot})",
                notification_type='hangout_invite',
                hangout_id=hangout.id,
                from_user_id=user_id
            )
            db.session.add(notification)
            
            # Send push notification to new invitee
            invitee_user = User.query.get(invitee_id)
            if invitee_user:
                push_sent = send_push_notification(
                    invitee_id,
                    f"{creator.name} invited you to hang out!",
                    f"{hangout.date} ({hangout.time_slot})",
                    {'type': 'hangout_invite', 'hangout_id': hangout.id}
                )
                # Fallback to SMS if push not available
                if not push_sent and invitee_user.phone:
                    base_url = os.environ.get('BASE_URL', 'https://gatherlyv5-production.up.railway.app')
                    message = f"{creator.name} invited you to hang out on {hangout.date}. Open Gatherly to respond: {base_url}?open=notifications"
                    send_sms(invitee_user.phone, message)
    
    # Notify existing invitees if date/time changed
    if date_changed or time_changed:
        for inv in hangout.invitees:
            if inv.user_id != user_id and inv.user_id not in added_ids:
                notification = Notification(
                    planner_id=inv.user_id,
                    message=f"{creator.name} updated the plan to {hangout.date} ({hangout.time_slot})",
                    notification_type='hangout_update',
                    hangout_id=hangout.id,
                    from_user_id=user_id
                )
                db.session.add(notification)
    
    db.session.commit()
    
    return jsonify({'message': 'Plan updated', 'id': hangout.id}), 200


@app.route('/api/hangouts/<int:hangout_id>', methods=['DELETE'])
def delete_hangout(hangout_id):
    """Cancel/delete a hangout (only by creator)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Only creator can delete
    if hangout.creator_id != user_id:
        return jsonify({'error': 'Only the host can cancel this plan'}), 403
    
    # Notify all invitees
    creator = User.query.get(user_id)
    for invitee in hangout.invitees:
        notification = Notification(
            planner_id=invitee.user_id,
            message=f"{creator.name} cancelled the plan for {hangout.date} ({hangout.time_slot})",
            from_user_id=user_id
        )
        db.session.add(notification)
    
    # Delete associated messages first
    HangoutMessage.query.filter_by(hangout_id=hangout_id).delete()
    
    # Delete associated notifications
    Notification.query.filter_by(hangout_id=hangout_id).delete()
    
    # Delete the hangout (cascade will delete invitees)
    db.session.delete(hangout)
    db.session.commit()
    
    return jsonify({'message': 'Plan cancelled'}), 200


@app.route('/api/hangouts/for-slot', methods=['GET'])
def get_hangouts_for_slot():
    """Get hangout invitee statuses for a specific date/time slot (for calendar display)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    date = request.args.get('date')
    time_slot = request.args.get('time_slot')
    
    if not date or not time_slot:
        return jsonify({'error': 'Date and time_slot are required'}), 400
    
    # Find hangouts created by this user for this slot
    hangouts = Hangout.query.filter_by(
        creator_id=user_id,
        date=date,
        time_slot=time_slot,
        status='active'
    ).all()
    
    # Build response with invitee statuses
    result = []
    for hangout in hangouts:
        for invitee in hangout.invitees:
            result.append({
                'hangout_id': hangout.id,
                'user_id': invitee.user_id,
                'user_name': invitee.user.name,
                'status': invitee.status
            })
    
    return jsonify(result)


# =====================
# Hangout Chat Endpoints
# =====================

@app.route('/api/hangouts/<int:hangout_id>/messages', methods=['GET'])
def get_hangout_messages(hangout_id):
    """Get all messages for a hangout"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Check if user is creator or invitee
    is_creator = hangout.creator_id == user_id
    is_invitee = any(inv.user_id == user_id for inv in hangout.invitees)
    
    if not is_creator and not is_invitee:
        return jsonify({'error': 'Not authorized to view this chat'}), 403
    
    # Get messages ordered by creation time
    messages = HangoutMessage.query.filter_by(hangout_id=hangout_id).order_by(HangoutMessage.created_at.asc()).all()
    
    return jsonify([m.to_dict() for m in messages])


@app.route('/api/hangouts/<int:hangout_id>/messages', methods=['POST'])
def send_hangout_message(hangout_id):
    """Send a message in a hangout chat"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Check if user is creator or invitee
    is_creator = hangout.creator_id == user_id
    is_invitee = any(inv.user_id == user_id for inv in hangout.invitees)
    
    if not is_creator and not is_invitee:
        return jsonify({'error': 'Not authorized to chat here'}), 403
    
    # Check if hangout is too far in the past (allow 7 day grace period for post-event coordination like bill splitting)
    # Use user's timezone to determine "today" to avoid timezone mismatches
    import pytz
    user_tz = pytz.timezone(user.timezone or 'America/New_York')
    user_today = datetime.now(user_tz).date()
    hangout_date = datetime.strptime(hangout.date, '%Y-%m-%d').date()
    days_past = (user_today - hangout_date).days
    if days_past > 7:
        return jsonify({'error': 'Cannot send messages for events more than 7 days old'}), 400
    
    data = request.json
    message_text = data.get('message', '').strip()
    image_data = data.get('image_data')  # Base64 encoded image
    
    # Either message or image is required
    if not message_text and not image_data:
        return jsonify({'error': 'Message or image required'}), 400
    
    if message_text and len(message_text) > 500:
        return jsonify({'error': 'Message too long (max 500 characters)'}), 400
    
    # Validate image size (max ~2MB base64 = ~1.5MB actual image)
    if image_data and len(image_data) > 2 * 1024 * 1024:
        return jsonify({'error': 'Image too large (max 1.5MB)'}), 400
    
    # Create message
    message = HangoutMessage(
        hangout_id=hangout_id,
        user_id=user_id,
        message=message_text or '📷 Shared a photo',
        image_data=image_data
    )
    db.session.add(message)
    db.session.commit()
    
    # Send push notifications to other participants
    participants = [hangout.creator_id] + [inv.user_id for inv in hangout.invitees]
    for participant_id in participants:
        if participant_id != user_id:  # Don't notify sender
            # Format date for notification
            hangout_date_obj = datetime.strptime(hangout.date, '%Y-%m-%d')
            date_str = hangout_date_obj.strftime('%a %m/%d')
            send_push_notification(
                participant_id,
                f'💬 {user.name}',
                f'{message_text[:100]}{"..." if len(message_text) > 100 else ""}',
                f'/?openPlan={hangout_id}'
            )
    
    return jsonify(message.to_dict()), 201


# =====================
# AI Suggestions Endpoint
# =====================

@app.route('/api/hangouts/<int:hangout_id>/ai-suggest', methods=['POST'])
def ai_suggest(hangout_id):
    """Get AI suggestions for a hangout based on chat context"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    if not OPENAI_API_KEY:
        return jsonify({'error': 'AI suggestions not configured'}), 503
    
    user_id = session['user_id']
    user = User.query.get(user_id)
    hangout = Hangout.query.get_or_404(hangout_id)
    
    # Check if user is participant
    is_creator = hangout.creator_id == user_id
    is_invitee = any(inv.user_id == user_id for inv in hangout.invitees)
    
    if not is_creator and not is_invitee:
        return jsonify({'error': 'Not authorized'}), 403
    
    data = request.json
    prompt = data.get('prompt', '').strip().lower()
    suggestion_type = data.get('type', 'custom')  # dinner, drinks, split, custom
    
    # Build context from hangout details
    hangout_date = datetime.strptime(hangout.date, '%Y-%m-%d')
    date_str = hangout_date.strftime('%A, %B %d')
    
    guest_names = [inv.user.name for inv in hangout.invitees]
    creator_name = hangout.creator.name
    all_participants = [creator_name] + guest_names
    
    # Get recent chat messages for context
    recent_messages = HangoutMessage.query.filter_by(hangout_id=hangout_id)\
        .order_by(HangoutMessage.created_at.desc())\
        .limit(20).all()
    
    # Check if this is a "split it" request (actually calculate the split)
    # Only trigger calculation when user says "split it" - NOT on initial "split the bill" request
    is_split_calculation = suggestion_type == 'split' and ('split it' in prompt or 'calculate' in prompt or 'do the split' in prompt)
    
    # For split calculation, look for receipt image
    receipt_image = None
    if is_split_calculation:
        for msg in recent_messages:
            if msg.image_data:
                receipt_image = msg.image_data
                break
    
    chat_context = ""
    previous_suggestions = ""
    if recent_messages:
        chat_context = "\n\nRecent chat messages:\n"
        for msg in reversed(recent_messages):
            if msg.is_ai_message or msg.message.startswith('✨ AI:'):
                # Track AI suggestions to avoid repeats
                previous_suggestions += msg.message + "\n"
            else:
                chat_context += f"- {msg.user.name}: {msg.message}\n"
    
    try:
        # Handle split bill with image (vision API)
        if is_split_calculation and receipt_image:
            system_prompt = f"""You are helping split a restaurant bill for a group of friends.

Participants: {', '.join(all_participants)}

Recent chat where people mentioned what they ordered:
{chat_context}

Instructions:
1. Look at the receipt image carefully
2. Match items on the receipt to people based on what they said in chat
3. Calculate each person's total (including their proportional share of tax and tip)

Keep your response SHORT and SIMPLE. Use this exact format:

**Items Ordered:**
- [Name]: [their items]
- [Name]: [their items]

**Final Amounts (including tax & tip):**
- [Name]: $XX.XX
- [Name]: $XX.XX

That's it! No calculations shown, no formulas, just the items and final totals."""

            # Clean up base64 string (remove any whitespace or line breaks)
            import re
            clean_image = re.sub(r'\s+', '', receipt_image)
            
            # Detect image type from base64 header or default to jpeg
            image_type = 'jpeg'
            if clean_image.startswith('/9j/'):
                image_type = 'jpeg'
            elif clean_image.startswith('iVBOR'):
                image_type = 'png'
            elif clean_image.startswith('R0lGOD'):
                image_type = 'gif'
            elif clean_image.startswith('UklGR'):
                image_type = 'webp'
            
            print(f"[AI] Processing image, type detected: {image_type}, length: {len(clean_image)}")
            
            response = openai.chat.completions.create(
                model="gpt-4o",  # Need GPT-4o for vision
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": [
                        {"type": "text", "text": "Please analyze this receipt and split the bill based on what everyone said they ordered in the chat."},
                        {"type": "image_url", "image_url": {"url": f"data:image/{image_type};base64,{clean_image}"}}
                    ]}
                ],
                max_tokens=500,
                temperature=0.3
            )
        
        # Handle split bill without image (just give instructions)
        elif suggestion_type == 'split' and not is_split_calculation:
            ai_response = """📸 To split the bill:

1️⃣ Someone upload a photo of the receipt
2️⃣ Everyone reply with what you ordered (e.g., "I had the burger and a beer")
3️⃣ Then say "@AI split it" and I'll calculate who owes what!"""
            
            ai_message = HangoutMessage(
                hangout_id=hangout_id,
                user_id=user_id,
                message=f"✨ AI: {ai_response}",
                is_ai_message=True
            )
            db.session.add(ai_message)
            db.session.commit()
            
            return jsonify({
                'message': ai_message.to_dict(),
                'ai_response': ai_response
            }), 200
        
        # Handle split without receipt image
        elif is_split_calculation and not receipt_image:
            ai_response = "I don't see a receipt photo! Please upload a picture of the bill first, then try again."
            
            ai_message = HangoutMessage(
                hangout_id=hangout_id,
                user_id=user_id,
                message=f"✨ AI: {ai_response}",
                is_ai_message=True
            )
            db.session.add(ai_message)
            db.session.commit()
            
            return jsonify({
                'message': ai_message.to_dict(),
                'ai_response': ai_response
            }), 200
        
        # Handle dinner suggestions - check if they've provided preferences
        elif suggestion_type == 'dinner':
            # Check if this is just the initial request or if they've provided details
            has_preferences = any(word in prompt for word in ['neighborhood', 'near', 'area', 'cuisine', 'type', 'mexican', 'italian', 'asian', 'chinese', 'japanese', 'indian', 'thai', 'american', 'french', 'mediterranean', 'sushi', 'pizza', 'burgers', 'seafood', 'steakhouse', 'vegetarian', 'vegan', 'downtown', 'midtown', 'uptown'])
            
            if not has_preferences and 'suggest dinner' in prompt:
                # First request - ask for preferences
                ai_response = """🍽️ I'd love to help find dinner spots!

To give you the best suggestions, tell me:
• What neighborhood or area?
• Any cuisine preferences? (Italian, Mexican, Asian, etc.)
• Vibe? (Casual, upscale, good for groups?)

Just reply with something like "@AI Italian restaurant in Chelsea" and I'll find some great options!"""
                
                ai_message = HangoutMessage(
                    hangout_id=hangout_id,
                    user_id=user_id,
                    message=f"✨ AI: {ai_response}",
                    is_ai_message=True
                )
                db.session.add(ai_message)
                db.session.commit()
                
                return jsonify({
                    'message': ai_message.to_dict(),
                    'ai_response': ai_response
                }), 200
            else:
                # They've provided preferences - give actual suggestions
                no_repeat = ""
                if previous_suggestions:
                    no_repeat = f"\n\nIMPORTANT: Do NOT suggest any places already mentioned. Previous suggestions to avoid:\n{previous_suggestions}"
                
                system_prompt = f"""You are helping friends find a dinner spot. Give 2-3 specific restaurant suggestions based on their preferences.
For each suggestion include: name, why it's good for groups, and price range ($, $$, $$$).
Keep it brief and friendly. Do NOT use markdown formatting (no asterisks, no bold, no headers).{no_repeat}"""
                
                user_prompt = prompt.replace('@ai ', '').strip()
                
                response = openai.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=250,
                    temperature=0.8
                )
        
        # Handle drinks suggestions - check if they've provided preferences  
        elif suggestion_type == 'drinks':
            has_preferences = any(word in prompt for word in ['neighborhood', 'near', 'area', 'type', 'cocktails', 'beer', 'wine', 'sports bar', 'dive', 'rooftop', 'lounge', 'club', 'downtown', 'midtown', 'uptown', 'chill', 'loud', 'quiet'])
            
            if not has_preferences and 'suggest' in prompt and 'drinks' in prompt:
                # First request - ask for preferences
                ai_response = """🍸 Let's find a great spot for drinks!

Tell me a bit more:
• What neighborhood or area?
• What vibe? (Chill bar, rooftop, sports bar, cocktail lounge?)
• Any preferences? (Craft beer, cocktails, wine?)

Reply with something like "@AI chill cocktail bar in Chelsea" and I'll hook you up!"""
                
                ai_message = HangoutMessage(
                    hangout_id=hangout_id,
                    user_id=user_id,
                    message=f"✨ AI: {ai_response}",
                    is_ai_message=True
                )
                db.session.add(ai_message)
                db.session.commit()
                
                return jsonify({
                    'message': ai_message.to_dict(),
                    'ai_response': ai_response
                }), 200
            else:
                # They've provided preferences - give actual suggestions
                no_repeat = ""
                if previous_suggestions:
                    no_repeat = f"\n\nIMPORTANT: Do NOT suggest any places already mentioned. Previous suggestions to avoid:\n{previous_suggestions}"
                
                system_prompt = f"""You are helping friends find a bar or place for drinks. Give 2-3 specific suggestions based on their preferences.
For each suggestion include: name, vibe/atmosphere, and what they're known for.
Keep it brief and friendly. Do NOT use markdown formatting (no asterisks, no bold, no headers).{no_repeat}"""
                
                user_prompt = prompt.replace('@ai ', '').strip()
                
                response = openai.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=250,
                    temperature=0.8
                )
        
        # Handle custom/other requests
        else:
            system_prompt = f"""You are a helpful assistant for a group planning app called Gatherly. 
You're helping a group of friends plan a hangout.

Event details:
- Date: {date_str}
- Time: {hangout.time_slot}
- Description: {hangout.description or 'Not specified'}
- Participants: {', '.join(all_participants)}
{chat_context}

Keep your responses concise, friendly, and helpful. 
Don't be overly formal - match the casual tone of friends planning to hang out.
Keep responses under 150 words.
Do NOT use markdown formatting (no asterisks, no bold, no headers)."""

            user_prompt = prompt.replace('@ai ', '').strip()
            
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=200,
                temperature=0.7
            )
        
        ai_response = response.choices[0].message.content.strip()
        
        # Save as a chat message with AI flag
        ai_message = HangoutMessage(
            hangout_id=hangout_id,
            user_id=user_id,
            message=f"✨ AI: {ai_response}",
            is_ai_message=True
        )
        db.session.add(ai_message)
        db.session.commit()
        
        return jsonify({
            'message': ai_message.to_dict(),
            'ai_response': ai_response
        }), 200
        
    except Exception as e:
        print(f"[AI] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'AI error: {str(e)}'}), 500


# =====================
# Push Notification Endpoints
# =====================

def send_push_notification(user_id, title, body, url=None, notification_id=None):
    """Send push notification to all subscriptions for a user"""
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        print("[PUSH] VAPID keys not configured, skipping push notification")
        return False
    
    try:
        from pywebpush import webpush
    except ImportError:
        print("[PUSH] pywebpush not installed")
        return False
    
    subscriptions = PushSubscription.query.filter_by(user_id=user_id).all()
    if not subscriptions:
        print(f"[PUSH] No subscriptions for user {user_id}")
        return False
    
    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url or '/#notifications',
        'notificationId': notification_id
    })
    
    # VAPID claims with the required 'sub' claim
    vapid_claims = {
        'sub': f'mailto:{VAPID_EMAIL}'
    }
    
    success_count = 0
    for sub in subscriptions:
        try:
            # Use the raw private key string directly
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
            print(f"[PUSH] Sent to user {user_id}")
        except Exception as e:
            error_msg = str(e)
            print(f"[PUSH] Error sending to user {user_id}: {error_msg}")
            import traceback
            traceback.print_exc()
            # Remove invalid subscriptions (410 Gone or 404 Not Found)
            if '410' in error_msg or '404' in error_msg:
                print(f"[PUSH] Removing invalid subscription {sub.id}")
                db.session.delete(sub)
                db.session.commit()
    
    return success_count > 0


@app.route('/api/push/vapid-key', methods=['GET'])
def get_vapid_key():
    """Return the VAPID public key for push notification subscription"""
    if not VAPID_PUBLIC_KEY:
        return jsonify({'error': 'Push notifications not configured'}), 503
    return jsonify({'publicKey': VAPID_PUBLIC_KEY})


@app.route('/api/push/subscribe', methods=['POST'])
def subscribe_push():
    """Subscribe to push notifications"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    data = request.json
    
    endpoint = data.get('endpoint')
    p256dh = data.get('keys', {}).get('p256dh')
    auth = data.get('keys', {}).get('auth')
    
    if not endpoint or not p256dh or not auth:
        return jsonify({'error': 'Invalid subscription data'}), 400
    
    # Check if subscription already exists
    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if existing:
        # Update user_id if different (same browser, different account)
        if existing.user_id != user_id:
            existing.user_id = user_id
            db.session.commit()
        return jsonify({'message': 'Already subscribed'}), 200
    
    # Create new subscription
    subscription = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh_key=p256dh,
        auth_key=auth
    )
    db.session.add(subscription)
    db.session.commit()
    
    print(f"[PUSH] User {user_id} subscribed to push notifications")
    return jsonify({'message': 'Subscribed successfully'}), 201


@app.route('/api/push/unsubscribe', methods=['POST'])
def unsubscribe_push():
    """Unsubscribe from push notifications"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.json
    endpoint = data.get('endpoint')
    
    if endpoint:
        PushSubscription.query.filter_by(endpoint=endpoint).delete()
    else:
        # Unsubscribe all for this user
        PushSubscription.query.filter_by(user_id=session['user_id']).delete()
    
    db.session.commit()
    print(f"[PUSH] User {session['user_id']} unsubscribed from push notifications")
    return jsonify({'message': 'Unsubscribed successfully'}), 200


@app.route('/api/push/test', methods=['POST'])
def test_push():
    """Send a test push notification to the current user"""
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    success = send_push_notification(
        session['user_id'],
        'Gatherly',
        'Push notifications are working! 🎉',
        '/'
    )
    
    if success:
        return jsonify({'message': 'Test notification sent'}), 200
    else:
        return jsonify({'error': 'Failed to send test notification'}), 500


# Initialize database
@app.cli.command()
def init_db():
    """Initialize the database."""
    db.create_all()
    print("Database initialized!")


# Create tables on startup (works with both gunicorn and direct execution)
with app.app_context():
    try:
        print("🔄 Initializing database tables...")
        db.create_all()
        print("✅ Database tables created successfully!")
    except Exception as e:
        print(f"❌ Error creating database tables: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
