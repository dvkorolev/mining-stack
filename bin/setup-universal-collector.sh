#!/bin/bash
# Setup Universal Miner Collector
# Works with all miner types: Antminer, Whatsminer, DG1+, etc.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Setting up Universal Miner Collector ==="
echo "Project root: $PROJECT_ROOT"

# Create virtual environment if it doesn't exist
if [ ! -d "$PROJECT_ROOT/venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$PROJECT_ROOT/venv"
fi

# Activate virtual environment
source "$PROJECT_ROOT/venv/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install minimal dependencies for universal collector
echo "Installing collector dependencies..."
pip install -r "$SCRIPT_DIR/requirements-collector.txt"

# Make collector executable
chmod +x "$SCRIPT_DIR/universal_miner_collector.py"

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Create textfile directory
mkdir -p "$PROJECT_ROOT/textfile"

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Test the collector:"
echo "  cd $PROJECT_ROOT"
echo "  ./bin/universal_miner_collector.py"
echo ""
echo "Set up cron job (runs every 2 minutes):"
echo "  crontab -e"
echo "  Add line:"
echo "  */2 * * * * cd $PROJECT_ROOT && ./venv/bin/python3 bin/universal_miner_collector.py >> logs/collector.log 2>&1"
echo ""
