#!/usr/bin/env python3
"""Add message column to availability table"""

import os
from app import app, db
from sqlalchemy import text

with app.app_context():
    try:
        # Try to add the column
        with db.engine.connect() as conn:
            conn.execute(text('ALTER TABLE availability ADD COLUMN message VARCHAR(200)'))
            conn.commit()
        print("✅ Added message column to availability table")
    except Exception as e:
        if "already exists" in str(e).lower():
            print("✅ Column already exists, no action needed")
        else:
            print(f"❌ Error: {e}")

