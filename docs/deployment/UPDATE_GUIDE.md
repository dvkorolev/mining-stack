# Update Guide - Mining Stack

Quick reference for updating your Mining Stack deployment from GitHub Container Registry.

## 🚀 Quick Update (Recommended)

### On Raspberry Pi

```bash
cd /opt/mining-stack
./update-from-registry.sh
```

This will:
1. ✅ Pull latest configuration files from GitHub
2. ✅ Pull latest Docker images from GHCR
3. ✅ Restart services with new images
4. ✅ Preserve your miners.yaml and .env
5. ✅ Run health checks

---

## 📋 Update Options

### Update to Latest Version

```bash
./update-from-registry.sh
```

### Update to Specific Version

```bash
./update-from-registry.sh v1.2.3
```

### Update Images Only (Skip Git Sync)

```bash
./update-from-registry.sh --skip-git
```

Useful when you have local configuration changes you want to keep.

### Build from Local Source

```bash
./update-from-registry.sh --build
```

Builds images locally instead of pulling from registry. Requires full source code.

---

## 🔄 Update Process Details

### What Gets Updated

#### Configuration Files (from GitHub)
- ✅ `docker-compose.prod.yml`
- ✅ `docker/` configurations (Prometheus, Grafana, etc.)
- ✅ `python-scheduler/` code
- ✅ `bin/` scripts
- ✅ Update and health check scripts

#### Docker Images (from GHCR)
- ✅ `ghcr.io/dvkorolev/mining-stack-python-scheduler`
- ✅ `ghcr.io/dvkorolev/mining-stack-backend`
- ✅ `ghcr.io/dvkorolev/mining-stack-frontend`

### What Gets Preserved

- ✅ `etc/miners.yaml` - Your miner configuration
- ✅ `.env` - Your environment variables
- ✅ `data/` - Persistent data
- ✅ `logs/` - Log files

---

## 🛡️ Safety Features

### Automatic Backups

The update script automatically backs up:
- `.env` → `.env.backup`
- `etc/miners.yaml` → `etc/miners.yaml.backup`

Backups are restored if update fails.

### Git Stash

Local changes are automatically stashed before pulling updates:
```bash
# Stashed with timestamp
git stash push -m "Auto-stash before update 20251104_153000"
```

### Rollback on Failure

If git pull fails, the script:
1. ❌ Aborts the update
2. 🔄 Restores original configuration
3. ℹ️ Preserves system state

---

## 📊 Post-Update Verification

### Automatic Health Check

The update script automatically runs health checks:
- ✅ Docker containers running
- ✅ Network ports listening
- ✅ API endpoints responding
- ✅ Services healthy

### Manual Verification

```bash
# Check service status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Run health check manually
./health-check.sh
```

---

## 🔍 Troubleshooting

### Update Failed

```bash
# Check what went wrong
docker compose -f docker-compose.prod.yml logs

# Restore from backup if needed
cp .env.backup .env
cp etc/miners.yaml.backup etc/miners.yaml

# Try update again
./update-from-registry.sh
```

### Services Not Starting

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Restart specific service
docker compose -f docker-compose.prod.yml restart backend

# Restart all services
docker compose -f docker-compose.prod.yml restart
```

### Image Pull Failed

```bash
# Check registry connection
docker pull ghcr.io/dvkorolev/mining-stack-backend:latest

# Login to GHCR (if private repo)
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Try update again
./update-from-registry.sh
```

### Configuration Conflicts

```bash
# View local changes
git status
git diff

# Stash local changes manually
git stash

# Update
./update-from-registry.sh

# Apply stashed changes
git stash pop
```

---

## 🔐 Private Repository Access

### Setup GitHub Token

```bash
# Create token at https://github.com/settings/tokens
# Required scopes: read:packages

# Login to GHCR
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Update
./update-from-registry.sh
```

### Environment Variables

```bash
export GITHUB_TOKEN=your_token
export GITHUB_USERNAME=your_username

./update-from-registry.sh
```

---

## 📅 Update Schedule

### Recommended Schedule

- **Production**: Monthly or when critical updates available
- **Development**: Weekly or as needed
- **Critical Fixes**: Immediately

### Check for Updates

```bash
# Check GitHub releases
# https://github.com/dvkorolev/mining-stack/releases

# Check current version
docker images | grep mining-stack

# Check available versions
docker search ghcr.io/dvkorolev/mining-stack
```

---

## 🚨 Emergency Rollback

### Rollback to Previous Version

```bash
# Stop current version
docker compose -f docker-compose.prod.yml down

# Pull specific version
export IMAGE_TAG=v1.0.0
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d

# Verify
./health-check.sh
```

### Restore from Backup

```bash
# Restore configuration
cp .env.backup .env
cp etc/miners.yaml.backup etc/miners.yaml

# Restart services
docker compose -f docker-compose.prod.yml restart
```

---

## 📝 Update Checklist

Before updating:
- [ ] Check GitHub releases for breaking changes
- [ ] Backup important data
- [ ] Note current version
- [ ] Plan maintenance window

During update:
- [ ] Run update script
- [ ] Monitor logs for errors
- [ ] Verify health checks pass

After update:
- [ ] Test dashboard access
- [ ] Verify miner data collection
- [ ] Check Grafana dashboards
- [ ] Review logs for warnings

---

## 🔄 Automated Updates

### Cron Job (Optional)

```bash
# Edit crontab
crontab -e

# Add weekly update (Sundays at 2 AM)
0 2 * * 0 cd /opt/mining-stack && ./update-from-registry.sh >> /var/log/mining-stack-update.log 2>&1
```

### Systemd Timer (Advanced)

```bash
# Create timer unit
sudo nano /etc/systemd/system/mining-stack-update.timer

# Enable and start
sudo systemctl enable mining-stack-update.timer
sudo systemctl start mining-stack-update.timer
```

---

## 📞 Support

### Getting Help

- **Documentation**: `/opt/mining-stack/docs/`
- **Logs**: `docker compose logs -f`
- **Health Check**: `./health-check.sh`
- **GitHub Issues**: https://github.com/dvkorolev/mining-stack/issues

### Common Issues

1. **Port conflicts**: Check if ports 3000, 5000, 9090, 3001 are available
2. **Disk space**: Ensure sufficient space for Docker images
3. **Network**: Verify internet connection for image pulls
4. **Permissions**: Check file permissions on /opt/mining-stack

---

## 🎯 Best Practices

### Before Production Updates

1. Test update on development system
2. Review changelog for breaking changes
3. Backup configuration and data
4. Schedule during low-traffic period
5. Have rollback plan ready

### After Updates

1. Monitor logs for 24 hours
2. Verify metrics collection
3. Check alert rules still working
4. Test critical functionality
5. Document any issues

---

## 📚 Related Documentation

- [Deployment Guide](./DEPLOYMENT.md) - Initial deployment
- [Production Setup](./PRODUCTION_SETUP.md) - Production best practices
- [Troubleshooting](../operations/TROUBLESHOOTING.md) - Common issues
- [Health Checks](../operations/HEALTH_CHECKS.md) - Health monitoring

---

## 🔖 Quick Reference

```bash
# Update to latest
./update-from-registry.sh

# Update to specific version
./update-from-registry.sh v1.2.3

# Update images only
./update-from-registry.sh --skip-git

# Build locally
./update-from-registry.sh --build

# Check health
./health-check.sh

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Restart services
docker compose -f docker-compose.prod.yml restart

# Stop services
docker compose -f docker-compose.prod.yml down

# Start services
docker compose -f docker-compose.prod.yml up -d
```

---

**Last Updated**: November 4, 2025  
**Version**: 3.0  
**Tested On**: Raspberry Pi 4, Ubuntu 22.04
