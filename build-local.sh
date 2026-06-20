#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Building and Pushing Docker Images to Local Registry ===${NC}"

# Configuration
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="linux/arm64"
MAC_IP="${MAC_IP:-100.121.189.88}"
REGISTRY="localhost:5001"  # Use localhost for push, Mac IP for Pi pull

# Guard against wrong-arch images (DMI-16): buildx can stamp a manifest as arm64
# while the binaries inside are another arch, which then dies with "exec format
# error" on the Pi. Run the freshly-built image and assert its real machine type
# is aarch64 BEFORE pushing. Fails loud so a broken image never reaches the Pi.
verify_arch() {
  local image="$1"
  local arch
  arch=$(docker run --rm --entrypoint "" "${image}" uname -m 2>/dev/null)
  if [ "${arch}" != "aarch64" ]; then
    echo -e "${RED}✗ ARCH MISMATCH: ${image} runs as '${arch:-unknown}', expected aarch64 (arm64).${NC}"
    echo -e "${RED}  Manifest may claim arm64 while binaries are wrong-arch — see DMI-16. Aborting, not pushing.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ ${image} verified arm64 (uname -m = ${arch})${NC}"
}

# Check if local registry is running
echo -e "${YELLOW}Checking local registry...${NC}"
if ! curl -s http://localhost:5001/v2/ > /dev/null 2>&1; then
    echo -e "${RED}Local registry is not running!${NC}"
    echo -e "${YELLOW}Starting local registry...${NC}"
    docker compose -f docker-compose.registry.yml up -d
    sleep 3
fi
echo -e "${GREEN}✓ Registry is running${NC}"

# Build and push backend
echo -e "\n${YELLOW}Building backend...${NC}"
docker buildx build \
  --platform ${PLATFORM} \
  --tag ${REGISTRY}/backend:${IMAGE_TAG} \
  --load \
  -f backend/Dockerfile \
  backend/
verify_arch ${REGISTRY}/backend:${IMAGE_TAG}
docker push ${REGISTRY}/backend:${IMAGE_TAG}
echo -e "${GREEN}✓ Backend pushed to registry${NC}"

# Build and push frontend
echo -e "\n${YELLOW}Building frontend...${NC}"
docker buildx build \
  --platform ${PLATFORM} \
  --tag ${REGISTRY}/frontend:${IMAGE_TAG} \
  --load \
  -f frontend/Dockerfile \
  frontend/
verify_arch ${REGISTRY}/frontend:${IMAGE_TAG}
docker push ${REGISTRY}/frontend:${IMAGE_TAG}
echo -e "${GREEN}✓ Frontend pushed to registry${NC}"

# Build and push python-scheduler
echo -e "\n${YELLOW}Building python-scheduler...${NC}"
docker buildx build \
  --platform ${PLATFORM} \
  --tag ${REGISTRY}/python-scheduler:${IMAGE_TAG} \
  --load \
  -f python-scheduler/Dockerfile \
  python-scheduler/
verify_arch ${REGISTRY}/python-scheduler:${IMAGE_TAG}
docker push ${REGISTRY}/python-scheduler:${IMAGE_TAG}
echo -e "${GREEN}✓ Python-scheduler pushed to registry${NC}"

echo -e "\n${GREEN}=== Build and Push Complete ===${NC}"
echo -e "Images pushed to: ${REGISTRY}"
echo -e "Pi will pull from: ${MAC_IP}:5001"
echo -e "\nRegistry contents:"
curl -s http://localhost:5001/v2/_catalog | jq .

echo -e "\n${GREEN}Next step: Run ./deploy-to-pi-registry.sh to deploy to Raspberry Pi${NC}"
