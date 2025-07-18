#!/bin/bash

# Start script for Render deployment
echo "Starting Flask application..."

# Set production environment
export FLASK_ENV=production
export FLASK_DEBUG=False

# Start the application
python app.py
