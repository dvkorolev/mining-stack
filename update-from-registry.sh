#!/bin/bash
# Update Mining Stack on Raspberry Pi by pulling latest images from GHCR
# 
# This script should be run ON the Raspberry Pi (not from your local machine).
# It pulls pre-built Docker images from GitHub Container Registry.
#
# Usage: ./update-from-registry.sh [image_tag] [--skip-git] [--build]
#
# What this script does:
#   1. ✓ Optionally syncs configuration files from GitHub (docker-compose, scripts)
#   2. ✓ Pulls latest Docker images from GHCR OR builds locally
#   3. ✓ Restarts containers with new images
#   4. ✓ Preserves your miners.yaml and .env configuration
#   5. ✓ Runs health checks
#
# What this script does NOT do:
#   ✗ Does not modify your miners.yaml
#   ✗ Does not require full source code (only if --build is used)
#
# Examples:
#   ./update-from-registry.sh              # Update to 'latest' tag from GHCR
#   ./update-from-registry.sh v1.2.3       # Update to specific version
#   ./update-from-registry.sh --skip-git   # Only update Docker images, skip file sync
#   ./update-from-registry.sh --build      # Build from local source instead of pulling

set -e

PROJECT_DIR="/opt/mining-stack"
IMAGE_TAG="${1:-latest}"
SKIP_GIT=false
BUILD_LOCAL=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --skip-git)
      SKIP_GIT=true
      shift
      ;;
    --build)
      BUILD_LOCAL=true
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

# Check if .env exists (Docker Compose will load it automatically)
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found, using defaults${NC}"
fi

# Use provided tag or default
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo -e "${GREEN}Repository:${NC} $GITHUB_REPOSITORY"
echo -e "${GREEN}Tag:${NC} $IMAGE_TAG"
echo ""

# Check if git repository exists
if [ -d ".git" ] && [ "$SKIP_GIT" = false ]; then
    echo -e "${BLUE}📦 Syncing configuration files from GitHub...${NC}"
    echo -e "${BLUE}   (docker-compose, python-scheduler, bin/ - no source code)${NC}"
    
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
    
    # Check for untracked files that would be overwritten
    # This handles the case where files exist locally but aren't in git yet
    UNTRACKED_CONFLICTS=$(git ls-files -o --exclude-standard | grep -v -E '\.env$|miners\.yaml$' || true)
    if [ -n "$UNTRACKED_CONFLICTS" ]; then
        echo -e "${YELLOW}⚠️  Found untracked files that may conflict${NC}"
        echo -e "${YELLOW}   Backing up and removing conflicting files...${NC}"
        mkdir -p .git/untracked-backup
        while IFS= read -r file; do
            if [ -f "$file" ]; then
                mkdir -p ".git/untracked-backup/$(dirname "$file")"
                cp "$file" ".git/untracked-backup/$file"
                rm "$file"
                echo -e "${YELLOW}   Backed up: $file${NC}"
            fi
        done <<< "$UNTRACKED_CONFLICTS"
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
                chmod +x bin/*.sh bin/*.py 2>/dev/null || true
                
                echo -e "${GREEN}✓ Configuration restored${NC}"
                echo -e "${GREEN}✓ Updated: docker-compose, python-scheduler, bin scripts${NC}"
                
                # Notify about untracked backups if they exist
                if [ -d .git/untracked-backup ] && [ "$(ls -A .git/untracked-backup)" ]; then
                    echo -e "${BLUE}ℹ️  Untracked file backups saved in: .git/untracked-backup/${NC}"
                fi
            else
                echo -e "${RED}✗ CRITICAL: Failed to pull updates${NC}"
                echo -e "${RED}   Aborting to prevent inconsistent state${NC}"
                
                # Restore backups to maintain consistency
                echo -e "${BLUE}🔄 Restoring original configuration...${NC}"
                [ -f .env.backup ] && mv .env.backup .env
                [ -f etc/miners.yaml.backup ] && mv etc/miners.yaml.backup etc/miners.yaml
                
                echo -e "${YELLOW}   System state preserved. Please check your network and try again.${NC}"
                exit 1
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

# Pull or build images
if [ "$BUILD_LOCAL" = true ]; then
    echo -e "${BLUE}🔨 Building images from local source...${NC}"
    echo -e "${YELLOW}   This will take a few minutes...${NC}"
    docker compose -f docker-compose.prod.yml build
else
    echo -e "${BLUE}📥 Pulling latest images from GHCR...${NC}"
    export IMAGE_TAG=$IMAGE_TAG
    # Pull both compose files together so logging.yml can reference prod.yml services
    docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull
fi

# Stop containers and remove old images for this project only
echo -e "${BLUE}🛑 Stopping containers...${NC}"
echo -e "${BLUE}🧹 Removing old project images...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down --rmi local

# Fix permissions for data directories
echo -e "${BLUE}🔐 Ensuring data directory permissions...${NC}"
mkdir -p ./data ./logs ./etc
chmod -R 755 ./data ./logs ./etc

# Create default miners.yaml if it doesn't exist
if [ ! -f ./etc/miners.yaml ]; then
    echo -e "${YELLOW}⚠️  Creating default miners.yaml...${NC}"
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
    echo -e "${GREEN}✓ Default miners.yaml created${NC}"
fi

# Start services (including logging stack)
echo -e "${BLUE}🚀 Starting services...${NC}"
echo -e "${BLUE}   Including logging stack (Loki + Promtail)${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Wait for startup
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 10

# Show status
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Update completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Dashboard: http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo -e "${BLUE}Grafana:   http://$(hostname -I | awk '{print $1}'):3001${NC}"
echo -e "${BLUE}Loki Logs: http://$(hostname -I | awk '{print $1}'):3100${NC}"
echo ""
echo -e "${BLUE}To view logs:${NC} docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f"
echo ""

# Run health check
echo -e "${BLUE}🏥 Running health check...${NC}"
echo ""
bash health-check.sh
