#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

REGISTRY="192.168.88.10:5001"

echo -e "${YELLOW}=== Docker Desktop Registry Configuration ===${NC}\n"

echo -e "${BLUE}To allow Docker to push to the local registry, you need to:${NC}\n"

echo -e "${YELLOW}1. Open Docker Desktop${NC}"
echo -e "${YELLOW}2. Click the Settings/Preferences icon (gear)${NC}"
echo -e "${YELLOW}3. Go to 'Docker Engine'${NC}"
echo -e "${YELLOW}4. Add the following to the JSON configuration:${NC}\n"

echo -e "${GREEN}Add this inside the root { } object:${NC}"
echo -e '  "insecure-registries": ["'${REGISTRY}'"]'
echo ""

echo -e "${BLUE}Example full configuration:${NC}"
cat << 'EOF'
{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false,
  "insecure-registries": ["192.168.88.10:5001"]
}
EOF

echo ""
echo -e "${YELLOW}5. Click 'Apply & Restart'${NC}"
echo -e "${YELLOW}6. Wait for Docker to restart${NC}\n"

echo -e "${BLUE}After restart, run:${NC}"
echo -e "${GREEN}./build-local.sh${NC}\n"

echo -e "${RED}Note: This is required because the local registry uses HTTP, not HTTPS${NC}"
