#!/usr/bin/env python3
"""
Database reset script for Railway PostgreSQL
This will drop all tables and recreate them with the new schema
"""

from app import app, db
import sys

def reset_database():
    """Drop all tables and recreate them"""
    with app.app_context():
        print("🗑️  Dropping all tables...")
        db.drop_all()
        print("✅ All tables dropped successfully!")
        
        print("🔨 Creating new tables with updated schema...")
        db.create_all()
        print("✅ Database recreated successfully!")
        
        # List all tables
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"\n📋 Created {len(tables)} tables:")
        for table in tables:
            print(f"   - {table}")

if __name__ == '__main__':
    # Check for --force flag
    if '--force' in sys.argv:
        reset_database()
        print("\n✅ Database reset complete! You can now sign up with email/password.")
    else:
        print("⚠️  WARNING: This will delete ALL data in the database!")
        print("Run with --force flag to proceed: python3 reset_db.py --force")

