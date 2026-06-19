#!/bin/bash
# Quick update script - pulls latest from Docker Hub and restarts
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PI_USER="${PI_USER:-admin}"
PI_HOSTS=("192.168.1.66" "100.112.244.18")

# Find reachable Pi
for host in "${PI_HOSTS[@]}"; do
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "${PI_USER}@${host}" "echo ok" 2>/dev/null; then
        PI_HOST="$host"
        break
    fi
done

if [ -z "$PI_HOST" ]; then
    echo -e "${RED}Cannot reach Pi${NC}"
    exit 1
fi

echo -e "${GREEN}Updating Pi at ${PI_HOST}...${NC}"

ssh "${PI_USER}@${PI_HOST}" << 'ENDSSH'
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml up -d
docker image prune -f
docker compose -f docker-compose.prod.yml -f docker-compose.dockerhub.yml -f docker-compose.logging.yml ps
ENDSSH

echo -e "${GREEN}Done!${NC}"
