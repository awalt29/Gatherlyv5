from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_cors import CORS
from models import db, User, Contact, Plan, PlanGuest, Availability, Notification
from datetime import datetime, timedelta
from twilio.rest import Client
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
CORS(app, supports_credentials=True)

# Twilio setup
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')
APP_BASE_URL = os.getenv('APP_BASE_URL', 'http://localhost:5000')

twilio_client = None
if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


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
        
        # Create new contact
        contact = Contact(
            owner_id=data['owner_id'],
            name=data['name'],
            phone_number=data['phone_number']
        )
        db.session.add(contact)
        db.session.commit()
        return jsonify(contact.to_dict()), 201
    
    # GET - fetch all contacts for this owner
    contacts = Contact.query.filter_by(owner_id=int(owner_id)).all()
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
    
    # Save planner's availability (update if exists)
    if data.get('planner_availability'):
        availability = Availability.query.filter_by(
            week_start_date=week_start,
            planner_id=planner.id,
            contact_id=None  # Planner's own availability
        ).first()
        
        if availability:
            # Update existing
            availability.time_slots = data['planner_availability']
            availability.updated_at = datetime.utcnow()
        else:
            # Create new
            availability = Availability(
                week_start_date=week_start,
                planner_id=planner.id,
                contact_id=None,  # Planner's own availability
                time_slots=data['planner_availability']
            )
            db.session.add(availability)
    
    # Add guests and send notifications
    contact_ids = data.get('contact_ids', [])
    print(f"[DEBUG] Processing {len(contact_ids)} contacts")
    for contact_id in contact_ids:
        contact = db.session.get(Contact, contact_id)
        if not contact:
            continue
        
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
        message = f"Hey {contact.name}, {planner.name} wants to hang out this week! Share your availability: {guest_url}"
        send_sms(contact.phone_number, message)
    
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
        
        if availability:
            availability.time_slots = data['time_slots']
            availability.updated_at = datetime.utcnow()
        else:
            availability = Availability(
                week_start_date=plan.week_start_date,
                planner_id=plan.planner_id,
                contact_id=plan_guest.contact_id,
                time_slots=data['time_slots']
            )
            db.session.add(availability)
        
        plan_guest.has_responded = True
        
        # Create notification for planner
        contact = db.session.get(Contact, plan_guest.contact_id)
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
                
                notification = Notification(
                    planner_id=plan.planner_id,
                    contact_id=contact.id,
                    message=message
                )
                db.session.add(notification)
        elif contact:
            # No availability shared
            message = f"is not available this week"
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
        db.create_all()
        print("✅ Database tables created successfully!")
    except Exception as e:
        print(f"⚠️ Error creating database tables: {e}")


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
