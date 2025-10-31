#!/bin/bash
# Update Mining Stack on Raspberry Pi by pulling latest images from GHCR
# 
# This script should be run ON the Raspberry Pi (not from your local machine).
# It pulls pre-built Docker images from GitHub Container Registry.
#
# Usage: ./update-from-registry.sh [image_tag] [--skip-git]
#
# What this script does:
#   1. ✓ Optionally syncs configuration files from GitHub (docker-compose, scripts)
#   2. ✓ Pulls latest Docker images from GHCR
#   3. ✓ Restarts containers with new images
#   4. ✓ Preserves your miners.yaml and .env configuration
#   5. ✓ Runs health checks
#
# What this script does NOT do:
#   ✗ Does not build images (they're pre-built in CI/CD)
#   ✗ Does not modify your miners.yaml
#   ✗ Does not require source code on the Pi
#
# Examples:
#   ./update-from-registry.sh              # Update to 'latest' tag
#   ./update-from-registry.sh v1.2.3       # Update to specific version
#   ./update-from-registry.sh --skip-git   # Only update Docker images, skip file sync

set -e

PROJECT_DIR="/opt/mining-stack"
IMAGE_TAG="${1:-latest}"
SKIP_GIT=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --skip-git)
      SKIP_GIT=true
      shift
      ;;
  esac
done

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Mining Stack Update (GHCR Registry)${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Pulling pre-built images - no source code needed${NC}"
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

# Check if git repository exists
if [ -d ".git" ] && [ "$SKIP_GIT" = false ]; then
    echo -e "${BLUE}📦 Syncing configuration files from GitHub...${NC}"
    echo -e "${BLUE}   (Only docker-compose, scripts - no source code)${NC}"
    
    # Backup current configuration files
    echo -e "${BLUE}💾 Backing up configuration...${NC}"
    [ -f .env ] && cp .env .env.backup
    [ -f etc/miners.yaml ] && cp etc/miners.yaml etc/miners.yaml.backup
    
    # Check for local changes
    if ! git diff-index --quiet HEAD --; then
        echo -e "${YELLOW}⚠️  Local changes detected${NC}"
        echo -e "${YELLOW}   Stashing local changes...${NC}"
        git stash push -m "Auto-stash before update $(date +%Y%m%d_%H%M%S)"
    fi
    
    # Get current branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo -e "${BLUE}   Current branch: $CURRENT_BRANCH${NC}"
    
    # Fetch latest changes
    if git fetch origin; then
        # Check if there are updates
        LOCAL=$(git rev-parse HEAD)
        REMOTE=$(git rev-parse origin/$CURRENT_BRANCH)
        
        if [ "$LOCAL" = "$REMOTE" ]; then
            echo -e "${GREEN}✓ Already up to date${NC}"
        else
            echo -e "${BLUE}   Pulling updates...${NC}"
            if git pull origin $CURRENT_BRANCH; then
                echo -e "${GREEN}✓ Files updated successfully${NC}"
                
                # Restore configuration files
                echo -e "${BLUE}🔄 Restoring configuration...${NC}"
                [ -f .env.backup ] && mv .env.backup .env
                [ -f etc/miners.yaml.backup ] && mv etc/miners.yaml.backup etc/miners.yaml
                
                # Make scripts executable
                chmod +x *.sh 2>/dev/null || true
                
                echo -e "${GREEN}✓ Configuration restored${NC}"
            else
                echo -e "${RED}✗ Failed to pull updates${NC}"
                echo -e "${YELLOW}   Continuing with existing files...${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}⚠️  Could not fetch from GitHub${NC}"
        echo -e "${YELLOW}   Continuing with existing files...${NC}"
    fi
    
    # Clean up backup files
    rm -f .env.backup etc/miners.yaml.backup
    echo ""
elif [ "$SKIP_GIT" = true ]; then
    echo -e "${YELLOW}⏭️  Skipping GitHub sync (--skip-git flag)${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠️  Not a git repository, skipping file sync${NC}"
    echo -e "${YELLOW}   Only Docker images will be updated${NC}"
    echo ""
fi

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

# Run health check
echo -e "${BLUE}🏥 Running health check...${NC}"
echo ""
bash health-check.sh
