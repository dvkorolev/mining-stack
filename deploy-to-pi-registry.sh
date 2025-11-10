#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PI_USER="${PI_USER:-admin}"
PI_HOST="${PI_HOST:-192.168.1.66}"
PI_REMOTE="${PI_USER}@${PI_HOST}"
REGISTRY="${REGISTRY:-100.121.189.88:5001}"
REMOTE_DIR="/opt/mining-stack"

echo -e "${GREEN}=== Deploying to Raspberry Pi from Local Registry ===${NC}"
echo -e "${BLUE}Target: ${PI_REMOTE}${NC}"
echo -e "${BLUE}Registry: ${REGISTRY}${NC}"
echo -e "${BLUE}Remote directory: ${REMOTE_DIR}${NC}\n"

# Check if local registry is accessible
echo -e "${YELLOW}Checking local registry...${NC}"
if docker compose -f docker-compose.registry.yml ps | grep -q "Up"; then
    echo -e "${GREEN}✓ Registry is running${NC}"
else
    echo -e "${RED}Error: Local registry is not running!${NC}"
    echo -e "${YELLOW}Start it with: docker compose -f docker-compose.registry.yml up -d${NC}"
    exit 1
fi

# Configure Pi to use insecure registry (for local network)
echo -e "\n${YELLOW}Configuring Pi to use local registry...${NC}"
ssh ${PI_REMOTE} << ENDSSH
# Add insecure registry to Docker daemon config
sudo mkdir -p /etc/docker
if ! grep -q "${REGISTRY}" /etc/docker/daemon.json 2>/dev/null; then
    echo '{
  "insecure-registries": ["${REGISTRY}"]
}' | sudo tee /etc/docker/daemon.json > /dev/null
    sudo systemctl restart docker
    echo "Docker daemon restarted with insecure registry config"
else
    echo "Registry already configured"
fi
ENDSSH
echo -e "${GREEN}✓ Pi configured${NC}"

# Transfer docker-compose and configuration files (only changes)
echo -e "\n${YELLOW}Syncing configuration files...${NC}"
ssh ${PI_REMOTE} "mkdir -p ${REMOTE_DIR}"

# Copy pi-deploy.sh script
rsync -avz --info=progress2 pi-deploy.sh ${PI_REMOTE}:${REMOTE_DIR}/
ssh ${PI_REMOTE} "chmod +x ${REMOTE_DIR}/pi-deploy.sh"

rsync -avz --progress docker-compose.prod.yml ${PI_REMOTE}:${REMOTE_DIR}/
rsync -avz --progress docker-compose.logging.yml ${PI_REMOTE}:${REMOTE_DIR}/
rsync -avz --progress --delete etc/ ${PI_REMOTE}:${REMOTE_DIR}/etc/ 2>/dev/null || echo "etc directory not found, skipping..."
rsync -avz --progress --delete docker/ ${PI_REMOTE}:${REMOTE_DIR}/docker/ 2>/dev/null || echo "docker directory not found, skipping..."
rsync -avz --progress .env ${PI_REMOTE}:${REMOTE_DIR}/ 2>/dev/null || echo ".env file not found, skipping..."

echo -e "${GREEN}✓ Configuration files synchronized${NC}"

# Pull images and restart services on Raspberry Pi
echo -e "\n${YELLOW}Pulling images from registry and restarting services...${NC}"
ssh ${PI_REMOTE} << ENDSSH
cd /opt/mining-stack

echo "Pulling images from ${REGISTRY}..."
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull

echo "Restarting services..."
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

echo "Services restarted"
ENDSSH

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo -e "${BLUE}Access your dashboard at: http://${PI_HOST}:3000${NC}"
echo -e "${BLUE}Backend API: http://${PI_HOST}:5000${NC}"
echo -e "${BLUE}Grafana: http://${PI_HOST}:3001${NC}"

# Show service status
echo -e "\n${YELLOW}Service Status:${NC}"
ssh ${PI_REMOTE} "cd /opt/mining-stack && docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps"

echo -e "\n${GREEN}To view logs, run:${NC}"
echo -e "${BLUE}ssh ${PI_REMOTE} 'cd /opt/mining-stack && docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f'${NC}"

echo -e "\n${YELLOW}Note: Keep your Mac registry running for Pi to pull updates!${NC}"
echo -e "${YELLOW}Registry status: docker compose -f docker-compose.registry.yml ps${NC}"
