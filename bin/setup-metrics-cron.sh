#!/bin/bash
# Setup cron job for pyasic metrics collection
# Run this script on the Raspberry Pi to enable automatic metrics collection

set -e

PROJECT_DIR="${1:-/opt/mining-stack}"

echo "Setting up pyasic metrics collection..."

# Create textfile directory
mkdir -p "$PROJECT_DIR/textfile"
chmod 755 "$PROJECT_DIR/textfile"

# Make pyasic script executable
chmod +x "$PROJECT_DIR/bin/pyasic_textfile.py"

# Add cron job (runs every 2 minutes)
CRON_JOB="*/2 * * * * cd $PROJECT_DIR && /usr/bin/python3 bin/pyasic_textfile.py >> logs/pyasic_metrics.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "pyasic_textfile.py"; then
    echo "✓ Cron job already exists"
else
    # Add cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✓ Cron job added (runs every 2 minutes)"
fi

# Run once immediately to create initial metrics
echo "Running initial metrics collection..."
cd "$PROJECT_DIR" && python3 bin/pyasic_textfile.py

echo ""
echo "✅ Metrics collection setup complete!"
echo ""
echo "Metrics will be collected every 2 minutes and saved to:"
echo "  $PROJECT_DIR/textfile/pyasic_metrics.prom"
echo ""
echo "To view cron jobs:"
echo "  crontab -l"
echo ""
echo "To view metrics log:"
echo "  tail -f $PROJECT_DIR/logs/pyasic_metrics.log"
