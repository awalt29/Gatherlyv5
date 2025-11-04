#!/usr/bin/env python3
"""
Add link_clicked_at column to plan_guests table
Run this to migrate the database without losing data
"""

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def migrate():
    database_url = os.getenv('DATABASE_URL')
    
    if not database_url:
        print("❌ DATABASE_URL not found in environment")
        return
    
    # Fix Railway's postgres:// to postgresql://
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    
    print(f"🔌 Connecting to database...")
    
    try:
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor()
        
        # Check if column already exists
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='plan_guests' AND column_name='link_clicked_at';
        """)
        
        if cursor.fetchone():
            print("✅ Column 'link_clicked_at' already exists!")
        else:
            print("📝 Adding 'link_clicked_at' column to plan_guests table...")
            cursor.execute("""
                ALTER TABLE plan_guests 
                ADD COLUMN link_clicked_at TIMESTAMP;
            """)
            conn.commit()
            print("✅ Column added successfully!")
        
        cursor.close()
        conn.close()
        print("✅ Migration complete!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        if conn:
            conn.rollback()

if __name__ == '__main__':
    print("🔄 Running database migration...")
    migrate()

