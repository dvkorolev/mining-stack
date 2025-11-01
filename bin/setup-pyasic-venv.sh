#!/bin/bash
# Setup Python virtual environment for pyasic
# Run this script on the Raspberry Pi

set -e

PROJECT_DIR="${1:-/opt/mining-stack}"
VENV_DIR="$PROJECT_DIR/venv"

echo "🔍 Checking Python and pyasic installation..."
echo ""

# Check if Python 3 is installed
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✓ Python 3 is installed: $PYTHON_VERSION"
else
    echo "✗ Python 3 is not installed"
    NEED_PYTHON=true
fi

# Check if venv module is available
if python3 -m venv --help &> /dev/null 2>&1; then
    echo "✓ Python venv module is available"
else
    echo "✗ Python venv module is not available"
    NEED_PYTHON=true
fi

# Check if virtual environment exists
if [ -d "$VENV_DIR" ]; then
    echo "✓ Virtual environment exists at $VENV_DIR"
    VENV_EXISTS=true
else
    echo "✗ Virtual environment not found"
    VENV_EXISTS=false
fi

# Check if pyasic is installed in venv
if [ "$VENV_EXISTS" = true ]; then
    if "$VENV_DIR/bin/python3" -c "import pyasic" 2>/dev/null; then
        PYASIC_VERSION=$("$VENV_DIR/bin/python3" -c "import pyasic; print(pyasic.__version__)" 2>/dev/null || echo "unknown")
        echo "✓ pyasic is installed (version: $PYASIC_VERSION)"
        PYASIC_INSTALLED=true
    else
        echo "✗ pyasic is not installed in virtual environment"
        PYASIC_INSTALLED=false
    fi
else
    PYASIC_INSTALLED=false
fi

echo ""

# If everything is already installed, skip
if [ "$VENV_EXISTS" = true ] && [ "$PYASIC_INSTALLED" = true ] && [ "$NEED_PYTHON" != true ]; then
    echo "✅ Everything is already installed!"
    echo ""
    echo "Virtual environment: $VENV_DIR"
    echo "pyasic version: $PYASIC_VERSION"
    echo ""
    echo "To test miner discovery:"
    echo "  source $VENV_DIR/bin/activate"
    echo "  python3 bin/farm_init.py"
    exit 0
fi

# Install what's needed
echo "📦 Installing missing components..."
echo ""

# Install system packages if needed
if [ "$NEED_PYTHON" = true ]; then
    echo "Installing Python and system dependencies..."
    sudo apt-get update
    sudo apt-get install -y python3-full python3-venv python3-pip
    echo "✓ System dependencies installed"
else
    echo "✓ System dependencies already installed"
fi

# Create virtual environment if needed
if [ "$VENV_EXISTS" = false ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi

# Install/upgrade Python packages
echo "Installing/upgrading Python packages..."
source "$VENV_DIR/bin/activate"

# Upgrade pip
pip install --upgrade pip --quiet

# Install pyasic and dependencies
if [ "$PYASIC_INSTALLED" = false ]; then
    echo "Installing pyasic, pyyaml, and netifaces..."
    pip install pyasic pyyaml netifaces
    echo "✓ Python packages installed"
else
    echo "Checking for updates..."
    pip install --upgrade pyasic pyyaml netifaces --quiet
    echo "✓ Python packages up to date"
fi

# Verify installation
echo ""
echo "🧪 Verifying installation..."
if python3 -c "import pyasic; import yaml; import netifaces" 2>/dev/null; then
    PYASIC_VERSION=$(python3 -c "import pyasic; print(pyasic.__version__)")
    echo "✓ All packages verified"
    echo "  - pyasic: $PYASIC_VERSION"
else
    echo "✗ Verification failed"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Virtual environment: $VENV_DIR"
echo ""
echo "Next steps:"
echo "  1. Test miner discovery:"
echo "     source $VENV_DIR/bin/activate"
echo "     python3 bin/farm_init.py"
echo ""
echo "  2. Setup automatic metrics collection:"
echo "     ./bin/setup-metrics-cron.sh"
echo ""
