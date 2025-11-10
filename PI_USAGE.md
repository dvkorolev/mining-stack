# Raspberry Pi Deployment Scripts

## On Raspberry Pi

### Deploy/Update Services

```bash
cd /opt/mining-stack
./pi-deploy.sh
```

This script will:
1. ✅ Check registry accessibility
2. ✅ Stop existing services
3. ✅ Pull latest images from Mac registry
4. ✅ Start all services
5. ✅ Show service status

### Manual Commands

```bash
cd /opt/mining-stack

# Pull latest images
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull

# Start services
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Stop services
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down

# View all logs
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f

# View specific service logs
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f backend
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f frontend
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f python-scheduler

# Check service status
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps

# Restart specific service
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml restart backend
```

## On Mac

### Build and Deploy

```bash
# Quick deploy (build + push + deploy)
./quick-deploy.sh

# Or step by step:
./build-local.sh              # Build and push to registry
./deploy-to-pi-registry.sh    # Deploy to Pi
```

### Registry Management

```bash
# Start registry
docker compose -f docker-compose.registry.yml up -d

# Stop registry
docker compose -f docker-compose.registry.yml down

# Check registry status
docker compose -f docker-compose.registry.yml ps

# View registry contents
curl http://localhost:5001/v2/_catalog | jq .
```

## Service URLs

- **Frontend**: http://192.168.1.66:3000
- **Backend API**: http://192.168.1.66:5000
- **Grafana**: http://192.168.1.66:3001 (admin/mining123)
- **Prometheus**: http://192.168.1.66:9090
- **Registry** (from Mac): http://localhost:5001
- **Registry** (from Pi): http://100.121.189.88:5001

## Troubleshooting

### Pi can't reach registry

```bash
# On Pi, test registry access
curl http://100.121.189.88:5001/v2/

# Should return: {}
```

If it fails:
1. Check Mac firewall settings
2. Verify registry is running on Mac: `docker compose -f docker-compose.registry.yml ps`
3. Check Mac IP hasn't changed: `ifconfig | grep "inet "`

### Services won't start

```bash
# Check logs
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs

# Check if images were pulled
docker images | grep "100.121.189.88:5001"

# Manually pull images
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml pull
```

### Update registry IP

If Mac IP changes, update in:
1. `docker-compose.prod.yml` (all image URLs)
2. `pi-deploy.sh` (REGISTRY variable)
3. `/etc/docker/daemon.json` on Pi

## Quick Reference

| Task | Command |
|------|---------|
| Deploy on Pi | `./pi-deploy.sh` |
| View logs | `docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f` |
| Restart service | `docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml restart <service>` |
| Check status | `docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps` |
| Build on Mac | `./build-local.sh` |
| Full deploy from Mac | `./quick-deploy.sh` |
