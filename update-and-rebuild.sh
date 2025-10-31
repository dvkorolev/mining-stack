#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/opt/mining-stack"
BRANCH="${1:-main}"

echo -e "${BLUE}🔄 Mining Stack Update & Rebuild Script${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check if we're in the right directory
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}❌ Error: Project directory $PROJECT_DIR not found${NC}"
    echo -e "${YELLOW}💡 Run the initial deployment first: ./deploy-pi.sh${NC}"
    exit 1
fi

cd "$PROJECT_DIR"

# 1. Pull latest changes from git
echo -e "${BLUE}📥 Pulling latest changes from git (branch: $BRANCH)...${NC}"
git fetch origin
git pull origin "$BRANCH"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to pull from git${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Git pull completed${NC}\n"

# 2. Stop running containers
echo -e "${BLUE}🛑 Stopping running containers...${NC}"
docker compose down

echo -e "${GREEN}✅ Containers stopped${NC}\n"

# 3. Clean up old images and containers
echo -e "${BLUE}🧹 Cleaning up old Docker resources...${NC}"
docker system prune -f

echo -e "${GREEN}✅ Cleanup completed${NC}\n"

# 4. Rebuild and start services
echo -e "${BLUE}🔨 Rebuilding and starting services...${NC}"
docker compose up -d --build --remove-orphans

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to rebuild services${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Services rebuilt and started${NC}\n"

# 5. Wait for services to be ready
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 10

# 6. Check service status
echo -e "${BLUE}📊 Checking service status...${NC}"
docker compose ps

echo -e "\n${GREEN}✅ Update and rebuild completed successfully!${NC}\n"

# 7. Display access information
echo -e "${BLUE}📋 Access your services at:${NC}"
echo -e "  ${GREEN}Dashboard:${NC}     http://$(hostname -I | awk '{print $1}'):3000"
echo -e "  ${GREEN}API:${NC}           http://$(hostname -I | awk '{print $1}'):5000"
echo -e "  ${GREEN}Prometheus:${NC}    http://$(hostname -I | awk '{print $1}'):9090"
echo -e "  ${GREEN}Grafana:${NC}       http://$(hostname -I | awk '{print $1}'):3001 (admin/mining123)"

echo -e "\n${YELLOW}💡 To monitor logs, run:${NC}"
echo -e "  cd $PROJECT_DIR && docker compose logs -f"

echo -e "\n${YELLOW}💡 To view specific service logs:${NC}"
echo -e "  docker compose logs -f [frontend|backend|prometheus|grafana]"
