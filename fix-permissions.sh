#!/bin/bash
# Fix permissions and create required directories for mining-stack

set -e

echo "🔧 Fixing Mining Stack permissions and directories..."

# Create required directories
echo "📁 Creating required directories..."
mkdir -p ./data
mkdir -p ./logs
mkdir -p ./etc

# Set proper permissions
echo "🔐 Setting permissions..."
chmod -R 755 ./data
chmod -R 755 ./logs
chmod -R 755 ./etc

# Create miners.yaml if it doesn't exist
if [ ! -f ./etc/miners.yaml ]; then
    echo "📝 Creating default miners.yaml..."
    cat > ./etc/miners.yaml << 'EOF'
miners:
  - name: "miner-1"
    ip: "192.168.1.100"
    model: "Antminer S19j Pro"
    alias: "Miner 1"
    owner: "Farm Owner"
  - name: "miner-2"
    ip: "192.168.1.101"
    model: "Antminer S19j Pro"
    alias: "Miner 2"
    owner: "Farm Owner"
EOF
    chmod 644 ./etc/miners.yaml
fi

# Fix ownership (run as current user)
echo "👤 Fixing ownership..."
sudo chown -R $(id -u):$(id -g) ./data ./logs ./etc 2>/dev/null || true

echo "✅ Permissions fixed!"
echo ""
echo "Directory structure:"
ls -la ./data ./logs ./etc 2>/dev/null || true
