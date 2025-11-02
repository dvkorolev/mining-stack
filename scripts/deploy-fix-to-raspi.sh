#!/bin/bash
# Deploy miners.yaml fix to Raspberry Pi and restart services
# Usage: ./scripts/deploy-fix-to-raspi.sh [user@host]

set -e

RASPI_HOST="${1:-admin@192.168.1.66}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying miners.yaml fix to Raspberry Pi..."
echo "Target: $RASPI_HOST"
echo ""

# Step 1: Copy the fix script to Raspberry Pi
echo "📤 [1/5] Uploading fix script..."
scp "$SCRIPT_DIR/fix-miners-yaml.sh" "$RASPI_HOST:/opt/mining-stack/scripts/"
echo "✓ Script uploaded"
echo ""

# Step 2: Make it executable
echo "🔧 [2/5] Making script executable..."
ssh "$RASPI_HOST" "chmod +x /opt/mining-stack/scripts/fix-miners-yaml.sh"
echo "✓ Script is executable"
echo ""

# Step 3: Run the fix script
echo "🔨 [3/5] Running fix script on Raspberry Pi..."
ssh "$RASPI_HOST" "cd /opt/mining-stack && ./scripts/fix-miners-yaml.sh"
echo ""

# Step 4: Restart python-scheduler
echo "🔄 [4/5] Restarting python-scheduler..."
ssh "$RASPI_HOST" "cd /opt/mining-stack && docker compose -f docker-compose.prod.yml restart python-scheduler"
echo "✓ Scheduler restarted"
echo ""

# Step 5: Wait and verify
echo "⏳ [5/5] Waiting for scheduler to start (10 seconds)..."
sleep 10

echo "🔍 Checking scheduler status..."
ssh "$RASPI_HOST" "curl -s http://localhost:8000/status | jq ."
echo ""

echo "🔍 Checking backend stats..."
ssh "$RASPI_HOST" "curl -s http://localhost:5000/api/mining/stats | jq '{totalHashrate, activeMiners, timestamp}'"
echo ""

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Monitor scheduler logs: ssh $RASPI_HOST 'docker logs -f mining-stack-python-scheduler-1'"
echo "  2. Check for successful collection (wait 2 minutes)"
echo "  3. Verify metrics: curl http://192.168.1.66:8000/metrics"
echo "  4. Check dashboard: http://192.168.1.66:3000"
echo ""
