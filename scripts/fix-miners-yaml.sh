#!/bin/bash
# Fix miners.yaml to add 'name' field for V2 scheduler
# This script adds the 'name' field to each miner entry using the 'alias' value

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MINERS_FILE="${1:-$PROJECT_ROOT/etc/miners.yaml}"

echo "🔧 Fixing miners.yaml configuration..."
echo "File: $MINERS_FILE"
echo ""

# Check if file exists
if [ ! -f "$MINERS_FILE" ]; then
    echo "❌ Error: miners.yaml not found at $MINERS_FILE"
    exit 1
fi

# Create backup
BACKUP_FILE="${MINERS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$MINERS_FILE" "$BACKUP_FILE"
echo "✓ Backup created: $BACKUP_FILE"

# Check if 'name' field already exists
if grep -q "^  name:" "$MINERS_FILE"; then
    echo "⚠️  Warning: 'name' field already exists in some entries"
    echo "   Proceeding with caution..."
fi

# Use Python to parse and fix the YAML properly
python3 << 'EOF'
import yaml
import sys

miners_file = sys.argv[1] if len(sys.argv) > 1 else 'etc/miners.yaml'

try:
    # Read the YAML file
    with open(miners_file, 'r') as f:
        config = yaml.safe_load(f)
    
    if not config or 'miners' not in config:
        print("❌ Error: Invalid miners.yaml format")
        sys.exit(1)
    
    # Track changes
    added_count = 0
    updated_count = 0
    
    # Process each miner
    for miner in config['miners']:
        if 'name' not in miner:
            # Add 'name' field using 'alias' or 'ip' as fallback
            if 'alias' in miner:
                miner['name'] = miner['alias']
                added_count += 1
            elif 'ip' in miner:
                miner['name'] = f"miner-{miner['ip'].replace('.', '-')}"
                added_count += 1
            else:
                print(f"⚠️  Warning: Miner has no alias or IP, skipping")
        else:
            updated_count += 1
    
    # Write back to file with proper formatting
    with open(miners_file, 'w') as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False, indent=2)
    
    print(f"✓ Processed {len(config['miners'])} miners")
    print(f"  - Added 'name' field: {added_count}")
    print(f"  - Already had 'name': {updated_count}")
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)

EOF "$MINERS_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ miners.yaml fixed successfully!"
    echo ""
    echo "Changes made:"
    echo "  - Added 'name' field to miners (using 'alias' value)"
    echo "  - Backup saved to: $BACKUP_FILE"
    echo ""
    echo "Next steps:"
    echo "  1. Review the changes: diff $BACKUP_FILE $MINERS_FILE"
    echo "  2. Restart scheduler: docker compose -f docker-compose.prod.yml restart python-scheduler"
    echo "  3. Check status: curl http://localhost:8000/status | jq ."
    echo ""
else
    echo ""
    echo "❌ Failed to fix miners.yaml"
    echo "Restoring backup..."
    cp "$BACKUP_FILE" "$MINERS_FILE"
    echo "✓ Backup restored"
    exit 1
fi
