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
IMAGE_TAG="latest"
FORCE_UPDATE=false
SPECIFIC_SERVICE=""
AUTO_CONFIRM=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --force)
      FORCE_UPDATE=true
      ;;
    --service=*)
      SPECIFIC_SERVICE="${arg#*=}"
      ;;
    --yes|-y)
      AUTO_CONFIRM=true
      ;;
    --*)
      # Skip other flags
      ;;
    *)
      # First non-flag argument is the image tag
      if [ "$IMAGE_TAG" = "latest" ]; then
        IMAGE_TAG="$arg"
      fi
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
declare -a SERVICES=()

if [ -n "$SPECIFIC_SERVICE" ]; then
    SERVICES=("$SPECIFIC_SERVICE")
    echo -e "${BLUE}🎯 Checking specific service: $SPECIFIC_SERVICE${NC}"
else
    echo -e "${BLUE}🔍 Detecting services...${NC}"

    # shellcheck disable=SC2207
    mapfile -t DETECTED_SERVICES < <(docker compose $COMPOSE_FILES config --services 2>/dev/null)

    if [ ${#DETECTED_SERVICES[@]} -eq 0 ]; then
        echo -e "${YELLOW}   ⚠️  Unable to detect services automatically, using default list${NC}"
        DETECTED_SERVICES=(backend frontend python-scheduler)
    fi

    if [ -n "$SERVICE_WHITELIST" ]; then
        IFS=', ' read -r -a WHITELIST <<< "$SERVICE_WHITELIST"
        declare -a FILTERED_SERVICES=()
        for svc in "${DETECTED_SERVICES[@]}"; do
            for allowed in "${WHITELIST[@]}"; do
                if [ -n "$allowed" ] && [ "$svc" = "$allowed" ]; then
                    FILTERED_SERVICES+=("$svc")
                    break
                fi
            done
        done

        if [ ${#FILTERED_SERVICES[@]} -eq 0 ]; then
            echo -e "${YELLOW}   ⚠️  Whitelist provided but none matched detected services; using whitelist as-is${NC}"
            FILTERED_SERVICES=("${WHITELIST[@]}")
        fi

        SERVICES=("${FILTERED_SERVICES[@]}")
    else
        SERVICES=("${DETECTED_SERVICES[@]}")
    fi

    echo -e "${BLUE}   Found services: ${SERVICES[*]}${NC}"
    echo -e "${BLUE}🔍 Checking for updates...${NC}"
fi

CHANGED_SERVICES=()
declare -A PULLED_IMAGES=()

# Check each service for updates
for service in "${SERVICES[@]}"; do
    echo -e "${BLUE}   Checking $service...${NC}"
    
    # Get current image ID
    CURRENT_IMAGE=$(docker compose $COMPOSE_FILES images -q $service 2>/dev/null || echo "")
    
    if [ -z "$CURRENT_IMAGE" ]; then
        echo -e "${YELLOW}   ⚠️  $service not running, will pull and start${NC}"
        CHANGED_SERVICES+=("$service")
        PULLED_IMAGES["$service"]=1
        # Pull now since we need it
        timeout 60 docker compose $COMPOSE_FILES pull $service > /dev/null 2>&1 || {
            echo -e "${RED}   ✗ Failed to pull $service${NC}"
            continue
        }
        continue
    fi
    
    # Pull latest image with timeout
    if [[ ! "${PULLED_IMAGES[$service]}" ]]; then
        timeout 60 docker compose $COMPOSE_FILES pull $service > /dev/null 2>&1 || {
            echo -e "${YELLOW}   ⚠️  Failed to pull $service (timeout or error), assuming no update${NC}"
            continue
        }
        PULLED_IMAGES["$service"]=1
    fi
    
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

FAILED_SERVICES=()

for service in "${CHANGED_SERVICES[@]}"; do
    echo -e "${BLUE}📥 Updating $service...${NC}"
    
    # Pull latest image only if not already pulled
    if [[ -z "${PULLED_IMAGES[$service]}" ]]; then
        echo -e "${BLUE}   Pulling image...${NC}"
        timeout 60 docker compose $COMPOSE_FILES pull $service || {
            echo -e "${RED}   ✗ Failed to pull $service${NC}"
            FAILED_SERVICES+=("$service")
            continue
        }
        PULLED_IMAGES["$service"]=1
    fi
    
    # Restart only this service
    echo -e "${BLUE}🔄 Restarting $service...${NC}"
    if docker compose $COMPOSE_FILES up -d $service; then
        # Wait a bit for service to start
        sleep 3
        
        # Check health
        if docker compose $COMPOSE_FILES ps $service | grep -q "Up"; then
            echo -e "${GREEN}✓ $service updated successfully${NC}"
        else
            echo -e "${RED}⚠️  $service may have issues, check logs${NC}"
            FAILED_SERVICES+=("$service")
        fi
    else
        echo -e "${RED}✗ Failed to restart $service${NC}"
        FAILED_SERVICES+=("$service")
    fi
    echo ""
done

# Show final status
echo -e "${BLUE}📊 Final Status:${NC}"
docker compose $COMPOSE_FILES ps

echo ""
if [ ${#FAILED_SERVICES[@]} -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✅ Smart update completed!${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}⚠️  Update completed with warnings${NC}"
    echo -e "${YELLOW}========================================${NC}"
fi
echo ""

# Show what was updated
if [ ${#CHANGED_SERVICES[@]} -gt 0 ]; then
    echo -e "${BLUE}Updated services:${NC}"
    for service in "${CHANGED_SERVICES[@]}"; do
        if [[ " ${FAILED_SERVICES[*]} " =~ " ${service} " ]]; then
            echo -e "${RED}   ✗ $service (failed)${NC}"
        else
            echo -e "${GREEN}   ✓ $service${NC}"
        fi
    done
fi

# Show failed services if any
if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed services:${NC}"
    for service in "${FAILED_SERVICES[@]}"; do
        echo -e "${RED}   ✗ $service${NC}"
    done
    echo ""
    echo -e "${YELLOW}💡 Check logs for failed services:${NC}"
    for service in "${FAILED_SERVICES[@]}"; do
        echo -e "   docker compose $COMPOSE_FILES logs --tail=50 $service"
    done
fi

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
