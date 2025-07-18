#!/bin/bash

# Build script for Render deployment
echo "Starting build process..."

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Initialize database
echo "Initializing database..."
python -c "from db import init_db; init_db()"

echo "Build completed successfully!"
