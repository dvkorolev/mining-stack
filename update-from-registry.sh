#!/bin/bash
# Update Mining Stack on Raspberry Pi by pulling latest images from registry
# This script should be run ON the Raspberry Pi
# Usage: ./update-from-registry.sh [image_tag]

set -e

PROJECT_DIR="/opt/mining-stack"
IMAGE_TAG="${1:-latest}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Mining Stack Update (Registry)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Navigate to project directory
cd "$PROJECT_DIR" || exit 1

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Use provided tag or default from .env
IMAGE_TAG="${IMAGE_TAG:-${IMAGE_TAG:-latest}}"

echo -e "${GREEN}Repository:${NC} $GITHUB_REPOSITORY"
echo -e "${GREEN}Tag:${NC} $IMAGE_TAG"
echo ""

# Pull latest images
echo -e "${BLUE}📥 Pulling latest images...${NC}"
export IMAGE_TAG=$IMAGE_TAG
docker compose -f docker-compose.prod.yml pull

# Stop containers
echo -e "${BLUE}🛑 Stopping containers...${NC}"
docker compose -f docker-compose.prod.yml down

# Clean up
echo -e "${BLUE}🧹 Cleaning up old Docker resources...${NC}"
docker system prune -f

# Start services
echo -e "${BLUE}🚀 Starting services...${NC}"
docker compose -f docker-compose.prod.yml up -d

# Wait for startup
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 10

# Show status
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
docker compose -f docker-compose.prod.yml ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Update completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Dashboard: http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo ""
echo -e "${BLUE}To view logs:${NC} docker compose -f docker-compose.prod.yml logs -f"
echo ""
