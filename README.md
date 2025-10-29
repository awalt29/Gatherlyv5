# Gatherly - Hangout Planning App

A simple and beautiful web app for quickly gathering availability from friends to plan hangouts.

## Features

- 📅 Visual calendar interface for selecting availability
- 👥 Easy friend management
- 📱 SMS notifications via Twilio
- 🔄 Real-time availability updates
- 📊 Admin dashboard for monitoring all plans and users
- 💾 PostgreSQL database for reliable data storage

## Tech Stack

- **Backend**: Python with Flask
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Database**: PostgreSQL
- **SMS**: Twilio API
- **Hosting**: Railway

## Local Development Setup

### Prerequisites

- Python 3.11+
- PostgreSQL database
- Twilio account (for SMS functionality)

### Installation

1. Clone the repository:
```bash
cd gatherly
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```
DATABASE_URL=postgresql://user:password@localhost:5432/gatherly
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
APP_BASE_URL=http://localhost:5000
FLASK_ENV=development
SECRET_KEY=your_secret_key_here
```

5. Initialize the database:
```bash
python app.py
# Database tables will be created automatically on first run
```

6. Run the development server:
```bash
python app.py
```

Visit `http://localhost:5000` in your browser.

## Railway Deployment

### Step 1: Provision PostgreSQL Database

1. Go to your Railway project
2. Click "New" → "Database" → "PostgreSQL"
3. Railway will automatically create a `DATABASE_URL` environment variable

### Step 2: Configure Environment Variables

In Railway, add the following environment variables:

- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number (format: +1234567890)
- `APP_BASE_URL` - Your Railway app URL (e.g., https://gatherly.up.railway.app)
- `SECRET_KEY` - A random secret key for Flask sessions

### Step 3: Deploy

1. Connect your GitHub repository to Railway
2. Railway will automatically detect the Python app and deploy using the `Procfile`
3. The database tables will be created automatically on first deployment

## Usage

### For Planners

1. Visit the app and enter your name and phone number
2. Add friends by clicking the "+" button
3. Select your available time slots on the calendar
4. Click "PLAN" to send SMS invites to selected friends
5. Watch as friends respond and their availability appears on your calendar

### For Guests

1. Receive an SMS with a unique link
2. Click the link to open the availability page
3. Select your available time slots
4. Submit your availability

### Admin Dashboard

Visit `/admin` to access the admin dashboard where you can:

- View statistics (total users, plans, response rates)
- Browse all users
- View all plans and their details
- See all availability submissions
- Visualize combined availability for each plan

## Database Schema

### User
- Stores user information (name, phone number)
- Used for both planners and guests

### Plan
- Represents a planning session
- Links to planner and contains week information

### PlanGuest
- Junction table linking guests to plans
- Contains unique token for guest access links
- Tracks response status

### Availability
- Stores time slot selections
- Unique per (week, planner, user) combination
- Uses JSON field for flexible slot storage

## SMS Integration

The app uses Twilio for sending SMS messages. If Twilio credentials are not configured, the app will run in "mock mode" and print SMS messages to the console instead of sending them.

To enable SMS:
1. Sign up for Twilio at https://www.twilio.com
2. Get a phone number
3. Add your credentials to the `.env` file

## URL Structure

- `/` - Main planner interface
- `/guest/<token>` - Guest availability submission page
- `/admin` - Admin dashboard
- `/admin/users` - User management
- `/admin/plans` - Plans overview
- `/admin/plans/<id>` - Detailed plan view
- `/admin/availability` - Availability records

## API Endpoints

### Users
- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `GET /api/users/<id>` - Get user details

### Plans
- `GET /api/plans` - List all plans
- `POST /api/plans` - Create new plan (and send invites)
- `GET /api/plans/<id>` - Get plan details

### Availability
- `POST /api/availability` - Submit availability
- `GET /api/availability/plan/<id>` - Get all availability for a plan
- `GET /api/guest/<token>` - Get guest info from token

### Admin
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/plans/<id>/details` - Detailed plan information
- `GET /api/admin/availability` - All availability records

## Contributing

This is a simple project built for quick hangout planning. Feel free to fork and customize for your needs!

## License

MIT License - feel free to use this project however you'd like!

