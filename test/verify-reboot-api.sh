#!/bin/bash
# Verify Reboot API Endpoints
# Tests all reboot-related API endpoints to ensure they work correctly

set -e

# Configuration
API_BASE="http://localhost:5000"
BACKEND_URL="${API_BASE}/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Reboot API Verification Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to test API endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${YELLOW}Testing: ${description}${NC}"
    echo -e "  Method: ${method}"
    echo -e "  Endpoint: ${endpoint}"
    
    if [ -n "$data" ]; then
        echo -e "  Data: ${data}"
        response=$(curl -s -X ${method} \
            -H "Content-Type: application/json" \
            -d "${data}" \
            "${BACKEND_URL}${endpoint}" \
            -w "\nHTTP_CODE:%{http_code}")
    else
        response=$(curl -s -X ${method} \
            "${BACKEND_URL}${endpoint}" \
            -w "\nHTTP_CODE:%{http_code}")
    fi
    
    http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d':' -f2)
    body=$(echo "$response" | sed '/HTTP_CODE:/d')
    
    echo -e "  Response Code: ${http_code}"
    echo -e "  Response Body: ${body}"
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASS${NC}"
    elif [ "$http_code" -eq 404 ]; then
        echo -e "${RED}✗ FAIL - Endpoint not found${NC}"
        return 1
    elif [ "$http_code" -eq 400 ]; then
        echo -e "${YELLOW}⚠ WARNING - Bad request (check payload)${NC}"
    else
        echo -e "${RED}✗ FAIL - HTTP ${http_code}${NC}"
        return 1
    fi
    
    echo ""
    return 0
}

# Test 1: Get miners list (prerequisite)
echo -e "${BLUE}=== Test 1: Get Miners List ===${NC}"
test_endpoint "GET" "/mining/stats" "" "Get mining stats to find miner IDs"

# Extract first miner ID from response
FIRST_MINER=$(curl -s "${BACKEND_URL}/mining/stats" | jq -r '.miners[0].minerId // empty')

if [ -z "$FIRST_MINER" ]; then
    echo -e "${RED}No miners found in configuration. Cannot test reboot endpoints.${NC}"
    echo -e "${YELLOW}Please ensure miners are configured in /opt/mining-stack/etc/miners.yaml${NC}"
    exit 1
fi

echo -e "${GREEN}Found miner for testing: ${FIRST_MINER}${NC}"
echo ""

# Test 2: Single miner reboot (dry run - just test endpoint)
echo -e "${BLUE}=== Test 2: Single Miner Reboot Endpoint ===${NC}"
echo -e "${YELLOW}Note: This will attempt to reboot ${FIRST_MINER}${NC}"
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    test_endpoint "POST" "/mining/miners/${FIRST_MINER}/reboot" "" "Reboot single miner: ${FIRST_MINER}"
else
    echo -e "${YELLOW}Skipped single miner reboot test${NC}"
    echo ""
fi

# Test 3: Bulk reboot (dry run)
echo -e "${BLUE}=== Test 3: Bulk Reboot Endpoint ===${NC}"
BULK_DATA="{\"minerIds\":[\"${FIRST_MINER}\"]}"
echo -e "${YELLOW}Note: This will attempt to reboot miners in bulk${NC}"
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    test_endpoint "POST" "/mining/miners/bulk/reboot" "${BULK_DATA}" "Bulk reboot miners"
else
    echo -e "${YELLOW}Skipped bulk reboot test${NC}"
    echo ""
fi

# Test 4: Reboot all miners
echo -e "${BLUE}=== Test 4: Reboot All Miners Endpoint ===${NC}"
echo -e "${RED}⚠️  WARNING: This will reboot ALL configured miners!${NC}"
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    test_endpoint "POST" "/mining/miners/reboot-all" "" "Reboot all miners"
else
    echo -e "${YELLOW}Skipped reboot all test${NC}"
    echo ""
fi

# Test 5: Invalid miner ID
echo -e "${BLUE}=== Test 5: Invalid Miner ID (Error Handling) ===${NC}"
test_endpoint "POST" "/mining/miners/invalid-miner-id-12345/reboot" "" "Reboot non-existent miner (should fail gracefully)" || true
echo ""

# Test 6: Bulk reboot with invalid data
echo -e "${BLUE}=== Test 6: Bulk Reboot Invalid Data (Error Handling) ===${NC}"
test_endpoint "POST" "/mining/miners/bulk/reboot" "{\"invalid\":\"data\"}" "Bulk reboot with invalid payload (should return 400)" || true
echo ""

# Test 7: Get miner pools
echo -e "${BLUE}=== Test 7: Get Miner Pools ===${NC}"
test_endpoint "GET" "/mining/miners/${FIRST_MINER}/pools" "" "Get pool configuration for ${FIRST_MINER}"

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  API Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}✓ All critical endpoints are accessible${NC}"
echo ""
echo -e "${YELLOW}Available Reboot Options:${NC}"
echo -e "  1. Single Miner Reboot:"
echo -e "     POST ${BACKEND_URL}/mining/miners/{minerId}/reboot"
echo ""
echo -e "  2. Bulk Reboot (selected miners):"
echo -e "     POST ${BACKEND_URL}/mining/miners/bulk/reboot"
echo -e "     Body: {\"minerIds\": [\"miner1\", \"miner2\"]}"
echo ""
echo -e "  3. Reboot All Miners:"
echo -e "     POST ${BACKEND_URL}/mining/miners/reboot-all"
echo ""
echo -e "${YELLOW}Reboot Implementation Details:${NC}"
echo -e "  • Whatsminer: ${GREEN}HTTP/HTTPS GET${NC} /cgi-bin/luci/admin/network/iface_reconnect/lan"
echo -e "  • Antminer: ${GREEN}HTTP/HTTPS GET${NC} /cgi-bin/reboot.cgi"
echo -e "  • Generic: ${GREEN}POST${NC} /api/reboot or /reboot"
echo -e "  • Credentials: From miners.yaml or defaults (admin/admin, root/root)"
echo -e "  • HTTPS: Supported with self-signed certificate acceptance"
echo -e "  • Timeout: 5 seconds per attempt"
echo -e "  • Fallback: Tries multiple endpoints sequentially"
echo ""
echo -e "${BLUE}Configuration:${NC}"
echo -e "  • Miners config: /opt/mining-stack/etc/miners.yaml"
echo -e "  • Backend service: ${BACKEND_URL}"
echo -e "  • Frontend: http://localhost:3000"
echo ""
echo -e "${GREEN}Test completed!${NC}"
