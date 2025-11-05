#!/bin/bash
# Smart update script - only pulls and restarts changed services
# Detects which images have updates available and only restarts those
#
# Usage: ./update-smart.sh [tag] [--force] [--service=name] [--yes]
#
# Examples:
#   ./update-smart.sh              # Check for updates and restart only changed services
#   ./update-smart.sh latest       # Use specific tag
#   ./update-smart.sh --force      # Force restart all services even if no updates
#   ./update-smart.sh --service=backend  # Only update specific service
#   ./update-smart.sh --yes        # Auto-confirm updates without prompting

set -e

PROJECT_DIR="/opt/mining-stack"
IMAGE_TAG="${1:-latest}"
FORCE_UPDATE=false
SPECIFIC_SERVICE=""
AUTO_CONFIRM=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --force)
      FORCE_UPDATE=true
      shift
      ;;
    --service=*)
      SPECIFIC_SERVICE="${arg#*=}"
      shift
      ;;
    --yes|-y)
      AUTO_CONFIRM=true
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
echo -e "${BLUE}Smart Mining Stack Update${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cd "$PROJECT_DIR" || exit 1

# Export variables for docker-compose
export IMAGE_TAG=$IMAGE_TAG
export GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-dvkorolev/mining-stack}"

echo -e "${GREEN}Repository:${NC} $GITHUB_REPOSITORY"
echo -e "${GREEN}Tag:${NC} $IMAGE_TAG"
echo ""

# Determine which compose files to use
COMPOSE_FILES="-f docker-compose.prod.yml"
if [ -f "docker-compose.logging.yml" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.logging.yml"
    echo -e "${BLUE}ℹ️  Including logging stack${NC}"
fi
echo ""

# Services to check
SERVICES=("backend" "frontend" "python-scheduler")

if [ -n "$SPECIFIC_SERVICE" ]; then
    SERVICES=("$SPECIFIC_SERVICE")
    echo -e "${BLUE}🎯 Checking specific service: $SPECIFIC_SERVICE${NC}"
else
    echo -e "${BLUE}🔍 Checking for updates...${NC}"
fi

CHANGED_SERVICES=()

# Check each service for updates
for service in "${SERVICES[@]}"; do
    echo -e "${BLUE}   Checking $service...${NC}"
    
    # Get current image ID
    CURRENT_IMAGE=$(docker compose $COMPOSE_FILES images -q $service 2>/dev/null || echo "")
    
    if [ -z "$CURRENT_IMAGE" ]; then
        echo -e "${YELLOW}   ⚠️  $service not running, will pull and start${NC}"
        CHANGED_SERVICES+=("$service")
        continue
    fi
    
    # Pull latest image
    docker compose $COMPOSE_FILES pull $service > /dev/null 2>&1
    
    # Get new image ID
    NEW_IMAGE=$(docker compose $COMPOSE_FILES images -q $service 2>/dev/null || echo "")
    
    # Compare
    if [ "$CURRENT_IMAGE" != "$NEW_IMAGE" ] || [ "$FORCE_UPDATE" = true ]; then
        echo -e "${GREEN}   ✓ Update available for $service${NC}"
        CHANGED_SERVICES+=("$service")
    else
        echo -e "${BLUE}   ℹ️  $service is up to date${NC}"
    fi
done

echo ""

# If no changes and not forced, exit
if [ ${#CHANGED_SERVICES[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All services are up to date!${NC}"
    echo ""
    echo -e "${BLUE}Current status:${NC}"
    docker compose $COMPOSE_FILES ps
    exit 0
fi

# Show what will be updated
echo -e "${YELLOW}📦 Services to update:${NC}"
for service in "${CHANGED_SERVICES[@]}"; do
    echo -e "${YELLOW}   • $service${NC}"
done
echo ""

# Ask for confirmation unless auto-confirmed, forced, or specific service
if [ "$AUTO_CONFIRM" = false ] && [ "$FORCE_UPDATE" = false ] && [ -z "$SPECIFIC_SERVICE" ]; then
    # Check if running interactively
    if [ -t 0 ]; then
        read -p "Continue with update? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Update cancelled${NC}"
            exit 0
        fi
    else
        # Non-interactive mode, auto-confirm
        echo -e "${YELLOW}⚠️  Running in non-interactive mode, auto-confirming update${NC}"
    fi
fi

# Update each changed service
echo -e "${BLUE}🔄 Updating services...${NC}"
echo ""

for service in "${CHANGED_SERVICES[@]}"; do
    echo -e "${BLUE}📥 Updating $service...${NC}"
    
    # Pull latest image (already done above, but ensures we have it)
    docker compose $COMPOSE_FILES pull $service
    
    # Restart only this service
    echo -e "${BLUE}🔄 Restarting $service...${NC}"
    docker compose $COMPOSE_FILES up -d $service
    
    # Wait a bit for service to start
    sleep 3
    
    # Check health
    if docker compose $COMPOSE_FILES ps $service | grep -q "Up"; then
        echo -e "${GREEN}✓ $service updated successfully${NC}"
    else
        echo -e "${RED}⚠️  $service may have issues, check logs${NC}"
    fi
    echo ""
done

# Show final status
echo -e "${BLUE}📊 Final Status:${NC}"
docker compose $COMPOSE_FILES ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Smart update completed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Show what was updated
echo -e "${BLUE}Updated services:${NC}"
for service in "${CHANGED_SERVICES[@]}"; do
    echo -e "${GREEN}   ✓ $service${NC}"
done

echo ""
echo -e "${BLUE}To view logs:${NC}"
for service in "${CHANGED_SERVICES[@]}"; do
    echo -e "   docker compose $COMPOSE_FILES logs -f $service"
done
echo ""

# Optional: Run health checks
echo -e "${BLUE}⏳ Running health checks...${NC}"
sleep 5

for service in "${CHANGED_SERVICES[@]}"; do
    if docker compose $COMPOSE_FILES ps $service | grep -q "healthy"; then
        echo -e "${GREEN}   ✓ $service is healthy${NC}"
    elif docker compose $COMPOSE_FILES ps $service | grep -q "Up"; then
        echo -e "${YELLOW}   ⏳ $service is starting (no health check yet)${NC}"
    else
        echo -e "${RED}   ✗ $service may have issues${NC}"
    fi
done

echo ""
