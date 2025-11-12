#!/usr/bin/env python3
"""
Add display_order column to contacts table
"""
import os
from app import app, db
from sqlalchemy import text

def add_display_order_column():
    with app.app_context():
        try:
            # Add display_order column with default value 0
            with db.engine.connect() as conn:
                conn.execute(text('ALTER TABLE contacts ADD COLUMN display_order INTEGER DEFAULT 0'))
                conn.commit()
                print("✅ Added display_order column to contacts table")
                
                # Set display_order based on creation order (older contacts first)
                conn.execute(text('''
                    UPDATE contacts 
                    SET display_order = sub.row_num 
                    FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at) - 1 as row_num 
                        FROM contacts
                    ) sub 
                    WHERE contacts.id = sub.id
                '''))
                conn.commit()
                print("✅ Set display_order values based on creation date")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            print("Column may already exist or database error occurred")

if __name__ == '__main__':
    add_display_order_column()

