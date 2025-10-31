#!/bin/bash
# Deploy Mining Stack from GitHub Container Registry to Raspberry Pi
# Usage: ./deploy-from-registry.sh [pi_user] [pi_host] [github_repo] [image_tag]

set -e

# Configuration
PI_USER=${1:-pi}
PI_HOST=${2:-raspberrypi.local}
GITHUB_REPO=${3:-dvkorolev/mining-stack}
IMAGE_TAG=${4:-latest}
REMOTE_DIR="/opt/mining-stack"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Mining Stack Registry Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Target:${NC} $PI_USER@$PI_HOST"
echo -e "${GREEN}Repository:${NC} $GITHUB_REPO"
echo -e "${GREEN}Tag:${NC} $IMAGE_TAG"
echo ""

# Check if we're running locally (on the Pi itself)
if [[ "$PI_HOST" == "localhost" || "$PI_HOST" == "127.0.0.1" || "$PI_HOST" == "$(hostname)" ]]; then
    echo -e "${YELLOW}🔍 Detected local installation on Raspberry Pi${NC}"
    LOCAL_INSTALL=true
    PI_USER=$(whoami)
    PI_HOST="localhost"
else
    LOCAL_INSTALL=false
fi

# Function to run commands either locally or via SSH
run_cmd() {
    if [ "$LOCAL_INSTALL" = true ]; then
        eval "$1"
    else
        ssh $PI_USER@$PI_HOST "$1"
    fi
}

# Function to copy files either locally or via rsync
copy_files() {
    local src=$1
    local dest=$2
    
    if [ "$LOCAL_INSTALL" = true ]; then
        echo -e "${BLUE}📁 Copying files locally to $dest${NC}"
        rsync -a --exclude='.git' --exclude='node_modules' --exclude='backend' --exclude='frontend' "$src" "$dest"
    else
        echo -e "${BLUE}📤 Copying files to $PI_USER@$PI_HOST:$dest${NC}"
        rsync -avz --progress --exclude='.git' --exclude='node_modules' --exclude='backend' --exclude='frontend' "$src" $PI_USER@$PI_HOST:"$dest"
    fi
}

# 1. Create necessary directories
echo -e "${BLUE}📁 Creating directories...${NC}"
run_cmd "
  sudo mkdir -p $REMOTE_DIR/{docker/prometheus,logs,etc,textfile,bin}
  sudo chown -R $PI_USER:$PI_USER $REMOTE_DIR
  chmod -R 755 $REMOTE_DIR
"

# 2. Copy configuration files (not source code)
echo -e "${BLUE}📤 Copying configuration files...${NC}"
copy_files "./docker" "$REMOTE_DIR/"
copy_files "./docker-compose.prod.yml" "$REMOTE_DIR/"
copy_files "./.env" "$REMOTE_DIR/" 2>/dev/null || echo "No .env file to copy"

# 3. Create .env file with registry configuration
echo -e "${BLUE}⚙️ Setting up environment...${NC}"
run_cmd "
  cd $REMOTE_DIR
  
  # Create or update .env file
  cat > .env << EOL
GITHUB_REPOSITORY=$GITHUB_REPO
IMAGE_TAG=$IMAGE_TAG
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=*
EOL
  
  chmod 600 .env
"

# 4. Login to GitHub Container Registry (if credentials provided)
if [ -n "$GITHUB_TOKEN" ]; then
    echo -e "${BLUE}🔐 Logging into GitHub Container Registry...${NC}"
    run_cmd "
        echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
    "
else
    echo -e "${YELLOW}⚠️  GITHUB_TOKEN not set. Skipping registry login.${NC}"
    echo -e "${YELLOW}   For private repos, set GITHUB_TOKEN environment variable.${NC}"
fi

# 5. Pull latest images
echo -e "${BLUE}📥 Pulling latest images from registry...${NC}"
run_cmd "
  cd $REMOTE_DIR
  export GITHUB_REPOSITORY=$GITHUB_REPO
  export IMAGE_TAG=$IMAGE_TAG
  docker compose -f docker-compose.prod.yml pull
"

# 6. Stop existing containers
echo -e "${BLUE}🛑 Stopping existing containers...${NC}"
run_cmd "
  cd $REMOTE_DIR
  docker compose -f docker-compose.prod.yml down || true
"

# 7. Clean up old images
echo -e "${BLUE}🧹 Cleaning up old Docker resources...${NC}"
run_cmd "docker system prune -f"

# 8. Start services
echo -e "${BLUE}🚀 Starting services...${NC}"
run_cmd "
  cd $REMOTE_DIR
  export GITHUB_REPOSITORY=$GITHUB_REPO
  export IMAGE_TAG=$IMAGE_TAG
  docker compose -f docker-compose.prod.yml up -d
"

# 9. Wait for services to start
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 10

# 10. Show status
echo -e "${BLUE}📊 Service Status:${NC}"
run_cmd "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml ps"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}📋 Access your services at:${NC}"
if [ "$LOCAL_INSTALL" = true ]; then
    IP=$(hostname -I | awk '{print $1}')
    echo "  - Dashboard:  http://$IP:3000"
    echo "  - API:        http://$IP:5000"
    echo "  - Prometheus: http://$IP:9090"
    echo "  - Grafana:    http://$IP:3001 (admin/mining123)"
else
    echo "  - Dashboard:  http://$PI_HOST:3000"
    echo "  - API:        http://$PI_HOST:5000"
    echo "  - Prometheus: http://$PI_HOST:9090"
    echo "  - Grafana:    http://$PI_HOST:3001 (admin/mining123)"
fi
echo ""
echo -e "${BLUE}To view logs:${NC}"
echo "  cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml logs -f"
echo ""
