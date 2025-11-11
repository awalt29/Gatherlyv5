#!/usr/bin/env python3
"""Clear all availability records to start fresh"""

import os
from app import app, db
from models import Availability

with app.app_context():
    count = Availability.query.count()
    Availability.query.delete()
    db.session.commit()
    print(f"✅ Cleared {count} availability records")

