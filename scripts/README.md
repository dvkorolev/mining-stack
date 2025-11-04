# Scripts Directory

Utility scripts for deploying and managing the mining-stack application.

## ⚠️ Important: CI/CD Only

This project uses **GitHub Actions exclusively** for building and pushing Docker images. Local builds are not supported.

## 🚀 Smart CI/CD Available!

We now have intelligent workflows that only build and deploy what changed:
- ⚡ **60% faster** builds
- 🎯 **Zero downtime** for unchanged services
- 📊 Clear visibility of changes

**See: [Smart CI/CD Guide](../docs/deployment/SMART_CICD.md)**

## Deployment Scripts

### `deploy-fix-to-raspi.sh`
Deploys configuration fixes to Raspberry Pi.

### `fix-miners-yaml.sh`
Fixes miners.yaml configuration format.

---

## Quick Start Guide

### Development Workflow

1. **Make changes to your code**
   ```bash
   # Edit files as needed
   ```

2. **Commit and push to GitHub**
   ```bash
   git add .
   git commit -m "Update application"
   git push origin main
   ```

3. **GitHub Actions automatically builds and pushes images**
   - Monitor at: https://github.com/dvkorolev/mining-stack/actions

4. **Deploy to Raspberry Pi**
   ```bash
   ssh pi@raspberrypi.local
   cd /opt/mining-stack
   ./update-from-registry.sh latest
   ```

---

## Troubleshooting

### Permission Denied Error

If you get `permission_denied: write_package` error, you were attempting a local build.

**Solution**: Don't build locally. Use CI/CD instead:
```bash
git push origin main
```

See: [GHCR CI/CD Only Guide](../docs/deployment/GHCR_CICD_ONLY.md)

### Build Failures on GitHub Actions

1. Go to GitHub → Actions tab
2. Click on the failed workflow
3. Review error logs
4. Fix the issue in your code
5. Push again

### Images Not Updating on Raspberry Pi

```bash
# Force pull latest images
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Security Best Practices

1. **Use GitHub Actions for builds**
   - Built-in token management
   - No local credentials needed
   - Automated and secure

2. **Make packages public** (if open source)
   - No authentication needed for pulling
   - Easier deployment

3. **For private packages**
   - Use read-only tokens on Raspberry Pi
   - Only `read:packages` scope needed

---

## Additional Resources

- [GHCR CI/CD Only Guide](../docs/deployment/GHCR_CICD_ONLY.md) - **Start here**
- [CI/CD Pipeline Guide](../docs/deployment/CI_CD.md)
- [GHCR Troubleshooting Guide](../docs/deployment/GHCR_TROUBLESHOOTING.md)
- [Deployment Guide](../docs/deployment/DEPLOYMENT.md)
- [GitHub Packages Documentation](https://docs.github.com/en/packages)
