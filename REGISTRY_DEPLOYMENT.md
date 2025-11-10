# Local Registry Deployment

Deploy using a local Docker registry running on your Mac. The Raspberry Pi pulls images directly from your Mac instead of transferring tar files.

## Architecture

```
┌─────────────────────────────────────┐
│   Mac (192.168.88.10)               │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Docker Registry :5000       │  │
│  │  - backend:latest            │  │
│  │  - frontend:latest           │  │
│  │  - python-scheduler:latest   │  │
│  └──────────────────────────────┘  │
└─────────────────┬───────────────────┘
                  │ docker pull
                  ▼
┌─────────────────────────────────────┐
│   Raspberry Pi (192.168.1.66)       │
│                                     │
│  Pulls images from Mac registry    │
│  No file transfers needed!          │
└─────────────────────────────────────┘
```

## Quick Start

### 1. Configure Docker Desktop (First Time Only)

```bash
./setup-registry.sh
```

Follow the instructions to configure Docker Desktop to allow the insecure registry at `192.168.88.10:5001`.

**Manual steps:**
1. Open Docker Desktop
2. Settings → Docker Engine
3. Add: `"insecure-registries": ["192.168.88.10:5001"]`
4. Apply & Restart

### 2. Start Local Registry on Mac

```bash
# Start the registry (runs in background)
docker compose -f docker-compose.registry.yml up -d

# Verify it's running
curl http://localhost:5001/v2/
```

### 3. Build and Deploy

```bash
# One command does everything
./quick-deploy.sh
```

This will:
1. Build ARM64 images on your Mac
2. Push images to local registry
3. Configure Pi to use your Mac's registry
4. Pull images on Pi
5. Restart services

## Step-by-Step

### Build and Push to Registry

```bash
./build-local.sh
```

This builds images and pushes them to `192.168.88.10:5000`.

### Deploy to Raspberry Pi

```bash
./deploy-to-pi-registry.sh
```

This:
- Configures Pi to use insecure registry (local network)
- Syncs configuration files
- Pulls images from your Mac
- Restarts services

## Benefits

✅ **Fast updates** - No tar file transfers  
✅ **Efficient** - Docker pull only downloads changed layers  
✅ **Simple** - Standard Docker workflow  
✅ **Network efficient** - Only changed layers transferred  
✅ **Instant rollback** - Just pull previous tag  

## Performance

| Operation | Time |
|-----------|------|
| First build & push | 5-10 min |
| Subsequent builds | 2-5 min (cached) |
| Pi pull & restart | 1-3 min |
| **Total** | **3-13 min** |

Compare to tar transfer: 10-25 min

## Registry Management

### View Registry Contents

```bash
# List all images
curl http://localhost:5000/v2/_catalog | jq .

# List tags for an image
curl http://localhost:5000/v2/backend/tags/list | jq .
```

### Stop Registry

```bash
docker compose -f docker-compose.registry.yml down
```

### Clean Registry

```bash
# Remove all data
docker compose -f docker-compose.registry.yml down -v
```

## Configuration

### Change Registry IP

If your Mac's IP changes:

```bash
# Update in docker-compose.prod.yml
# Change: 192.168.88.10:5000
# To: <new-ip>:5000

# Rebuild and redeploy
export REGISTRY=<new-ip>:5000
./quick-deploy.sh
```

### Use Different Port

```bash
# Edit docker-compose.registry.yml
ports:
  - "5001:5000"  # Change port

# Update REGISTRY variable
export REGISTRY=192.168.88.10:5001
```

## Troubleshooting

### Registry Not Accessible from Pi

```bash
# Check Mac firewall
# System Settings > Network > Firewall
# Allow incoming connections on port 5000

# Test from Pi
ssh admin@192.168.1.66
curl http://192.168.88.10:5000/v2/
```

### Pi Can't Pull Images

```bash
# Check insecure registry config on Pi
ssh admin@192.168.1.66
cat /etc/docker/daemon.json

# Should contain:
# {
#   "insecure-registries": ["192.168.88.10:5000"]
# }

# Restart Docker on Pi if needed
sudo systemctl restart docker
```

### Build Fails to Push

```bash
# Check registry is running
docker compose -f docker-compose.registry.yml ps

# Check buildx can access registry
docker buildx ls
```

## Advanced Usage

### Tag Versions

```bash
# Build with version tag
export IMAGE_TAG=v1.0.0
./build-local.sh

# Deploy specific version
export IMAGE_TAG=v1.0.0
./deploy-to-pi-registry.sh
```

### Rollback

```bash
# Pull previous version on Pi
ssh admin@192.168.1.66
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d
```

## Service URLs

After deployment:
- Frontend: http://192.168.1.66:3000
- Backend: http://192.168.1.66:5000
- Grafana: http://192.168.1.66:3001
- Registry: http://192.168.88.10:5000

## Notes

- Keep your Mac running for Pi to pull updates
- Registry data persists in Docker volume
- Images are automatically compressed during transfer
- Only changed layers are transferred (efficient)
- Standard Docker registry protocol (compatible with all tools)
