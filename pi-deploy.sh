#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REGISTRY="${REGISTRY:-100.121.189.88:5001}"
WORK_DIR="/opt/mining-stack"

echo -e "${GREEN}=== Deploying Mining Stack on Raspberry Pi ===${NC}"
echo -e "${BLUE}Registry: ${REGISTRY}${NC}"
echo -e "${BLUE}Working directory: ${WORK_DIR}${NC}\n"

# Check if we're in the right directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo -e "${RED}Error: docker-compose.prod.yml not found!${NC}"
    echo -e "${YELLOW}Please run this script from ${WORK_DIR}${NC}"
    exit 1
fi

# Check if registry is accessible
echo -e "${YELLOW}Checking registry accessibility...${NC}"
if curl -s http://${REGISTRY}/v2/ > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Registry is accessible${NC}"
else
    echo -e "${RED}Error: Cannot reach registry at ${REGISTRY}${NC}"
    echo -e "${YELLOW}Make sure:${NC}"
    echo -e "  1. Registry is running on Mac: docker compose -f docker-compose.registry.yml ps"
    echo -e "  2. Mac firewall allows connections"
    echo -e "  3. IP address is correct"
    exit 1
fi

# Stop existing services
echo -e "\n${YELLOW}Stopping existing services...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down || true

# Pull latest images
echo -e "\n${YELLOW}Pulling images from registry...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull

# Start services
echo -e "\n${YELLOW}Starting services...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Wait for services to be healthy
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Show status
echo -e "\n${GREEN}=== Service Status ===${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo -e "${BLUE}Frontend: http://192.168.1.66:3000${NC}"
echo -e "${BLUE}Backend: http://192.168.1.66:5000${NC}"
echo -e "${BLUE}Grafana: http://192.168.1.66:3001${NC}"
echo -e "${BLUE}Prometheus: http://192.168.1.66:9090${NC}"

echo -e "\n${YELLOW}To view logs:${NC}"
echo -e "${BLUE}docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f${NC}"

echo -e "\n${YELLOW}To view specific service logs:${NC}"
echo -e "${BLUE}docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f backend${NC}"
