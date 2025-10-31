# Deployment Guide - GHCR Registry Method

## Overview

Since we're using **GitHub Container Registry (GHCR)**, the Raspberry Pi doesn't need any source code. All application code is pre-built into Docker images and pulled from the registry.

## What the Raspberry Pi Needs

### Required Files Only:
```
/opt/mining-stack/
├── docker-compose.prod.yml    # Docker Compose configuration
├── .env                        # Environment variables
├── etc/
│   └── miners.yaml            # Your miner configuration
├── bin/                       # Python utility scripts
│   ├── farm_init.py          # Network scanner for miners
│   ├── setup-pyasic-venv.sh  # Python environment setup
│   ├── setup-metrics-cron.sh # Metrics collection setup
│   └── fix-permissions.sh    # Permission fixer
├── docker/                    # Docker configs
│   ├── prometheus/           # Prometheus configuration
│   └── nginx/                # Nginx configuration (if needed)
├── health-check.sh           # Health monitoring script
└── update-from-registry.sh   # Update script
```

### NOT Needed on Raspberry Pi:
- ❌ `backend/src/` - Source code (compiled into Docker image)
- ❌ `frontend/src/` - Source code (compiled into Docker image)
- ❌ `node_modules/` - Dependencies (in Docker image)
- ❌ `.git/` - Git repository

## Deployment Methods

### Method 1: Automated Deployment (Recommended)

Run from your local machine:

```bash
# Set your GitHub credentials (for private repos)
export GITHUB_TOKEN="your_github_token"
export GITHUB_USERNAME="your_github_username"

# Deploy to Raspberry Pi
./deploy-from-registry.sh admin raspberrypi dvkorolev/mining-stack latest
```

This script will:
1. ✅ Copy only configuration files (excludes source code)
2. ✅ Create necessary directories
3. ✅ Set up environment variables
4. ✅ Pull Docker images from GHCR
5. ✅ Start the containers

### Method 2: Manual Deployment

If you prefer manual control:

```bash
# SSH into Raspberry Pi
ssh admin@raspberrypi

# Create directory structure
sudo mkdir -p /opt/mining-stack/{etc,bin,docker/prometheus,logs,textfile}
sudo chown -R $USER:$USER /opt/mining-stack
cd /opt/mining-stack

# Copy only these files from your repo:
# - docker-compose.prod.yml
# - .env (or create manually)
# - etc/miners.yaml
# - bin/*.py and bin/*.sh
# - docker/ directory
# - health-check.sh
# - update-from-registry.sh

# Create .env file
cat > .env << 'EOL'
GITHUB_REPOSITORY=dvkorolev/mining-stack
IMAGE_TAG=latest
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=*
EOL

# Login to GHCR (for private repos)
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Pull and start containers
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## Configuration

### miners.yaml

Your existing configuration is perfect:

```yaml
miners:
  - ip: 192.168.1.40
    model: M30S++ VH90 (Stock)
    alias: EN-M30SppVH90-040
    owner: EN
    status: active
  # ... more miners
```

The backend will auto-generate the `name` field from the IP if not provided.

### Environment Variables (.env)

Minimal required configuration:

```env
# Registry Configuration
GITHUB_REPOSITORY=dvkorolev/mining-stack
IMAGE_TAG=latest

# Application Configuration
NODE_ENV=production
PORT=5000
LOG_LEVEL=info
CORS_ORIGIN=*

# Optional: WebSocket Configuration
WS_PING_INTERVAL=30000
MINING_UPDATE_INTERVAL=5000

# Optional: Simulation Settings (for testing)
SIM_ONLINE_PROBABILITY=0.9
SIM_ERROR_PROBABILITY=0.2
```

## Updates

### Automatic Updates

The simplest way to update:

```bash
# On Raspberry Pi
cd /opt/mining-stack
./update-from-registry.sh
```

This will:
1. Pull latest images from GHCR
2. Restart containers with new images
3. Keep your configuration intact

### Manual Updates

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Restart services
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Verify
docker compose -f docker-compose.prod.yml logs -f
```

## Python Scripts

The `bin/` directory contains utility scripts that run on the host (not in Docker):

### farm_init.py
Scans your network to discover miners and generate `miners.yaml`:

```bash
cd /opt/mining-stack
python3 bin/farm_init.py
```

### setup-pyasic-venv.sh
Sets up Python virtual environment for pyasic library:

```bash
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh
```

### setup-metrics-cron.sh
Configures cron jobs for metrics collection:

```bash
cd /opt/mining-stack
./bin/setup-metrics-cron.sh
```

## Monitoring

### Check Container Status

```bash
docker compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
```

### Health Check

```bash
cd /opt/mining-stack
./health-check.sh
```

## Troubleshooting

### Images Not Pulling

If images fail to pull from GHCR:

```bash
# Check if logged in
docker login ghcr.io

# For private repos, login with token
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Verify image exists
docker pull ghcr.io/dvkorolev/mining-stack/backend:latest
docker pull ghcr.io/dvkorolev/mining-stack/frontend:latest
```

### Configuration Not Loading

```bash
# Verify miners.yaml exists and is readable
cat /opt/mining-stack/etc/miners.yaml

# Check backend logs for configuration errors
docker compose -f docker-compose.prod.yml logs backend | grep -i "miner"
```

### WebSocket Issues

```bash
# Check backend is sending data
docker compose -f docker-compose.prod.yml logs backend | grep -i "websocket"

# Verify frontend can connect
docker compose -f docker-compose.prod.yml logs frontend | grep -i "ws"
```

## Storage Requirements

Minimal storage needed on Raspberry Pi:

- **Docker Images**: ~500MB (backend + frontend + base images)
- **Configuration Files**: <1MB
- **Logs**: ~100MB (rotated automatically)
- **Python Scripts**: <5MB

**Total**: ~600MB (vs several GB with source code)

## Security Notes

1. ✅ `.env` file contains sensitive data - keep it secure (chmod 600)
2. ✅ `miners.yaml` is gitignored - won't be committed to repo
3. ✅ GITHUB_TOKEN should be kept secret - use environment variable
4. ✅ Docker containers run as non-root user
5. ✅ Only necessary ports are exposed

## Benefits of Registry Deployment

- ✅ **Minimal footprint** - No source code on Pi
- ✅ **Fast updates** - Just pull new images
- ✅ **Consistent builds** - Same image everywhere
- ✅ **Easy rollback** - Use different image tags
- ✅ **Separation of concerns** - Development vs. production
- ✅ **Reduced complexity** - No build tools needed on Pi
