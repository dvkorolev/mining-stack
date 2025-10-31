#!/bin/bash
# Simple update script for Raspberry Pi
# Usage: ./update.sh [branch_name]
# Default branch: main

set -e

PROJECT_DIR="/opt/mining-stack"
BRANCH="${1:-main}"

echo "==================================="
echo "Mining Stack Update Script"
echo "==================================="
echo ""

# Navigate to project directory
cd "$PROJECT_DIR" || exit 1

# Check for local changes
if ! git diff-index --quiet HEAD --; then
    echo ">> Local changes detected, stashing..."
    git stash push -m "Auto-stash before update $(date +%Y-%m-%d_%H:%M:%S)"
fi

# Pull latest changes
echo ">> Pulling latest changes from git (branch: $BRANCH)..."
git pull origin "$BRANCH"

# Stop containers
echo ">> Stopping containers..."
docker compose down

# Clean up
echo ">> Cleaning up old Docker resources..."
docker system prune -f

# Rebuild and start
echo ">> Rebuilding and starting services..."
docker compose up -d --build --remove-orphans

# Wait for startup
echo ">> Waiting for services to start..."
sleep 10

# Show status
echo ""
echo ">> Service Status:"
docker compose ps

echo ""
echo "==================================="
echo "Update completed successfully!"
echo "==================================="
echo ""
echo "Dashboard: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "To view logs: docker compose logs -f"
