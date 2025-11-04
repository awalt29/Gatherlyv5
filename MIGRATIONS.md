# Database Migrations Guide

Flask-Migrate is now set up! This allows you to modify the database schema without losing data.

## How It Works

Instead of resetting the database when you add/modify columns, you create a **migration** that updates the schema automatically.

## Common Commands

### 1. After Changing Models (models.py)

When you add a new column or modify the database schema:

```bash
# Activate virtual environment
source venv/bin/activate

# Create a migration (auto-detects changes)
flask db migrate -m "Description of changes"

# Apply the migration to database
flask db upgrade
```

### 2. Check Migration Status

```bash
flask db current  # Show current migration
flask db history  # Show all migrations
```

### 3. Rollback Changes

```bash
flask db downgrade  # Undo last migration
```

## Example: Adding a New Column

**Before** (what we used to do):
1. Add column to `models.py`
2. Reset entire database (lose all data)
3. Recreate tables

**Now** (with migrations):
1. Add column to `models.py`:
   ```python
   new_field = db.Column(db.String(100), nullable=True)
   ```

2. Create migration:
   ```bash
   flask db migrate -m "Add new_field to User table"
   ```

3. Apply migration (keeps existing data):
   ```bash
   flask db upgrade
   ```

## Railway Deployment

When deploying to Railway with schema changes:

1. Modify `models.py`
2. Create migration locally: `flask db migrate -m "description"`
3. Commit and push to GitHub (includes migrations folder)
4. Railway will auto-deploy
5. **Important**: After Railway deploys, you need to run migrations on Railway:
   - Option A: Add to `Procfile`: `web: flask db upgrade && gunicorn app:app`
   - Option B: Run manually via Railway console

## Current Status

✅ Flask-Migrate is installed and configured
✅ Initial migration created (captures current schema)
✅ Migrations folder is tracked in git

Next schema changes will use migrations instead of database resets!

## Tips

- Always create a migration **before** pushing to production
- Migration names should be descriptive
- Test migrations locally first
- The `migrations/` folder should be in git

