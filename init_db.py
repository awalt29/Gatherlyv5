"""
Database initialization script
Run this to create all database tables
"""
from app import app, db

def init_database():
    with app.app_context():
        # Create all tables
        db.create_all()
        print("✓ Database tables created successfully!")
        
        # Print table names
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        print("\nCreated tables:")
        for table in tables:
            print(f"- {table}")

if __name__ == '__main__':
    init_database()

