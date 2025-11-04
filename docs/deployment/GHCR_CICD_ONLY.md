# GitHub Container Registry - CI/CD Only Approach

This project uses **GitHub Actions exclusively** for building and pushing Docker images to GitHub Container Registry (GHCR). Local builds are not supported.

## Why CI/CD Only?

- ✅ **Consistent builds** - Same environment every time
- ✅ **No local setup** - No need for Personal Access Tokens on dev machines
- ✅ **Automated** - Push code, get images automatically
- ✅ **Secure** - Built-in GitHub token management
- ✅ **Multi-platform** - ARM64 builds without local emulation overhead

---

## How It Works

### 1. Push Code to GitHub

```bash
git add .
git commit -m "Your changes"
git push origin main
```

### 2. GitHub Actions Builds Automatically

The workflow (`.github/workflows/build-and-push.yml`) automatically:
- Builds all three services (backend, frontend, python-scheduler)
- Creates multi-platform images (ARM64 for Raspberry Pi)
- Pushes to GHCR with appropriate tags
- Uses built-in `GITHUB_TOKEN` (no manual token needed)

### 3. Deploy to Raspberry Pi

```bash
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh latest
```

---

## Workflow Triggers

The CI/CD pipeline runs on:

- **Push to `main` branch** → Builds and tags as `latest` and `main`
- **Push to `develop` branch** → Builds and tags as `develop`
- **Git tags** (e.g., `v1.0.0`) → Builds and tags as version
- **Pull requests to `main`** → Builds but doesn't push (test only)

---

## Image Tags

GitHub Actions automatically creates these tags:

| Trigger | Tags Created | Example |
|---------|-------------|---------|
| Push to `main` | `latest`, `main`, `main-{sha}` | `latest`, `main`, `main-abc123` |
| Push to `develop` | `develop`, `develop-{sha}` | `develop`, `develop-def456` |
| Tag `v1.0.0` | `v1.0.0`, `1.0`, `latest` | `v1.0.0`, `1.0` |

---

## Monitoring Builds

### Check Build Status

1. Go to your repository on GitHub
2. Click **Actions** tab
3. View the "Build and Push to GHCR" workflow runs

### View Build Logs

Click on any workflow run to see detailed logs for each service build.

---

## Deployment Workflow

### Initial Deployment

```bash
# From your development machine
./deploy-from-registry.sh pi raspberrypi.local dvkorolev/mining-stack latest
```

### Update Existing Deployment

```bash
# SSH into Raspberry Pi
ssh pi@raspberrypi.local
cd /opt/mining-stack

# Pull latest images and restart
./update-from-registry.sh latest
```

### Deploy Specific Version

```bash
# Deploy a tagged version
./update-from-registry.sh v1.0.0

# Deploy from develop branch
./update-from-registry.sh develop

# Deploy specific commit
./update-from-registry.sh main-abc123
```

---

## Fixing the Permission Error

If you encountered the `permission_denied: write_package` error, it was likely from attempting a local build. Here's what to do:

### The Error
```
ERROR: failed to push ghcr.io/dvkorolev/mining-stack/backend:main: 
denied: permission_denied: write_package
```

### The Solution

**Don't build locally.** Instead:

1. **Commit and push your changes:**
   ```bash
   git add .
   git commit -m "Update application"
   git push origin main
   ```

2. **Wait for GitHub Actions to complete:**
   - Go to GitHub → Actions tab
   - Wait for the build to finish (usually 5-10 minutes)

3. **Deploy on Raspberry Pi:**
   ```bash
   ssh pi@raspberrypi.local
   cd /opt/mining-stack
   ./update-from-registry.sh latest
   ```

### Why This Works

- GitHub Actions uses the built-in `GITHUB_TOKEN` which automatically has `write:packages` permission
- No need to create or manage Personal Access Tokens
- No need to configure Docker authentication locally
- More secure and maintainable

---

## Package Visibility

### Make Packages Public (Recommended for Open Source)

If your project is open source, make packages public to avoid authentication when pulling:

1. Go to GitHub → Your repository
2. Click **Packages** (right sidebar)
3. Click on each package (`backend`, `frontend`, `python-scheduler`)
4. Click **Package settings**
5. Scroll to **Danger Zone** → Change visibility to **Public**

### For Private Packages

If keeping packages private, the Raspberry Pi needs authentication:

```bash
# On Raspberry Pi, create a read-only token
# Go to: https://github.com/settings/tokens
# Create token with only: read:packages

# Login once
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

---

## Troubleshooting

### Build Failed on GitHub Actions

**Check the logs:**
1. Go to GitHub → Actions tab
2. Click on the failed workflow
3. Review error messages

**Common issues:**
- Dockerfile syntax errors
- Missing dependencies
- Build context issues

**Fix:**
1. Fix the issue in your code
2. Commit and push again
3. GitHub Actions will retry automatically

### Images Not Updating on Pi

**Verify the tag:**
```bash
# Check what tag you're using
grep IMAGE_TAG /opt/mining-stack/.env

# Pull specific tag
docker pull ghcr.io/dvkorolev/mining-stack/backend:main
```

**Force update:**
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Workflow Not Triggering

**Check:**
- Workflow file is in `.github/workflows/` directory
- You pushed to `main` or `develop` branch
- Workflow file has no syntax errors

**Manually trigger:**
You can add a manual trigger to the workflow:
```yaml
on:
  workflow_dispatch:  # Allows manual trigger from GitHub UI
  push:
    branches:
      - main
      - develop
```

---

## Best Practices

1. **Always use CI/CD** - Never build and push locally
2. **Test in develop branch** - Merge to main only when ready
3. **Use semantic versioning** - Tag releases as `v1.0.0`, `v1.1.0`, etc.
4. **Monitor builds** - Check Actions tab after each push
5. **Use specific tags in production** - Avoid `latest` for critical deployments
6. **Keep packages public** (if open source) - Easier deployment

---

## Development Workflow

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Make changes
# ... edit code ...

# 3. Test locally (without building images)
# Use existing images or docker-compose.dev.yml

# 4. Commit and push
git add .
git commit -m "Add new feature"
git push origin feature/new-feature

# 5. Create Pull Request
# GitHub will build but not push images

# 6. After review, merge to develop
# GitHub Actions builds and pushes to develop tag

# 7. Test on staging/develop environment
./update-from-registry.sh develop

# 8. When ready, merge to main
# GitHub Actions builds and pushes to latest
```

### Release Process

```bash
# 1. Ensure main branch is stable
git checkout main
git pull

# 2. Create version tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# 3. GitHub Actions builds and tags as v1.0.0

# 4. Deploy to production
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh v1.0.0
```

---

## Quick Reference

### Deploy Latest from Main
```bash
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh latest
```

### Deploy Specific Version
```bash
./update-from-registry.sh v1.0.0
```

### Check Running Images
```bash
docker images | grep ghcr.io/dvkorolev/mining-stack
```

### View Logs
```bash
docker compose -f docker-compose.prod.yml logs -f
```

### Rollback
```bash
# Deploy previous version
./update-from-registry.sh v0.9.0
```

---

## Summary

- ✅ **Push code to GitHub** - CI/CD handles everything
- ✅ **No local builds** - Keeps development simple
- ✅ **No token management** - GitHub handles authentication
- ✅ **Consistent builds** - Same environment every time
- ✅ **Easy deployment** - Just run update script on Pi

**Remember:** Never build locally. Always push to GitHub and let CI/CD do the work.
