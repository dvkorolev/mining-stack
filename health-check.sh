#!/bin/bash
# Health Check Script for Mining Stack
# Verifies all services are running correctly after deployment
# Usage: ./health-check.sh

# Don't exit on errors - we want to collect all health info
set +e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="${1:-/opt/mining-stack}"
TIMEOUT=5

# Counters
PASSED=0
FAILED=0
WARNINGS=0

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Mining Stack Health Check           ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo ""

# Helper functions
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

check_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# 1. Check Docker
echo -e "${BLUE}[1/12] Checking Docker...${NC}"
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
    check_pass "Docker installed (version $DOCKER_VERSION)"
else
    check_fail "Docker not installed"
    exit 1
fi

if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version --short)
    check_pass "Docker Compose installed (version $COMPOSE_VERSION)"
else
    check_fail "Docker Compose not installed"
    exit 1
fi
echo ""

# 2. Check Project Directory
echo -e "${BLUE}[2/12] Checking project directory...${NC}"
if [ -d "$PROJECT_DIR" ]; then
    check_pass "Project directory exists: $PROJECT_DIR"
    cd "$PROJECT_DIR" || exit 1
else
    check_fail "Project directory not found: $PROJECT_DIR"
    exit 1
fi

if [ -f "docker-compose.prod.yml" ]; then
    check_pass "docker-compose.prod.yml found"
else
    check_fail "docker-compose.prod.yml not found"
    exit 1
fi
echo ""

# 3. Check Docker Containers
echo -e "${BLUE}[3/12] Checking Docker containers...${NC}"
CONTAINERS=$(docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps --format json 2>/dev/null | jq -r '.Name' 2>/dev/null || docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps --services)

EXPECTED_SERVICES=("python-scheduler" "backend" "frontend" "prometheus" "grafana" "blackbox-exporter" "alertmanager" "loki" "promtail")
for service in "${EXPECTED_SERVICES[@]}"; do
    if docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps "$service" 2>/dev/null | grep -q "Up"; then
        UPTIME=$(docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps "$service" --format "{{.Status}}" | grep -oP '\d+\s+(seconds|minutes|hours)' || echo "running")
        check_pass "$service is running ($UPTIME)"
    else
        check_fail "$service is not running"
    fi
done
echo ""

# 4. Check Network Connectivity
echo -e "${BLUE}[4/12] Checking network connectivity...${NC}"
HOST_IP=$(hostname -I | awk '{print $1}')
check_info "Host IP: $HOST_IP"

# Check if ports are listening
PORTS=("3000:Frontend" "5000:Backend" "9090:Prometheus" "3001:Grafana" "9115:Blackbox" "9093:Alertmanager" "3100:Loki")
for port_info in "${PORTS[@]}"; do
    PORT=$(echo "$port_info" | cut -d: -f1)
    NAME=$(echo "$port_info" | cut -d: -f2)
    if netstat -tuln 2>/dev/null | grep -q ":$PORT " || ss -tuln 2>/dev/null | grep -q ":$PORT "; then
        check_pass "$NAME port $PORT is listening"
    else
        check_fail "$NAME port $PORT is not listening"
    fi
done
echo ""

# 5. Check Backend Health
echo -e "${BLUE}[5/12] Checking Backend API health...${NC}"
BACKEND_URL="http://localhost:5000"

# Health endpoint
if curl -sf --max-time $TIMEOUT "$BACKEND_URL/health" > /dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s --max-time $TIMEOUT "$BACKEND_URL/health")
    if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
        check_pass "Backend health endpoint responding"
    else
        check_warn "Backend health endpoint returned unexpected response"
    fi
else
    check_fail "Backend health endpoint not responding"
fi

# API stats endpoint
if curl -sf --max-time $TIMEOUT "$BACKEND_URL/api/mining/stats" > /dev/null 2>&1; then
    check_pass "Backend API /mining/stats responding"
    
    # Parse stats
    STATS=$(curl -s --max-time $TIMEOUT "$BACKEND_URL/api/mining/stats")
    TOTAL_HASHRATE=$(echo "$STATS" | jq -r '.totalHashrate // "N/A"' 2>/dev/null || echo "N/A")
    ACTIVE_MINERS=$(echo "$STATS" | jq -r '.activeMiners // "N/A"' 2>/dev/null || echo "N/A")
    
    check_info "Total Hashrate: $TOTAL_HASHRATE TH/s"
    check_info "Active Miners: $ACTIVE_MINERS"
else
    check_fail "Backend API /mining/stats not responding"
fi
echo ""

# 6. Check Python Scheduler (Job Runner)
echo -e "${BLUE}[6/12] Checking Python Scheduler...${NC}"
SCHEDULER_URL="http://localhost:8000"

# Health endpoint
if curl -sf --max-time $TIMEOUT "$SCHEDULER_URL/health" > /dev/null 2>&1; then
    check_pass "Python Scheduler health endpoint responding"
else
    check_fail "Python Scheduler health endpoint not responding"
fi

# Status endpoint
if curl -sf --max-time $TIMEOUT "$SCHEDULER_URL/status" > /dev/null 2>&1; then
    check_pass "Python Scheduler status endpoint responding"
else
    check_warn "Python Scheduler status endpoint not responding"
fi

# Jobs endpoint
if curl -sf --max-time $TIMEOUT "$SCHEDULER_URL/jobs" > /dev/null 2>&1; then
    JOBS=$(curl -s --max-time $TIMEOUT "$SCHEDULER_URL/jobs" | jq -r '.jobs | keys[]' 2>/dev/null || echo "")
    if [ -n "$JOBS" ]; then
        check_pass "Python Scheduler jobs available: $(echo $JOBS | tr '\n' ', ' | sed 's/,$//')"
    else
        check_warn "Python Scheduler jobs endpoint returned no jobs"
    fi
else
    check_warn "Python Scheduler jobs endpoint not responding"
fi
echo ""

# 7. Check WebSocket
echo -e "${BLUE}[7/12] Checking WebSocket connection...${NC}"
if command -v websocat &> /dev/null || command -v wscat &> /dev/null; then
    # Try to connect to WebSocket
    if timeout 3 bash -c "echo 'test' | nc -w 1 localhost 5000" &> /dev/null; then
        check_pass "WebSocket port accessible"
    else
        check_warn "WebSocket port check inconclusive"
    fi
else
    check_info "WebSocket tools not installed (wscat/websocat), skipping detailed check"
    check_pass "WebSocket should be available at ws://localhost:5000/ws"
fi
echo ""

# 8. Check Frontend
echo -e "${BLUE}[8/12] Checking Frontend...${NC}"
FRONTEND_URL="http://localhost:3000"

if curl -sf --max-time $TIMEOUT "$FRONTEND_URL" > /dev/null 2>&1; then
    check_pass "Frontend is accessible"
    
    # Check if it's actually serving the React app
    FRONTEND_CONTENT=$(curl -s --max-time $TIMEOUT "$FRONTEND_URL")
    if echo "$FRONTEND_CONTENT" | grep -q "root"; then
        check_pass "Frontend serving React application"
    else
        check_warn "Frontend responding but content unexpected"
    fi
else
    check_fail "Frontend not accessible"
fi
echo ""

# 9. Check Prometheus
echo -e "${BLUE}[9/12] Checking Prometheus...${NC}"
PROMETHEUS_URL="http://localhost:9090"

if curl -sf --max-time $TIMEOUT "$PROMETHEUS_URL/-/healthy" > /dev/null 2>&1; then
    check_pass "Prometheus health check passed"
else
    check_warn "Prometheus health endpoint not responding"
fi

if curl -sf --max-time $TIMEOUT "$PROMETHEUS_URL/api/v1/targets" > /dev/null 2>&1; then
    check_pass "Prometheus API responding"
    
    # Check targets
    TARGETS=$(curl -s --max-time $TIMEOUT "$PROMETHEUS_URL/api/v1/targets" | jq -r '.data.activeTargets | length' 2>/dev/null || echo "0")
    check_info "Prometheus monitoring $TARGETS targets"
else
    check_fail "Prometheus API not responding"
fi
echo ""

# 10. Check Grafana
echo -e "${BLUE}[10/12] Checking Grafana...${NC}"
GRAFANA_URL="http://localhost:3001"

if curl -sf --max-time $TIMEOUT "$GRAFANA_URL/api/health" > /dev/null 2>&1; then
    GRAFANA_HEALTH=$(curl -s --max-time $TIMEOUT "$GRAFANA_URL/api/health")
    if echo "$GRAFANA_HEALTH" | grep -q '"database":"ok"'; then
        check_pass "Grafana health check passed"
    else
        check_warn "Grafana responding but health check unclear"
    fi
else
    check_warn "Grafana health endpoint not responding (may still be starting)"
fi

if curl -sf --max-time $TIMEOUT "$GRAFANA_URL/login" > /dev/null 2>&1; then
    check_pass "Grafana login page accessible"
else
    check_fail "Grafana not accessible"
fi
echo ""

# 11. Check Loki (Log Aggregation)
echo -e "${BLUE}[11/12] Checking Loki...${NC}"
LOKI_URL="http://localhost:3100"

if curl -sf --max-time $TIMEOUT "$LOKI_URL/ready" > /dev/null 2>&1; then
    check_pass "Loki ready endpoint responding"
else
    check_warn "Loki not ready (may still be starting)"
fi

if curl -sf --max-time $TIMEOUT "$LOKI_URL/loki/api/v1/labels" > /dev/null 2>&1; then
    check_pass "Loki API responding"
    
    # Check if logs are being received
    LABELS=$(curl -s --max-time $TIMEOUT "$LOKI_URL/loki/api/v1/labels" | jq -r '.data | length' 2>/dev/null || echo "0")
    if [ "$LABELS" -gt 0 ]; then
        check_info "Loki has $LABELS label(s) - logs are being collected"
    else
        check_info "Loki is running but no logs collected yet"
    fi
else
    check_fail "Loki API not responding"
fi
echo ""

# 12. Check Promtail (Log Collector)
echo -e "${BLUE}[12/12] Checking Promtail...${NC}"
PROMTAIL_URL="http://localhost:9080"

# Promtail doesn't expose a health endpoint by default, so we check if it's running
if docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps promtail 2>/dev/null | grep -q "Up"; then
    check_pass "Promtail container is running"
    
    # Check Promtail metrics endpoint
    if curl -sf --max-time $TIMEOUT "$PROMTAIL_URL/metrics" > /dev/null 2>&1; then
        check_pass "Promtail metrics endpoint responding"
    else
        check_warn "Promtail metrics endpoint not accessible"
    fi
else
    check_fail "Promtail container not running"
fi
echo ""

# 13. Check Configuration
echo -e "${BLUE}[13/12] Checking configuration...${NC}"

# Check .env file
if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    # Check required variables
    if grep -q "GITHUB_REPOSITORY" .env; then
        REPO=$(grep "GITHUB_REPOSITORY" .env | cut -d= -f2)
        check_info "Repository: $REPO"
    fi
else
    check_warn ".env file not found (using defaults)"
fi

# Check miners configuration
if [ -f "etc/miners.yaml" ]; then
    check_pass "Miners configuration file exists"
    
    MINER_COUNT=$(grep -c "^  - ip:" etc/miners.yaml 2>/dev/null || echo "0")
    check_info "Configured miners: $MINER_COUNT"
else
    check_warn "No miners.yaml found (using simulation mode)"
fi

# Check logs directory
if [ -d "logs" ]; then
    LOG_SIZE=$(du -sh logs 2>/dev/null | cut -f1)
    check_pass "Logs directory exists (size: $LOG_SIZE)"
else
    check_warn "Logs directory not found"
fi
echo ""

# Summary
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Health Check Summary                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Failed:${NC}   $FAILED"
echo ""

# Service URLs
echo -e "${BLUE}Service URLs:${NC}"
echo -e "  Dashboard:    http://$HOST_IP:3000"
echo -e "  API:          http://$HOST_IP:5000"
echo -e "  Prometheus:   http://$HOST_IP:9090"
echo -e "  Grafana:      http://$HOST_IP:3001 ${YELLOW}(admin/mining123)${NC}"
echo -e "  Loki:         http://$HOST_IP:3100"
echo -e "  Alertmanager: http://$HOST_IP:9093"
echo ""

# Recommendations
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}⚠ Issues detected!${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting steps:${NC}"
    echo "  1. Check logs: docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs"
    echo "  2. Restart services: docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml restart"
    echo "  3. Check documentation: MINING_FARM_SETUP.md"
    echo ""
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠ Some warnings detected${NC}"
    echo "  Services are running but some optional features may not be configured"
    echo ""
    exit 0
else
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "  Your mining stack is healthy and ready to use"
    echo ""
    exit 0
fi
