#!/bin/bash

echo "🚀 Setting up Gatherly..."

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your configuration"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your database and Twilio credentials"
echo "2. Run: python init_db.py (to create database tables)"
echo "3. Run: python app.py (to start the server)"
echo ""
echo "Visit http://localhost:5000 to use the app!"

