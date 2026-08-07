#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Mining Stack - Build & Push to Local Registry           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"

source "$(dirname "$0")/deploy-lib.sh"

# Configuration
IMAGE_TAG="${IMAGE_TAG:-latest}"
REGISTRY="${REGISTRY:-100.121.189.88:5001}"

if ! PI_HOST="$(find_pi_host)"; then
    echo -e "${RED}Error: Cannot reach Pi on any known address.${NC}"
    exit 1
fi
export PI_USER PI_HOST

echo -e "\n${BLUE}Configuration:${NC}"
echo -e "  Target: ${YELLOW}${PI_USER}@${PI_HOST}${NC}"
echo -e "  Registry: ${YELLOW}${REGISTRY}${NC}"
echo -e "  Image Tag: ${YELLOW}${IMAGE_TAG}${NC}"
echo -e ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

# Check if buildx is available
if ! docker buildx version > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker buildx is not available.${NC}"
    exit 1
fi
ensure_buildx_builder "multiarch"

# Step 1: Build and push images to local registry
echo -e "${YELLOW}Step 1/2: Building and pushing images to local registry...${NC}"
./build-local.sh

# Step 2: Deploy to Raspberry Pi (pull from registry)
echo -e "\n${YELLOW}Step 2/2: Deploying to Raspberry Pi...${NC}"
./deploy-to-pi-registry.sh

echo -e "\n${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Deployment Complete! 🎉                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e "\n${YELLOW}Keep your Mac registry running:${NC}"
echo -e "${BLUE}docker compose -f docker-compose.registry.yml ps${NC}"
