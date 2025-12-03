-- Migration for Friend System and Weekly Availability
-- Run this in Railway PostgreSQL Database → Data tab → Query

-- 1. Add weekly_availability_date to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_availability_date DATE;

-- 2. Create friend_requests table
CREATE TABLE IF NOT EXISTS friend_requests (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP,
    UNIQUE(from_user_id, to_user_id)
);

-- 3. Create friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id_1 INTEGER NOT NULL REFERENCES users(id),
    user_id_2 INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id_1, user_id_2)
);

-- 4. Create user_availability table
CREATE TABLE IF NOT EXISTS user_availability (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_start_date DATE NOT NULL,
    time_slots JSON NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start_date)
);

-- 5. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user_id_1);
CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user_id_2);
CREATE INDEX IF NOT EXISTS idx_user_availability_user ON user_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_user_availability_week ON user_availability(week_start_date);

