#!/bin/bash
# Setup Python virtual environment for pyasic
# Run this script on the Raspberry Pi

set -e

PROJECT_DIR="${1:-/opt/mining-stack}"

echo "Setting up Python virtual environment for pyasic..."

# Install required system packages
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y python3-full python3-venv python3-pip

# Create virtual environment
VENV_DIR="$PROJECT_DIR/venv"
if [ -d "$VENV_DIR" ]; then
    echo "✓ Virtual environment already exists at $VENV_DIR"
else
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "✓ Virtual environment created"
fi

# Activate and install packages
echo "Installing pyasic and dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install pyasic pyyaml

echo ""
echo "✅ Setup complete!"
echo ""
echo "Virtual environment location: $VENV_DIR"
echo ""
echo "To use pyasic manually:"
echo "  source $VENV_DIR/bin/activate"
echo "  python bin/pyasic_textfile.py"
echo ""
echo "Next step: Run setup-metrics-cron.sh to configure automatic collection"
