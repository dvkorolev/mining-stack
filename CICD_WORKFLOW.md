# CI/CD Workflow - Quick Reference

## ⚠️ Important: CI/CD Only

This project uses **GitHub Actions exclusively** for building and pushing Docker images.

**Do not build locally.** All builds happen automatically through GitHub Actions.

---

## Standard Workflow

### 1. Make Changes
```bash
# Edit your code
vim backend/src/index.js
```

### 2. Commit and Push
```bash
git add .
git commit -m "Update feature"
git push origin main
```

### 3. GitHub Actions Builds Automatically
- Monitor progress: https://github.com/dvkorolev/mining-stack/actions
- Builds all services (backend, frontend, python-scheduler)
- Pushes to GitHub Container Registry
- Tags as `latest` and `main`

### 4. Deploy to Raspberry Pi
```bash
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh latest
```

---

## Branch Strategy

| Branch | Purpose | Auto-Deploy |
|--------|---------|-------------|
| `main` | Production | ✅ Builds as `latest` |
| `develop` | Development | ✅ Builds as `develop` |
| `feature/*` | Features | ❌ PR only |

---

## Release Process

### Create a Release

```bash
# Tag a version
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### Deploy Release

```bash
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh v1.0.0
```

---

## Troubleshooting

### Error: "permission_denied: write_package"

**You attempted a local build.** Don't do that.

**Solution:**
```bash
git push origin main  # Let GitHub Actions handle it
```

### Build Failed on GitHub Actions

1. Go to: https://github.com/dvkorolev/mining-stack/actions
2. Click on the failed workflow
3. Review error logs
4. Fix the issue
5. Push again

### Images Not Updating

```bash
# Force pull on Raspberry Pi
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Quick Commands

```bash
# Push changes (triggers build)
git push origin main

# Check build status
# Visit: https://github.com/dvkorolev/mining-stack/actions

# Deploy latest
ssh pi@raspberrypi.local "cd /opt/mining-stack && ./update-from-registry.sh latest"

# Deploy specific version
ssh pi@raspberrypi.local "cd /opt/mining-stack && ./update-from-registry.sh v1.0.0"

# View logs
ssh pi@raspberrypi.local "cd /opt/mining-stack && docker compose -f docker-compose.prod.yml logs -f"
```

---

## Documentation

- **[GHCR CI/CD Only Guide](docs/deployment/GHCR_CICD_ONLY.md)** - Complete guide
- **[CI/CD Pipeline](docs/deployment/CI_CD.md)** - Detailed pipeline docs
- **[Troubleshooting](docs/deployment/GHCR_TROUBLESHOOTING.md)** - Common issues

---

## Summary

✅ **DO**: Push to GitHub, let Actions build  
❌ **DON'T**: Build locally, push manually  

**Workflow**: Code → Push → GitHub Actions → Deploy
