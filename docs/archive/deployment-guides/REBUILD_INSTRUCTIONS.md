# Backend Container Rebuild Required

## Issue
The backend container was built before Python was added to the Dockerfile.
Python and pyasic are not installed in the current running container.

## Solution
Rebuild the backend container with the updated Dockerfile.

## Commands to Run on Raspberry Pi

```bash
# 1. Navigate to mining-stack directory
cd /opt/mining-stack

# 2. Pull latest changes (if not already done)
git pull origin main

# 3. Stop the containers
docker compose -f docker-compose.prod.yml down

# 4. Rebuild backend container (force no cache to ensure fresh build)
docker compose -f docker-compose.prod.yml build backend --no-cache

# 5. Start all containers
docker compose -f docker-compose.prod.yml up -d

# 6. Verify Python is installed
docker exec mining-stack-backend-1 python3 --version

# 7. Verify pyasic is installed
docker exec mining-stack-backend-1 python3 -c "import pyasic; print('pyasic OK')"

# 8. Check backend logs
docker logs mining-stack-backend-1 --tail 50
```

## Expected Output After Rebuild

```bash
admin@raspberrypi:/opt/mining-stack $ docker exec mining-stack-backend-1 python3 --version
Python 3.11.x

admin@raspberrypi:/opt/mining-stack $ docker exec mining-stack-backend-1 python3 -c "import pyasic; print('OK')"
OK

admin@raspberrypi:/opt/mining-stack $ docker exec mining-stack-backend-1 which python3
/usr/bin/python3
```

## What Changed in Dockerfile

The Dockerfile now installs Python and pyasic directly in the container:

```dockerfile
# Install Python, build dependencies, and pyasic
RUN apk add --no-cache \
    python3 \
    py3-pip \
    python3-dev \
    gcc \
    musl-dev \
    linux-headers && \
    pip3 install --no-cache-dir --break-system-packages pyasic pyyaml netifaces aiohttp
```

## Why --no-cache?

Using `--no-cache` ensures Docker doesn't use old cached layers and rebuilds everything fresh with the new Dockerfile instructions.

## Troubleshooting

### If build fails with "no space left on device":
```bash
# Clean up old images and containers
docker system prune -a --volumes
```

### If containers don't start:
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs backend

# Check all containers
docker ps -a
```

### If Python still not found after rebuild:
```bash
# Verify the image was rebuilt
docker images | grep mining-stack-backend

# Check the build date (should be recent)
docker inspect mining-stack-backend-1 | grep Created
```

## Time Required

- Pull changes: ~10 seconds
- Rebuild backend: ~3-5 minutes (depending on network speed)
- Start containers: ~10 seconds
- Total: ~5 minutes

## After Rebuild

Once rebuilt, the autodiscover button in the web UI should work correctly, and you'll be able to:
- Use autodiscover to find miners on the network
- Reboot miners via web UI and Telegram
- View pool configurations
- All Python-dependent features will work
