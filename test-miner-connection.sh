#!/bin/bash
# Test miner connectivity from Raspberry Pi

echo "=== Testing Miner Connectivity ==="
echo ""

# Read first miner IP from miners.yaml
MINER_IP=$(grep -A 1 "miners:" etc/miners.yaml | grep "ip:" | head -1 | awk '{print $2}' | tr -d '"')

if [ -z "$MINER_IP" ]; then
    echo "Error: Could not find miner IP in etc/miners.yaml"
    exit 1
fi

echo "Testing connection to miner: $MINER_IP"
echo ""

# Test 1: Ping
echo "1. Ping test:"
if ping -c 2 $MINER_IP > /dev/null 2>&1; then
    echo "   ✓ Miner is reachable"
else
    echo "   ✗ Miner is NOT reachable"
    exit 1
fi

# Test 2: Port 4028 (CGMiner API)
echo "2. CGMiner API port (4028):"
if timeout 2 bash -c "echo -n > /dev/tcp/$MINER_IP/4028" 2>/dev/null; then
    echo "   ✓ Port 4028 is open"
else
    echo "   ✗ Port 4028 is closed or filtered"
fi

# Test 3: Port 80 (Web interface)
echo "3. Web interface (port 80):"
if timeout 2 bash -c "echo -n > /dev/tcp/$MINER_IP/80" 2>/dev/null; then
    echo "   ✓ Port 80 is open"
else
    echo "   ✗ Port 80 is closed or filtered"
fi

# Test 4: Try to get miner stats via CGMiner API
echo "4. CGMiner API test:"
echo '{"command":"stats"}' | timeout 2 nc $MINER_IP 4028 2>/dev/null | head -c 200
echo ""

echo ""
echo "=== Recommendations ==="
echo "If port 4028 is closed:"
echo "  - Check if miner API is enabled in miner settings"
echo "  - Check if firewall is blocking the connection"
echo ""
echo "If all tests pass but miners still show offline:"
echo "  - Check credentials in etc/miners.yaml"
echo "  - Check miner model names match actual hardware"
echo "  - Review python-scheduler logs for specific errors"
