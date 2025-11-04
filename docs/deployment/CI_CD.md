# CI/CD Pipeline Setup Guide

This guide explains how to set up automated builds and deployments to your Raspberry Pi using GitHub Actions and GitHub Container Registry (GHCR).

## 🚀 Smart CI/CD Available!

We now have two CI/CD workflows:

1. **Smart Workflow** (Recommended) - `build-and-push-smart.yml`
   - Only builds changed services
   - 60% faster on average
   - Zero downtime for unchanged services
   - **See: [Smart CI/CD Guide](SMART_CICD.md)**

2. **Full Workflow** - `build-and-push.yml`
   - Builds all services
   - Useful for releases and version tags
   - Documented in this guide

## Overview

The CI/CD pipeline:
1. **Detects changes** - Smart workflow identifies which services changed
2. **Builds** ARM64 Docker images on every push to `main` or `develop`
3. **Pushes** images to GitHub Container Registry (GHCR)
4. **Deploys** to Raspberry Pi by pulling pre-built images (no compilation on Pi)

## Benefits

- ✅ **No building on Raspberry Pi** - saves time and resources
- ✅ **Faster deployments** - just pull and run
- ✅ **Consistent builds** - same images across environments
- ✅ **Version control** - tagged releases and rollbacks
- ✅ **Automated** - push code, get deployed
- ✅ **Smart builds** - only build what changed (60% faster)
- ✅ **Zero downtime** - unchanged services keep running

## Setup Instructions

### 1. Enable GitHub Container Registry

GHCR is enabled by default for all GitHub repositories. No additional setup needed.

### 2. Configure Repository Settings

#### Make Package Public (Optional)

If you want to pull images without authentication:

1. Go to your repository on GitHub
2. Click on **Packages** (right sidebar)
3. Click on your package (e.g., `backend` or `frontend`)
4. Click **Package settings**
5. Scroll to **Danger Zone** → Change visibility to **Public**

#### For Private Packages

If keeping packages private, you'll need a Personal Access Token (PAT):

1. Go to GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Click **Generate new token (classic)**
3. Select scopes:
   - `read:packages` (to pull images)
   - `write:packages` (if pushing from other locations)
4. Save the token securely

### 3. Update Repository Name

Edit the following files and replace `yourusername/mining-stack` with your actual GitHub repository:

**File: `docker-compose.prod.yml`**
```yaml
image: ghcr.io/YOUR_USERNAME/YOUR_REPO/frontend:${IMAGE_TAG:-latest}
image: ghcr.io/YOUR_USERNAME/YOUR_REPO/backend:${IMAGE_TAG:-latest}
```

**File: `deploy-from-registry.sh`**
```bash
GITHUB_REPO=${3:-YOUR_USERNAME/YOUR_REPO}
```

### 4. First Deployment

#### Option A: Deploy from Development Machine

```bash
# Make scripts executable
chmod +x deploy-from-registry.sh

# Deploy to Raspberry Pi
./deploy-from-registry.sh pi raspberrypi.local YOUR_USERNAME/YOUR_REPO latest
```

For private packages:
```bash
# Set GitHub credentials
export GITHUB_USERNAME=your_username
export GITHUB_TOKEN=your_personal_access_token

# Deploy
./deploy-from-registry.sh pi raspberrypi.local YOUR_USERNAME/YOUR_REPO latest
```

#### Option B: Deploy Directly on Raspberry Pi

```bash
# SSH into your Raspberry Pi
ssh pi@raspberrypi.local

# Clone the repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/mining-stack
cd /opt/mining-stack

# Make script executable
chmod +x deploy-from-registry.sh

# Run deployment locally
./deploy-from-registry.sh $(whoami) localhost YOUR_USERNAME/YOUR_REPO latest
```

### 5. Automated Updates

#### Manual Update on Raspberry Pi

SSH into your Pi and run:
```bash
cd /opt/mining-stack
./update-from-registry.sh latest
```

#### Automated Updates with Cron

Set up a cron job to check for updates daily:

```bash
# Edit crontab
crontab -e

# Add this line (updates daily at 3 AM)
0 3 * * * cd /opt/mining-stack && ./update-from-registry.sh latest >> /var/log/mining-stack-update.log 2>&1
```

#### Webhook-based Updates (Advanced)

Create a webhook listener on your Raspberry Pi:

```bash
# Install webhook tool
sudo apt-get install webhook

# Create webhook configuration (see webhook-config.json example)
# Start webhook service
webhook -hooks webhook-config.json -verbose
```

## Workflow Details

### GitHub Actions Workflow

**File: `.github/workflows/build-and-push.yml`**

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`
- Git tags starting with `v` (e.g., `v1.0.0`)

**What it does:**
1. Checks out code
2. Sets up QEMU for ARM64 emulation
3. Sets up Docker Buildx
4. Logs into GHCR
5. Builds multi-platform images (ARM64 for backend, ARM64+AMD64 for frontend)
6. Pushes to GHCR with multiple tags:
   - `latest` (for main branch)
   - `main` or `develop` (branch name)
   - `v1.0.0` (version tags)
   - `main-abc123` (commit SHA)

### Image Tags

Images are tagged automatically:
- `latest` - Latest from main branch
- `main` - Latest from main branch
- `develop` - Latest from develop branch
- `v1.0.0` - Semantic version tags
- `main-abc123` - Specific commit

### Deployment Scripts

**`deploy-from-registry.sh`** - Initial deployment
- Copies configuration files
- Sets up environment
- Pulls images from GHCR
- Starts services

**`update-from-registry.sh`** - Updates on Pi
- Pulls latest images
- Restarts services
- Minimal downtime

## Usage Examples

### Deploy Specific Version

```bash
# Deploy version 1.0.0
./deploy-from-registry.sh pi raspberrypi.local YOUR_USERNAME/YOUR_REPO v1.0.0
```

### Deploy Specific Commit

```bash
# Deploy commit abc123 from main branch
./deploy-from-registry.sh pi raspberrypi.local YOUR_USERNAME/YOUR_REPO main-abc123
```

### Rollback to Previous Version

```bash
# On Raspberry Pi
cd /opt/mining-stack
./update-from-registry.sh v1.0.0  # Roll back to v1.0.0
```

### View Available Tags

```bash
# List all available tags for backend
docker pull ghcr.io/YOUR_USERNAME/YOUR_REPO/backend --all-tags
```

## Monitoring Deployments

### Check Running Containers

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f backend
```

### Check Image Versions

```bash
docker images | grep ghcr.io
```

## Troubleshooting

### Authentication Failed

If you get authentication errors when pulling images:

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
```

### Image Not Found

1. Check if the workflow completed successfully on GitHub
2. Verify the repository name in `docker-compose.prod.yml`
3. Check if the package is public or you're authenticated

### Build Failures

Check the GitHub Actions logs:
1. Go to your repository on GitHub
2. Click **Actions** tab
3. Click on the failed workflow run
4. Review the logs

### Out of Disk Space on Pi

Clean up old images:
```bash
# Remove unused images
docker system prune -a -f

# Remove specific old images
docker images | grep ghcr.io | grep -v latest | awk '{print $3}' | xargs docker rmi
```

## Best Practices

1. **Use semantic versioning** for releases (v1.0.0, v1.1.0, etc.)
2. **Test in develop branch** before merging to main
3. **Tag releases** for production deployments
4. **Monitor disk space** on Raspberry Pi
5. **Keep logs** of deployments for debugging
6. **Backup configurations** before major updates
7. **Use specific tags** in production (not `latest`)

## Security Considerations

1. **Never commit** GitHub tokens to the repository
2. **Use environment variables** for sensitive data
3. **Rotate tokens** regularly
4. **Use read-only tokens** on Raspberry Pi
5. **Keep packages private** if the project is not open source
6. **Update base images** regularly for security patches

## Next Steps

- Set up automated testing in CI/CD
- Add health checks to deployment
- Implement blue-green deployments
- Set up monitoring and alerting
- Create staging environment

## Support

For issues with the CI/CD pipeline:
1. Check GitHub Actions logs
2. Review this documentation
3. Open an issue on GitHub
