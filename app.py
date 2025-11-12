from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from flask_migrate import Migrate
from models import db, User, Contact, Plan, PlanGuest, Availability, Notification, PasswordReset
from datetime import datetime, timedelta
from twilio.rest import Client
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content
import os
from dotenv import load_dotenv

load_dotenv()

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
    if not twilio_client:
        print(f"[SMS Mock] To: {to_phone}")
        print(f"[SMS Mock] Message: {message}")
        return {'status': 'mocked', 'message': 'Twilio not configured'}
    
    try:
        message = twilio_client.messages.create(
            body=message,
            from_=TWILIO_PHONE_NUMBER,
            to=to_phone
        )
        return {'status': 'sent', 'sid': message.sid}
    except Exception as e:
        print(f"Error sending SMS: {e}")
        return {'status': 'error', 'message': str(e)}


def send_password_reset_email(email, reset_token):
    """Send password reset email via SendGrid"""
    if not sendgrid_client or not SENDGRID_FROM_EMAIL:
        print(f"[Email Mock] To: {email}")
        print(f"[Email Mock] Reset token: {reset_token}")
        return {'status': 'mocked', 'message': 'SendGrid not configured'}
    
    try:
        base_url = APP_BASE_URL if APP_BASE_URL.startswith('http') else f"https://{APP_BASE_URL}"
        reset_link = f"{base_url}/reset-password?token={reset_token}"
        
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
        
        response = sendgrid_client.send(message)
        return {'status': 'sent', 'status_code': response.status_code}
    except Exception as e:
        print(f"Error sending email: {e}")
        return {'status': 'error', 'message': str(e)}


# Routes - Main App
# Auth routes
@app.route('/')
def index():
    # Check if user is logged in
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')


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
    
    # Create new user
    user = User(
        name=data['name'],
        email=data['email'],
        phone_number=data['phone_number'],
        timezone=data.get('timezone', 'America/New_York')  # Default to EST
    )
    user.set_password(data['password'])
    
    db.session.add(user)
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
    
    if not email:
        return jsonify({'error': 'Email is required'}), 400
    
    # Check if user exists
    user = User.query.filter_by(email=email).first()
    
    if not user:
        # Don't reveal whether email exists or not for security
        return jsonify({'message': 'If an account exists with this email, a password reset link has been sent.'}), 200
    
    # Create password reset token
    reset = PasswordReset(
        email=email,
        expires_at=datetime.utcnow() + timedelta(hours=1)
    )
    db.session.add(reset)
    db.session.commit()
    
    # Send reset email
    send_password_reset_email(email, reset.reset_token)
    
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


@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.json
    message = data.get('message', '').strip()
    
    if not message:
        return jsonify({'error': 'Message is required'}), 400
    
    # Get user info
    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Send feedback email via SendGrid
    if not sendgrid_client or not SENDGRID_FROM_EMAIL:
        return jsonify({'error': 'Email service not configured'}), 500
    
    try:
        feedback_email = Mail(
            from_email=Email(SENDGRID_FROM_EMAIL),
            to_emails=To('hello@trygatherly.com'),
            subject=f'Feedback from {user.name}',
            html_content=f"""
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #37558C;">New Feedback from Gatherly</h2>
                    <p><strong>From:</strong> {user.name}</p>
                    <p><strong>Email:</strong> {user.email}</p>
                    <p><strong>Phone:</strong> {user.phone_number}</p>
                    <hr style="border: 1px solid #eee; margin: 20px 0;">
                    <p><strong>Message:</strong></p>
                    <p style="background: #f5f5f5; padding: 15px; border-radius: 8px; white-space: pre-wrap;">{message}</p>
                </body>
            </html>
            """
        )
        
        sendgrid_client.send(feedback_email)
        return jsonify({'message': 'Feedback sent successfully'}), 200
    except Exception as e:
        print(f"Error sending feedback email: {e}")
        return jsonify({'error': 'Failed to send feedback'}), 500


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
        # Delete all contacts owned by this user
        Contact.query.filter_by(owner_id=user_id).delete()
        
        # Delete plans where user is the planner (cascade will handle PlanGuests)
        plans = Plan.query.filter_by(planner_id=user_id).all()
        for plan in plans:
            # Delete all availabilities for this plan
            Availability.query.filter_by(week_start_date=plan.week_start_date, planner_id=plan.planner_id).delete()
            # Plan deletion
            db.session.delete(plan)
        
        # Finally delete the user
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted successfully'}), 200
    
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


# API Routes - Contacts
@app.route('/api/contacts', methods=['GET', 'POST'])
def contacts():
    owner_id = request.args.get('owner_id') or request.json.get('owner_id')
    
    if not owner_id:
        return jsonify({'error': 'owner_id required'}), 400
    
    if request.method == 'POST':
        data = request.json
        
        # Check if contact already exists for this owner
        existing_contact = Contact.query.filter_by(
            owner_id=data['owner_id'],
            phone_number=data['phone_number']
        ).first()
        
        if existing_contact:
            return jsonify(existing_contact.to_dict()), 200
        
        # Get max display_order for this owner to append new contact at the end
        max_order = db.session.query(db.func.max(Contact.display_order)).filter_by(owner_id=data['owner_id']).scalar() or 0
        
        # Create new contact
        contact = Contact(
            owner_id=data['owner_id'],
            name=data['name'],
            phone_number=data['phone_number'],
            display_order=max_order + 1
        )
        db.session.add(contact)
        db.session.commit()
        return jsonify(contact.to_dict()), 201
    
    # GET - fetch all contacts for this owner, sorted by display_order
    contacts = Contact.query.filter_by(owner_id=int(owner_id)).order_by(Contact.display_order).all()
    return jsonify([c.to_dict() for c in contacts])


@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    contact = Contact.query.get_or_404(contact_id)
    
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
