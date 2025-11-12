#!/usr/bin/env python3
"""
Add password_resets table
"""
import os
from app import app, db
from sqlalchemy import text

def add_password_resets_table():
    with app.app_context():
        try:
            # Create password_resets table
            with db.engine.connect() as conn:
                conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS password_resets (
                        id SERIAL PRIMARY KEY,
                        email VARCHAR(120) NOT NULL,
                        reset_token VARCHAR(64) UNIQUE NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        expires_at TIMESTAMP NOT NULL,
                        used BOOLEAN DEFAULT FALSE
                    )
                '''))
                conn.commit()
                print("✅ Created password_resets table")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            print("Table may already exist or database error occurred")

if __name__ == '__main__':
    add_password_resets_table()

