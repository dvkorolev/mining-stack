# Deployment Guide - Local Registry

## Quick Start

### First Time Setup

**Configure Docker Desktop to allow insecure registry:**

```bash
./setup-registry.sh
```

Follow the instructions to add `192.168.88.10:5001` to Docker Desktop's insecure registries.

### Deploy

```bash
# One command deployment
./quick-deploy.sh
```

This will:
1. Start local Docker registry on your Mac (192.168.88.10:5000)
2. Build ARM64 images and push to registry
3. Configure Raspberry Pi to pull from your Mac
4. Deploy services on Pi

## Architecture

**Mac (192.168.88.10)** → Local Registry :5001 → **Raspberry Pi (192.168.1.66)**

- Images built on Mac
- Pushed to local registry
- Pi pulls from Mac registry
- No tar file transfers!

## Commands

### Full Deployment
```bash
./quick-deploy.sh
```

### Build Only
```bash
./build-local.sh
```

### Deploy Only
```bash
./deploy-to-pi-registry.sh
```

### Registry Management
```bash
# Start registry
docker compose -f docker-compose.registry.yml up -d

# Stop registry
docker compose -f docker-compose.registry.yml down

# View registry contents
curl http://localhost:5001/v2/_catalog | jq .
```

## Configuration

**Target:** admin@192.168.1.66  
**Registry:** 192.168.88.10:5001  
**Images:** backend, frontend, python-scheduler

**Note:** Port 5001 is used because macOS uses port 5000 for AirPlay.

## Service URLs

- Frontend: http://192.168.1.66:3000
- Backend: http://192.168.1.66:5000
- Grafana: http://192.168.1.66:3001 (admin/<GF_SECURITY_ADMIN_PASSWORD>)
- Prometheus: http://192.168.1.66:9090
- Registry: http://192.168.88.10:5001

## Benefits

✅ **Fast** - Only changed layers transferred  
✅ **Efficient** - Standard Docker pull  
✅ **Simple** - No tar file management  
✅ **Network efficient** - Compressed transfers  

## Performance

- Build & push: 5-10 min (first), 2-5 min (cached)
- Pi pull & restart: 1-3 min
- **Total: 3-13 min**

## Files

- `docker-compose.registry.yml` - Registry on Mac
- `docker-compose.prod.yml` - Services on Pi
- `docker-compose.logging.yml` - Logging stack
- `build-local.sh` - Build and push
- `deploy-to-pi-registry.sh` - Deploy to Pi
- `quick-deploy.sh` - Full workflow

See [REGISTRY_DEPLOYMENT.md](REGISTRY_DEPLOYMENT.md) for detailed documentation.
