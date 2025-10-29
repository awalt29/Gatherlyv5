# Gatherly - Project Overview

## 🎉 Project Complete!

Your hangout planning web app has been fully built and is ready to deploy!

## 📁 Project Structure

```
gatherly/
├── app.py                          # Main Flask application
├── models.py                       # Database models
├── init_db.py                      # Database initialization script
├── requirements.txt                # Python dependencies
├── runtime.txt                     # Python version for deployment
├── Procfile                        # Railway/Heroku deployment config
├── railway.json                    # Railway-specific config
├── setup.sh                        # Local setup script
├── .env                           # Environment variables (local dev)
├── .env.example                   # Environment template
├── .gitignore                     # Git ignore rules
├── README.md                      # Full documentation
│
├── static/
│   ├── css/
│   │   ├── style.css             # Main app styles (Figma-inspired)
│   │   └── admin.css             # Admin dashboard styles
│   └── js/
│       ├── main.js               # Planner interface logic
│       ├── guest.js              # Guest response logic
│       ├── admin-dashboard.js    # Admin home page
│       ├── admin-users.js        # Admin users page
│       ├── admin-plans.js        # Admin plans page
│       ├── admin-plan-detail.js  # Admin plan details
│       └── admin-availability.js # Admin availability page
│
└── templates/
    ├── index.html                 # Main planner interface
    ├── guest.html                 # Guest availability page
    └── admin/
        ├── dashboard.html         # Admin dashboard
        ├── users.html             # Admin users view
        ├── plans.html             # Admin plans list
        ├── plan_detail.html       # Admin plan details
        └── availability.html      # Admin availability records
```

## 🎨 Design Implementation

The app closely matches your Figma design with:
- Dark navy blue theme (#2C3E5F)
- Mint/turquoise accents (#7FE7DC)
- iPhone-inspired mobile interface
- Circular friend avatars with initials
- Interactive calendar grid (7 days × 3 time slots)
- Smooth transitions and hover effects
- Responsive design for all screen sizes

## 🔑 Key Features

### For Planners
1. **Setup**: Enter name and phone number (stored in localStorage)
2. **Add Friends**: Build your friend list with names and phone numbers
3. **Select Availability**: Click calendar slots to mark when you're free
4. **Send Invites**: Click "PLAN" to send SMS invites to selected friends
5. **Real-time Updates**: See friends' availability as they respond
6. **Visual Overlay**: Multiple responses shown with user count badges

### For Guests
1. **Receive SMS**: Get personalized link via text message
2. **View Context**: See who invited them and for which week
3. **Select Times**: Interactive calendar to pick available slots
4. **Submit**: One-click submission of availability
5. **Update Anytime**: Can resubmit to update their availability

### Admin Dashboard
1. **Statistics**: Total users, plans, active plans, response rates
2. **User Management**: View all registered users
3. **Plans Overview**: See all plans with status and response tracking
4. **Plan Details**: Deep dive into specific plans with visual calendar
5. **Availability Records**: Raw data view of all submissions

## 🗄️ Database Schema

### User
- Stores all users (planners and guests)
- Fields: id, name, phone_number, created_at

### Plan
- Represents each planning session
- Fields: id, planner_id, week_start_date, status, created_at
- Status: draft, active, completed, cancelled

### PlanGuest
- Links guests to plans with unique access tokens
- Fields: id, plan_id, guest_id, unique_token, has_responded, notified_at
- Each guest gets a unique URL token

### Availability
- Stores time slot selections
- Fields: id, week_start_date, planner_id, user_id, time_slots (JSON), submitted_at, updated_at
- Unique constraint: (week_start_date, planner_id, user_id)
- Allows updates if same guest receives multiple requests for same week

## 🚀 Quick Start

### Local Development

1. **Setup**:
   ```bash
   ./setup.sh
   ```

2. **Configure** `.env`:
   - Set DATABASE_URL to your PostgreSQL connection
   - Add Twilio credentials (or leave empty for mock mode)
   - Set APP_BASE_URL

3. **Initialize Database**:
   ```bash
   python init_db.py
   ```

4. **Run**:
   ```bash
   python app.py
   ```

5. **Visit**: http://localhost:5000

### Railway Deployment

1. **Create Railway Project**:
   - Connect GitHub repository
   - Add PostgreSQL database (automatic DATABASE_URL)

2. **Set Environment Variables**:
   ```
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_PHONE_NUMBER=+1234567890
   APP_BASE_URL=https://your-app.up.railway.app
   SECRET_KEY=random-secret-key
   ```

3. **Deploy**:
   - Railway auto-deploys on git push
   - Database tables created automatically

## 📱 SMS Integration

The app uses Twilio for SMS. Without credentials, it runs in "mock mode":
- SMS messages printed to console
- App fully functional except actual SMS sending
- Perfect for development/testing

To enable real SMS:
1. Sign up at https://www.twilio.com
2. Get a phone number
3. Add credentials to environment variables

## 🔗 URL Structure

| URL | Purpose |
|-----|---------|
| `/` | Main planner interface |
| `/guest/<token>` | Guest availability page |
| `/admin` | Admin dashboard |
| `/admin/users` | User management |
| `/admin/plans` | Plans overview |
| `/admin/plans/<id>` | Plan details |
| `/admin/availability` | All availability records |

## 🌐 API Endpoints

### Users
- `GET /api/users` - List all users
- `POST /api/users` - Create user
- `GET /api/users/<id>` - Get user

### Plans
- `GET /api/plans` - List plans
- `POST /api/plans` - Create plan & send invites
- `GET /api/plans/<id>` - Get plan

### Availability
- `POST /api/availability` - Submit availability
- `GET /api/availability/plan/<id>` - Get plan availability
- `GET /api/guest/<token>` - Get guest info

### Admin
- `GET /api/admin/stats` - Dashboard stats
- `GET /api/admin/plans/<id>/details` - Plan details
- `GET /api/admin/availability` - All availability

## 🎯 User Flow Example

1. **Aaron (Planner)**:
   - Opens app, enters name and phone
   - Adds friends: Jude, Mike, Sarah
   - Selects available: Friday evening, Saturday afternoon, Sunday afternoon
   - Clicks "PLAN"

2. **System**:
   - Creates plan in database
   - Generates unique tokens for each guest
   - Sends SMS to each friend:
     "Hey Jude, Aaron wants to hang out this week! Share your availability: https://trygatherly.com/guest/abc123..."

3. **Jude (Guest)**:
   - Clicks link in SMS
   - Sees: "Aaron wants to hang out this week!"
   - Selects: Friday evening, Saturday all day
   - Submits

4. **Aaron's View Updates**:
   - Friday evening now shows "2" (Aaron + Jude)
   - Saturday afternoon shows "2"
   - Sunday afternoon shows "1" (just Aaron)
   - Can see optimal times for the hangout!

## 🎨 Design Highlights

- **Mobile-First**: Optimized for phone usage (where people text)
- **Visual Clarity**: Color-coded slots make availability obvious
- **Minimal Friction**: Few steps from invite to response
- **Real-time Feel**: Polling shows updates without manual refresh
- **Professional**: Clean, modern aesthetic matching popular apps

## 🔒 Security Considerations

- Unique tokens for guest access (prevents unauthorized responses)
- No public API keys exposed in frontend
- Environment variables for sensitive data
- PostgreSQL prevents SQL injection via SQLAlchemy ORM

## 📈 Future Enhancements (Ideas)

- User accounts with login
- Email notifications as alternative to SMS
- Multiple week planning
- Recurring hangouts
- Group chat integration
- Calendar export (iCal)
- Time zone support
- Mobile app (React Native)

## 🐛 Troubleshooting

**Database Connection Issues**:
- Verify DATABASE_URL format: `postgresql://user:pass@host:port/dbname`
- Ensure PostgreSQL is running
- Check firewall/network settings

**SMS Not Sending**:
- Verify Twilio credentials
- Check phone number format (+1234567890)
- Review Twilio console for errors
- Ensure trial account has verified numbers

**Port Already in Use**:
```bash
# Find process using port 5000
lsof -i :5000
# Kill if needed
kill -9 <PID>
```

## 📞 Support

For issues or questions:
1. Check README.md
2. Review Railway logs for deployment issues
3. Check browser console for frontend errors
4. Review Flask logs for backend errors

---

**Built with ❤️ for bringing friends together!**

