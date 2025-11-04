#!/bin/bash
# Quick fix script for logging stack issues
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Logging Stack Fix Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running on Raspberry Pi
if [ ! -f "/opt/mining-stack/docker-compose.prod.yml" ]; then
    echo -e "${RED}✗ This script must be run on the Raspberry Pi${NC}"
    echo -e "${YELLOW}  Expected path: /opt/mining-stack/${NC}"
    exit 1
fi

cd /opt/mining-stack

# Stop everything
echo -e "${BLUE}1. Stopping all services...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down 2>/dev/null || \
docker compose -f docker-compose.prod.yml down

echo -e "${GREEN}✓ Services stopped${NC}"
echo ""

# Pull latest config
echo -e "${BLUE}2. Pulling latest configuration...${NC}"
if git pull origin main; then
    echo -e "${GREEN}✓ Configuration updated${NC}"
else
    echo -e "${YELLOW}⚠️  Could not pull from git, using existing config${NC}"
fi
echo ""

# Start services with logging stack
echo -e "${BLUE}3. Starting services with logging stack...${NC}"
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

echo -e "${GREEN}✓ Services started${NC}"
echo ""

# Wait for services to be healthy
echo -e "${BLUE}4. Waiting for services to be healthy (30s)...${NC}"
sleep 30
echo -e "${GREEN}✓ Wait complete${NC}"
echo ""

# Check Loki
echo -e "${BLUE}5. Checking Loki...${NC}"
if curl -sf http://localhost:3100/ready > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Loki is ready${NC}"
    
    # Check if Loki has labels (means logs are being received)
    LABELS=$(curl -s http://localhost:3100/loki/api/v1/labels 2>/dev/null | jq -r '.data | length' 2>/dev/null || echo "0")
    if [ "$LABELS" -gt 0 ]; then
        echo -e "${GREEN}✓ Loki has $LABELS label(s) - logs are being collected${NC}"
    else
        echo -e "${YELLOW}⚠️  Loki is running but no logs collected yet (may take a minute)${NC}"
    fi
else
    echo -e "${RED}✗ Loki is not responding${NC}"
fi
echo ""

# Check Promtail
echo -e "${BLUE}6. Checking Promtail...${NC}"
if docker ps | grep -q promtail; then
    echo -e "${GREEN}✓ Promtail container is running${NC}"
    
    # Check Promtail logs for errors
    if docker logs promtail 2>&1 | grep -q "error"; then
        echo -e "${YELLOW}⚠️  Promtail has errors in logs:${NC}"
        docker logs promtail --tail 5 2>&1 | grep -i error
    else
        echo -e "${GREEN}✓ Promtail is running without errors${NC}"
    fi
else
    echo -e "${RED}✗ Promtail container is not running${NC}"
fi
echo ""

# Check container labels
echo -e "${BLUE}7. Checking container labels...${NC}"
for service in backend frontend python-scheduler; do
    if docker inspect $service 2>/dev/null | grep -q '"logging": "promtail"'; then
        echo -e "${GREEN}✓ $service has logging label${NC}"
    else
        echo -e "${YELLOW}⚠️  $service missing logging label${NC}"
    fi
done
echo ""

# Check Grafana
echo -e "${BLUE}8. Checking Grafana...${NC}"
if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Grafana is responding${NC}"
    
    # Check if Grafana can reach Loki
    if docker exec grafana wget -q -O- http://loki:3100/ready 2>/dev/null | grep -q "ready"; then
        echo -e "${GREEN}✓ Grafana can reach Loki${NC}"
    else
        echo -e "${YELLOW}⚠️  Grafana cannot reach Loki${NC}"
    fi
else
    echo -e "${RED}✗ Grafana is not responding${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}✓ Logging stack deployment complete!${NC}"
echo ""
echo -e "${YELLOW}Access Points:${NC}"
echo -e "  Grafana:  http://192.168.1.66:3001"
echo -e "  Username: admin"
echo -e "  Password: mining123"
echo ""
echo -e "  Loki API: http://192.168.1.66:3100"
echo -e "  Promtail: http://192.168.1.66:9080"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Open Grafana in your browser"
echo -e "  2. Go to Explore (compass icon)"
echo -e "  3. Select 'Loki' as data source"
echo -e "  4. Enter query: {container_name=\"backend\"}"
echo -e "  5. Click 'Run query'"
echo ""
echo -e "${YELLOW}Troubleshooting:${NC}"
echo -e "  If no logs appear, wait 1-2 minutes and try again"
echo -e "  Check logs: docker logs loki"
echo -e "  Check logs: docker logs promtail"
echo -e "  Full guide: cat LOGGING_TROUBLESHOOTING.md"
echo ""
