#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DOCKER_HUB_USER="${DOCKER_HUB_USER:-dvkorolev}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="linux/arm64"

# Pi connection - try multiple addresses
PI_USER="${PI_USER:-admin}"
PI_HOSTS=("192.168.1.66" "100.112.244.18")  # Local and Tailscale
PI_HOST=""
REMOTE_DIR="/opt/mining-stack"

echo -e "${GREEN}=== Optimized Deployment to Docker Hub & Raspberry Pi ===${NC}"

# Find reachable Pi host
find_pi_host() {
    for host in "${PI_HOSTS[@]}"; do
        echo -e "${YELLOW}Checking $host...${NC}"
        if ping -c 1 -W 2 "$host" > /dev/null 2>&1; then
            if ssh -o ConnectTimeout=5 -o BatchMode=yes "${PI_USER}@${host}" "echo ok" 2>/dev/null; then
                PI_HOST="$host"
                echo -e "${GREEN}✓ Connected to Pi via $host${NC}"
                return 0
            fi
        fi
    done
    echo -e "${RED}Cannot reach Pi on any address${NC}"
    return 1
}

# Build and push to Docker Hub
build_and_push() {
    local service=$1
    local context=$2
    local dockerfile="${context}/Dockerfile"
    local image="${DOCKER_HUB_USER}/mining-${service}:${IMAGE_TAG}"
    
    echo -e "\n${YELLOW}Building ${service}...${NC}"
    
    docker buildx build \
        --platform ${PLATFORM} \
        --tag "${image}" \
        --push \
        -f "${dockerfile}" \
        "${context}"
    
    echo -e "${GREEN}✓ ${service} pushed to Docker Hub as ${image}${NC}"
}

# Step 1: Build and push images to Docker Hub
echo -e "\n${BLUE}Step 1: Building and pushing to Docker Hub${NC}"

build_and_push "backend" "backend"
build_and_push "frontend" "frontend"
build_and_push "python-scheduler" "python-scheduler"

echo -e "\n${GREEN}=== All images pushed to Docker Hub ===${NC}"

# Step 2: Find Pi and deploy
echo -e "\n${BLUE}Step 2: Connecting to Raspberry Pi${NC}"

if ! find_pi_host; then
    echo -e "${RED}Skipping Pi deployment - Pi unreachable${NC}"
    echo -e "${YELLOW}Run manually on Pi:${NC}"
    echo -e "  docker compose -f docker-compose.prod.yml pull"
    echo -e "  docker compose -f docker-compose.prod.yml up -d"
    exit 0
fi

PI_REMOTE="${PI_USER}@${PI_HOST}"

# Step 3: Update docker-compose on Pi to use Docker Hub images
echo -e "\n${BLUE}Step 3: Syncing configuration to Pi${NC}"

# Create a production compose override for Docker Hub images
cat > docker-compose.dockerhub.yml << EOF
# Docker Hub image override - auto-generated
version: '3.8'
services:
  backend:
    image: ${DOCKER_HUB_USER}/mining-backend:${IMAGE_TAG}
  frontend:
    image: ${DOCKER_HUB_USER}/mining-frontend:${IMAGE_TAG}
  python-scheduler:
    image: ${DOCKER_HUB_USER}/mining-python-scheduler:${IMAGE_TAG}
EOF

rsync -avz docker-compose.prod.yml "${PI_REMOTE}:${REMOTE_DIR}/"
rsync -avz docker-compose.dockerhub.yml "${PI_REMOTE}:${REMOTE_DIR}/"
rsync -avz docker-compose.logging.yml "${PI_REMOTE}:${REMOTE_DIR}/"
rsync -avz .env "${PI_REMOTE}:${REMOTE_DIR}/" 2>/dev/null || true

echo -e "${GREEN}✓ Configuration synced${NC}"

# Step 4: Pull and restart on Pi
echo -e "\n${BLUE}Step 4: Pulling images and restarting services on Pi${NC}"

ssh "${PI_REMOTE}" << 'ENDSSH'
cd /opt/mining-stack

echo "Pulling images from Docker Hub..."
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml pull

echo "Restarting services..."
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml down
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml up -d

echo "Cleaning up old images..."
docker image prune -f

echo "Services status:"
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml ps
ENDSSH

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo -e "${BLUE}Dashboard: http://${PI_HOST}:3000${NC}"
echo -e "${BLUE}Backend:   http://${PI_HOST}:5000${NC}"
echo -e "${BLUE}Grafana:   http://${PI_HOST}:3001${NC}"
