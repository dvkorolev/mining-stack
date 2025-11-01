# Deploy Dashboard Fixes to Raspberry Pi

## ✅ Easiest Method: GitHub Actions (Recommended)

Your repository already has automated ARM64 builds configured!

### Step 1: Push Changes to GitHub

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Stage the changes
git add backend/src/services/mining.service.ts
git add frontend/src/services/api.ts
git add frontend/src/pages/Dashboard.tsx

# Commit
git commit -m "Fix dashboard: stable miners, realistic BTC, smooth hashrate, 24h avg"

# Push to main branch (triggers automatic build)
git push origin main
```

### Step 2: Wait for GitHub Actions

- Go to: https://github.com/YOUR_USERNAME/mining-stack/actions
- Watch the "Build and Push to GHCR" workflow
- It will build ARM64 images in ~5-10 minutes
- Images are automatically pushed to GitHub Container Registry

### Step 3: Deploy to Raspberry Pi

Once the build completes, SSH to your Pi and update:

```bash
ssh admin@raspberrypi

cd /opt/mining-stack

# Pull latest images and restart
./update-from-registry.sh latest

# Or manually:
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Done!** Your fixes are deployed without building on the Pi.

---

## Alternative: Build on Your Mac

If you prefer to build locally on your Mac (faster than GitHub Actions):

### Prerequisites

```bash
# Enable Docker BuildKit and multi-platform builds
docker buildx create --use --name multiarch
docker buildx inspect --bootstrap
```

### Build and Push

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Build ARM64 backend image
docker buildx build \
  --platform linux/arm64 \
  --file backend/Dockerfile.arm64 \
  --tag ghcr.io/YOUR_USERNAME/mining-stack/backend:latest \
  --push \
  backend/

# Build frontend image (supports both ARM64 and AMD64)
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  --file frontend/Dockerfile \
  --tag ghcr.io/YOUR_USERNAME/mining-stack/frontend:latest \
  --push \
  frontend/
```

### Deploy to Pi

```bash
# SSH to Raspberry Pi
ssh admin@raspberrypi

cd /opt/mining-stack

# Pull and restart
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Quick Build Script (Mac)

Create a helper script to build and push:

```bash
#!/bin/bash
# File: build-and-push.sh

set -e

REPO="ghcr.io/YOUR_USERNAME/mining-stack"
TAG="${1:-latest}"

echo "🔨 Building ARM64 images for Raspberry Pi..."

# Backend
echo "📦 Building backend..."
docker buildx build \
  --platform linux/arm64 \
  --file backend/Dockerfile.arm64 \
  --tag $REPO/backend:$TAG \
  --push \
  backend/

# Frontend
echo "📦 Building frontend..."
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  --file frontend/Dockerfile \
  --tag $REPO/frontend:$TAG \
  --push \
  frontend/

echo "✅ Images pushed to $REPO"
echo ""
echo "To deploy on Raspberry Pi, run:"
echo "  ssh admin@raspberrypi 'cd /opt/mining-stack && ./update-from-registry.sh $TAG'"
```

Make it executable:
```bash
chmod +x build-and-push.sh
```

Use it:
```bash
./build-and-push.sh latest
```

---

## Verify Deployment

After deploying, check the dashboard:

```bash
# On Raspberry Pi
docker compose -f docker-compose.prod.yml logs -f backend

# Look for:
# - "Loaded configuration for X miners"
# - "Starting mining simulation"
# - No errors
```

Access dashboard at: `http://raspberrypi:3000`

Check for:
- ✅ 24h Avg Hashrate card appears
- ✅ Active Miners stays stable (doesn't flicker)
- ✅ BTC shows realistic small values (0.00000XXX)
- ✅ Hashrate graph is smooth, not jagged

---

## Troubleshooting

### Build fails on Mac
```bash
# Reset buildx
docker buildx rm multiarch
docker buildx create --use --name multiarch
docker buildx inspect --bootstrap
```

### Can't push to GHCR
```bash
# Create GitHub Personal Access Token with 'write:packages' scope
# Then login:
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### Pi can't pull images (private repo)
```bash
# On Raspberry Pi, login to GHCR:
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### Images are too large
Your current images should be small (~100-200MB each) since they're Alpine-based.
Check with:
```bash
docker images | grep mining-stack
```
