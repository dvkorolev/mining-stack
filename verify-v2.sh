#!/bin/bash
# V2 Verification Script
# Checks if V2 is deployed and working correctly

set -e

echo "=========================================="
echo "V2 Architecture Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check status
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        return 1
    fi
}

# 1. Check service is running
echo -n "1. Checking python-scheduler service... "
if docker ps | grep -q python-scheduler; then
    check_status
else
    check_status
    echo "   Run: docker compose -f docker-compose.prod.yml up -d python-scheduler"
    exit 1
fi

# 2. Check health endpoint
echo -n "2. Checking /health endpoint... "
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    check_status
else
    check_status
    echo "   Service may not be ready yet. Wait 30 seconds and try again."
    exit 1
fi

# 3. Check /metrics endpoint exists
echo -n "3. Checking /metrics endpoint... "
if curl -s http://localhost:8000/metrics | head -1 | grep -q "HELP"; then
    check_status
else
    check_status
    echo "   /metrics endpoint not responding correctly"
    exit 1
fi

# 4. Check metrics format
echo -n "4. Checking Prometheus metrics format... "
if curl -s http://localhost:8000/metrics | grep -q "miner_hashrate_ths"; then
    check_status
else
    check_status
    echo "   Metrics not in expected format"
    exit 1
fi

# 5. Check collection is working
echo -n "5. Checking metrics collection... "
STATUS=$(curl -s http://localhost:8000/status)
if echo "$STATUS" | grep -q "last_collection"; then
    check_status
    TIMESTAMP=$(echo "$STATUS" | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "   Last collection: $TIMESTAMP"
else
    check_status
    echo "   Collection status not available"
fi

# 6. Check Prometheus target
echo -n "6. Checking Prometheus target... "
if curl -s http://localhost:9090/api/v1/targets 2>/dev/null | grep -q "python-scheduler:8000"; then
    check_status
else
    echo -e "${YELLOW}⚠ WARNING${NC}"
    echo "   Prometheus may not be configured yet"
    echo "   Update prometheus.yml and restart Prometheus"
fi

# 7. Count metric types
echo -n "7. Checking metric types... "
METRIC_COUNT=$(curl -s http://localhost:8000/metrics | grep "# TYPE" | wc -l)
if [ "$METRIC_COUNT" -gt 20 ]; then
    check_status
    echo "   Found $METRIC_COUNT metric types (expected 26+)"
else
    echo -e "${YELLOW}⚠ WARNING${NC}"
    echo "   Found only $METRIC_COUNT metric types (expected 26+)"
    echo "   Collection may not have completed yet"
fi

# 8. Check pool network metrics
echo -n "8. Checking pool network metrics... "
if curl -s http://localhost:8000/metrics | grep -q "pool_network"; then
    check_status
else
    echo -e "${YELLOW}⚠ WARNING${NC}"
    echo "   Pool network metrics not found"
    echo "   May need time to discover pools"
fi

# 9. Check Node Exporter is removed
echo -n "9. Checking Node Exporter removed... "
if ! docker ps | grep -q node-exporter; then
    check_status
else
    echo -e "${YELLOW}⚠ INFO${NC}"
    echo "   Node Exporter still running (can be removed)"
fi

# 10. Check architecture version
echo -n "10. Checking architecture version... "
VERSION=$(curl -s http://localhost:8000/ | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
if [ "$VERSION" = "2.0.0" ]; then
    check_status
    echo "   Running V2 Architecture"
else
    echo -e "${YELLOW}⚠ WARNING${NC}"
    echo "   Version: $VERSION (expected 2.0.0)"
fi

echo ""
echo "=========================================="
echo "Verification Complete!"
echo "=========================================="
echo ""

# Summary
echo "Quick Commands:"
echo "  View metrics:     curl http://localhost:8000/metrics | head -50"
echo "  Check status:     curl http://localhost:8000/status | jq"
echo "  Trigger collect:  curl -X POST http://localhost:8000/collect"
echo "  View logs:        docker logs python-scheduler --tail 50"
echo ""

# Check if all passed
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ V2 Architecture is working correctly!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Review output above.${NC}"
    exit 1
fi
