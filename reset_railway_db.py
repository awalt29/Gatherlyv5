#!/usr/bin/env python3
"""
Reset Railway PostgreSQL database
This connects to Railway's PostgreSQL and drops all tables
"""

import psycopg2
import sys

# Railway database connection details
DB_HOST = "hopper.proxy.rlwy.net"
DB_PORT = 50665
DB_NAME = "railway"
DB_USER = "postgres"
DB_PASSWORD = "mGVmGNVVyvepIspDyUtljRzQSIZkiMrJ"

def reset_railway_database():
    """Connect to Railway and drop all tables"""
    try:
        print(f"🔌 Connecting to Railway PostgreSQL at {DB_HOST}...")
        
        # Connect to the database
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        
        # Create a cursor
        cur = conn.cursor()
        
        print("🗑️  Dropping all tables...")
        
        # Drop all tables
        drop_commands = [
            "DROP TABLE IF EXISTS notifications CASCADE;",
            "DROP TABLE IF EXISTS availability CASCADE;",
            "DROP TABLE IF EXISTS plan_guests CASCADE;",
            "DROP TABLE IF EXISTS plans CASCADE;",
            "DROP TABLE IF EXISTS contacts CASCADE;",
            "DROP TABLE IF EXISTS users CASCADE;"
        ]
        
        for cmd in drop_commands:
            cur.execute(cmd)
            print(f"   ✅ {cmd}")
        
        # Commit the changes
        conn.commit()
        
        print("\n✅ All tables dropped successfully!")
        print("🔄 Now restart your Railway web service to recreate tables with the new schema.")
        
        # Close the connection
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if '--force' in sys.argv:
        reset_railway_database()
    else:
        print("⚠️  WARNING: This will delete ALL data in the Railway database!")
        print("Run with --force flag to proceed: python3 reset_railway_db.py --force")

