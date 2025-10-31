#!/bin/bash
# Quick deployment script for Raspberry Pi - runs directly on the Pi
# Usage: ./quick-deploy.sh

set -e

echo "========================================="
echo "Mining Stack Quick Deployment"
echo "========================================="
echo ""

# Configuration
GITHUB_REPO="dvkorolev/mining-stack"
IMAGE_TAG="latest"

# Navigate to project directory
cd /opt/mining-stack || { echo "Error: /opt/mining-stack not found"; exit 1; }

echo "✅ Working directory: $(pwd)"
echo ""

# Pull latest code
echo "📥 Pulling latest configuration..."
git pull origin main || echo "Warning: Could not pull from git"
echo ""

# Setup environment
echo "⚙️  Setting up environment..."
cat > .env << EOL
GITHUB_REPOSITORY=$GITHUB_REPO
IMAGE_TAG=$IMAGE_TAG
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=*
EOL
chmod 600 .env
echo "✅ Environment configured"
echo ""

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.prod.yml down 2>/dev/null || true
echo ""

# Pull images one by one with timeout protection
echo "📥 Pulling Docker images..."
echo ""

export GITHUB_REPOSITORY=$GITHUB_REPO
export IMAGE_TAG=$IMAGE_TAG

# Pull backend (ARM64 only, might be slow)
echo "  → Pulling backend (this may take a few minutes)..."
timeout 600 docker pull ghcr.io/$GITHUB_REPO/backend:$IMAGE_TAG || {
    echo "⚠️  Backend pull timed out or failed. Will retry on startup."
}

# Pull frontend (multi-arch, should be fast)
echo "  → Pulling frontend..."
timeout 300 docker pull ghcr.io/$GITHUB_REPO/frontend:$IMAGE_TAG || {
    echo "⚠️  Frontend pull timed out or failed. Will retry on startup."
}

# Pull monitoring images
echo "  → Pulling monitoring images..."
docker pull prom/prometheus:latest &
docker pull prom/node-exporter:latest &
docker pull grafana/grafana:latest &
wait

echo ""
echo "✅ Images pulled"
echo ""

# Clean up old resources
echo "🧹 Cleaning up old Docker resources..."
docker system prune -f
echo ""

# Start services
echo "🚀 Starting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans
echo ""

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 15

# Check status
echo ""
echo "📊 Service Status:"
docker compose -f docker-compose.prod.yml ps
echo ""

# Check if services are running
RUNNING=$(docker compose -f docker-compose.prod.yml ps --services --filter "status=running" | wc -l)
if [ "$RUNNING" -lt 3 ]; then
    echo "⚠️  Warning: Not all services started. Checking logs..."
    echo ""
    docker compose -f docker-compose.prod.yml logs --tail=20
    echo ""
fi

echo "========================================="
echo "✅ Deployment Complete!"
echo "========================================="
echo ""
echo "📋 Access your services:"
IP=$(hostname -I | awk '{print $1}')
echo "  Dashboard:  http://$IP:3000"
echo "  API:        http://$IP:5000"
echo "  Prometheus: http://$IP:9090"
echo "  Grafana:    http://$IP:3001 (admin/mining123)"
echo ""
echo "📝 Useful commands:"
echo "  View logs:    docker compose -f docker-compose.prod.yml logs -f"
echo "  Restart:      docker compose -f docker-compose.prod.yml restart"
echo "  Stop:         docker compose -f docker-compose.prod.yml down"
echo "  Update:       ./update-from-registry.sh latest"
echo ""
