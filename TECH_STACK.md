# Gatherly - Tech Stack

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐   │
│  │  HTML5   │  │   CSS3   │  │  Vanilla JavaScript    │   │
│  └──────────┘  └──────────┘  └────────────────────────┘   │
│                                                             │
│  • Responsive Design       • Real-time Updates             │
│  • Mobile-First UI         • Local Storage                 │
│  • Figma-Inspired Theme    • No Framework Dependencies     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ RESTful API (JSON)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Flask (Python 3.11)                   │    │
│  │  • Flask-SQLAlchemy  • Flask-CORS                  │    │
│  │  • python-dotenv     • gunicorn                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  • RESTful API Endpoints   • Session Management            │
│  • Business Logic          • Error Handling                │
│  • SMS Integration         • Environment Config            │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│       DATABASE           │  │      SMS SERVICE         │
│                          │  │                          │
│  PostgreSQL 14+          │  │    Twilio API            │
│                          │  │                          │
│  • Users                 │  │  • Send SMS              │
│  • Plans                 │  │  • Personalized Links    │
│  • PlanGuests            │  │  • Delivery Tracking     │
│  • Availability          │  │                          │
│                          │  │  (Mock mode available)   │
└──────────────────────────┘  └──────────────────────────┘
```

## 📦 Dependencies

### Python Backend
```
Flask==3.0.0                # Web framework
Flask-SQLAlchemy==3.1.1     # ORM for database
Flask-Cors==4.0.0           # Cross-origin support
psycopg2-binary==2.9.9      # PostgreSQL adapter
python-dotenv==1.0.0        # Environment variables
twilio==8.10.0              # SMS integration
gunicorn==21.2.0            # Production server
```

### Frontend (No Dependencies!)
- Pure HTML5
- Pure CSS3
- Vanilla JavaScript (ES6+)
- No build process needed
- No npm/webpack/babel required

## 🎨 Frontend Architecture

### HTML Structure
```
templates/
├── index.html          # Main planner interface
│   ├── Setup modal
│   ├── Add friend modal
│   ├── Calendar grid
│   └── Friend selection
│
├── guest.html          # Guest response page
│   ├── Guest info
│   ├── Calendar grid
│   └── Submit form
│
└── admin/
    ├── dashboard.html  # Stats overview
    ├── users.html      # User list
    ├── plans.html      # Plans list
    ├── plan_detail.html # Individual plan
    └── availability.html # All submissions
```

### CSS Architecture
```
static/css/
├── style.css          # Main app styles
│   ├── CSS Variables (theming)
│   ├── Mobile-first responsive
│   ├── iPhone-inspired UI
│   └── Dark mode color scheme
│
└── admin.css          # Admin dashboard styles
    ├── Data tables
    ├── Statistics cards
    ├── Calendar visualization
    └── Dashboard layout
```

### JavaScript Modules
```
static/js/
├── main.js                    # Planner logic
│   ├── State management
│   ├── Friend selection
│   ├── Calendar interaction
│   ├── Plan creation
│   └── Real-time polling
│
├── guest.js                   # Guest response
│   ├── Token validation
│   ├── Calendar interaction
│   └── Availability submission
│
└── admin/
    ├── admin-dashboard.js     # Dashboard stats
    ├── admin-users.js         # User management
    ├── admin-plans.js         # Plans overview
    ├── admin-plan-detail.js   # Plan visualization
    └── admin-availability.js  # Data explorer
```

## 🗄️ Database Schema (PostgreSQL)

### Tables & Relationships

```sql
┌─────────────────┐
│     users       │
├─────────────────┤
│ id (PK)         │◄──┐
│ name            │   │
│ phone_number    │   │
│ created_at      │   │
└─────────────────┘   │
         ▲            │
         │            │
         │            │
┌─────────────────┐   │
│     plans       │   │
├─────────────────┤   │
│ id (PK)         │   │
│ planner_id (FK) │───┘
│ week_start_date │
│ status          │
│ created_at      │
└─────────────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐
│  plan_guests    │
├─────────────────┤
│ id (PK)         │
│ plan_id (FK)    │───┐
│ guest_id (FK)   │   │
│ unique_token    │   │
│ has_responded   │   │
│ notified_at     │   │
└─────────────────┘   │
                      │
         ┌────────────┘
         │
         ▼
┌─────────────────┐
│  availability   │
├─────────────────┤
│ id (PK)         │
│ week_start_date │
│ planner_id (FK) │
│ user_id (FK)    │
│ time_slots (JSON)│
│ submitted_at    │
│ updated_at      │
└─────────────────┘
UNIQUE: (week_start_date, planner_id, user_id)
```

### JSON Structure (time_slots)
```json
[
  {"day": 0, "slot": "morning"},    // Monday morning
  {"day": 4, "slot": "afternoon"},  // Friday afternoon
  {"day": 4, "slot": "evening"},    // Friday evening
  {"day": 5, "slot": "afternoon"}   // Saturday afternoon
]
```

## 🌐 API Architecture

### RESTful Endpoints

```
Users
├── GET    /api/users              → List all users
├── POST   /api/users              → Create user
└── GET    /api/users/<id>         → Get user details

Plans
├── GET    /api/plans              → List all plans
├── POST   /api/plans              → Create plan (triggers SMS)
└── GET    /api/plans/<id>         → Get plan details

Availability
├── POST   /api/availability       → Submit availability
├── GET    /api/availability/plan/<id> → Get plan availability
└── GET    /api/guest/<token>      → Get guest context

Admin
├── GET    /api/admin/stats        → Dashboard statistics
├── GET    /api/admin/plans/<id>/details → Full plan info
└── GET    /api/admin/availability → All records
```

## 📱 External Services

### Twilio SMS API
```python
# Configuration
TWILIO_ACCOUNT_SID    # Account identifier
TWILIO_AUTH_TOKEN     # API authentication
TWILIO_PHONE_NUMBER   # Sender phone number

# Usage
client.messages.create(
    body="Hey {name}, {planner} wants to hang out...",
    from_=TWILIO_PHONE_NUMBER,
    to=guest_phone
)
```

### Mock Mode (Development)
- No Twilio credentials needed
- SMS logged to console
- Full app functionality
- Perfect for testing

## 🚀 Deployment (Railway)

### Build Process
```
1. Railway detects Python (via requirements.txt)
2. Installs dependencies (pip install -r requirements.txt)
3. Runs database migrations (automatic on startup)
4. Starts gunicorn server (Procfile)
```

### Environment
```
Runtime:         Python 3.11
Server:          Gunicorn (WSGI)
Database:        PostgreSQL (Railway managed)
Files:           Static serving via Flask
Logs:            Railway dashboard
```

### Auto-scaling
- Railway handles scaling automatically
- Gunicorn workers adjust based on traffic
- PostgreSQL connection pooling
- Stateless design for horizontal scaling

## 🔒 Security

### Data Protection
- Environment variables for secrets
- No API keys in frontend
- Unique tokens for guest access
- SQLAlchemy prevents SQL injection

### Access Control
- Token-based guest authentication
- Admin dashboard (no auth in v1)
- CORS configuration
- Rate limiting (add in production)

## 📊 Performance

### Frontend
- Minimal JavaScript (no heavy frameworks)
- CSS variables for theming
- Efficient DOM manipulation
- Local storage for planner info
- Polling every 3 seconds (configurable)

### Backend
- SQLAlchemy query optimization
- JSON fields for flexible data
- Database indexing on foreign keys
- Connection pooling
- Efficient unique constraints

### Database
- Indexed primary keys
- Foreign key indexes
- Unique constraints for data integrity
- JSON columns for flexible schema

## 🛠️ Development Tools

### Local Development
```bash
python app.py              # Dev server (Flask)
python init_db.py          # Database setup
./setup.sh                 # Automated setup
```

### Testing
```bash
# Manual testing via browser
# API testing via curl/Postman
# SMS testing via mock mode
```

### Monitoring
```bash
# Railway dashboard (production)
# Flask debug mode (development)
# PostgreSQL logs
# Twilio console
```

## 🎯 Design Patterns

### Backend
- **MVC Architecture**: Models (SQLAlchemy), Views (Templates), Controllers (Routes)
- **Repository Pattern**: Database abstraction via SQLAlchemy
- **Service Layer**: Business logic in Flask routes
- **Environment Config**: 12-factor app principles

### Frontend
- **Progressive Enhancement**: Works without JavaScript (forms)
- **State Management**: Simple object-based state
- **Event-Driven**: DOM events for user interaction
- **Polling**: Regular API checks for updates

### Database
- **Normalization**: Proper foreign key relationships
- **Denormalization**: JSON for flexibility where needed
- **Unique Constraints**: Data integrity enforcement
- **Timestamps**: Audit trail for all records

## 📈 Scalability Considerations

### Current (MVP)
- Single server
- Polling for updates
- Session-based state
- Manual admin

### Future Improvements
- WebSockets for real-time
- Redis for caching
- Queue system for SMS
- Load balancing
- CDN for static files
- Authentication system
- API rate limiting

---

**Tech Stack Summary**: Modern, lightweight, production-ready! 🚀

