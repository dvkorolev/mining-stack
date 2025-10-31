#!/bin/bash
# Fix permissions for mining-stack directories
# Run this script if you encounter permission errors

set -e

PROJECT_DIR="${1:-/opt/mining-stack}"

echo "Fixing permissions for $PROJECT_DIR..."

# Fix ownership
sudo chown -R $USER:$USER "$PROJECT_DIR/etc" 2>/dev/null || true
sudo chown -R $USER:$USER "$PROJECT_DIR/logs" 2>/dev/null || true
sudo chown -R $USER:$USER "$PROJECT_DIR/bin" 2>/dev/null || true

# Set proper permissions
chmod -R 755 "$PROJECT_DIR/etc" 2>/dev/null || true
chmod -R 755 "$PROJECT_DIR/logs" 2>/dev/null || true
chmod -R 755 "$PROJECT_DIR/bin" 2>/dev/null || true

# Make scripts executable
chmod +x "$PROJECT_DIR"/*.sh 2>/dev/null || true
chmod +x "$PROJECT_DIR/bin"/*.sh 2>/dev/null || true
chmod +x "$PROJECT_DIR/bin"/*.py 2>/dev/null || true

echo "✓ Permissions fixed!"
echo ""
echo "You can now run:"
echo "  python3 bin/farm_init.py"
