# Quick Start: CI/CD Deployment

Get your Mining Stack running on Raspberry Pi in 5 minutes using pre-built images.

## Prerequisites

- Raspberry Pi with Docker installed
- GitHub repository with this code
- SSH access to your Raspberry Pi

## Step 1: Update Repository Name

Edit `docker-compose.prod.yml` and replace `yourusername/mining-stack`:

```yaml
image: ghcr.io/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/frontend:${IMAGE_TAG:-latest}
image: ghcr.io/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/backend:${IMAGE_TAG:-latest}
```

## Step 2: Push to GitHub

```bash
git add .
git commit -m "Setup CI/CD pipeline"
git push origin main
```

This triggers the GitHub Actions workflow to build and push images.

## Step 3: Wait for Build

1. Go to your GitHub repository
2. Click **Actions** tab
3. Wait for the workflow to complete (~5-10 minutes)
4. Verify images are published in **Packages** section

## Step 4: Deploy to Raspberry Pi

### Option A: From Your Computer

```bash
chmod +x deploy-from-registry.sh
./deploy-from-registry.sh pi raspberrypi.local YOUR_USERNAME/YOUR_REPO latest
```

### Option B: On Raspberry Pi

```bash
# SSH into Pi
ssh pi@raspberrypi.local

# Clone repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/mining-stack
cd /opt/mining-stack

# Deploy
chmod +x deploy-from-registry.sh
./deploy-from-registry.sh $(whoami) localhost YOUR_USERNAME/YOUR_REPO latest
```

## Step 5: Access Your Dashboard

Open in browser:
- **Dashboard**: http://raspberrypi.local:3000
- **Grafana**: http://raspberrypi.local:3001 (admin/mining123)

## Updating

### Automatic (Recommended)

Every time you push to `main`, GitHub Actions builds new images.

To update your Raspberry Pi:

```bash
ssh pi@raspberrypi.local
cd /opt/mining-stack
./update-from-registry.sh latest
```

### Set Up Auto-Updates

```bash
# On Raspberry Pi
crontab -e

# Add this line (updates daily at 3 AM)
0 3 * * * cd /opt/mining-stack && ./update-from-registry.sh latest >> /var/log/mining-update.log 2>&1
```

## Troubleshooting

### Images not found?

Make packages public:
1. GitHub → Your Repo → Packages
2. Click package → Package settings
3. Change visibility to Public

Or login to GHCR:
```bash
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

### Build failed?

Check GitHub Actions logs:
- GitHub → Actions → Click failed workflow

### Service not starting?

Check logs:
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml logs -f
```

## What's Next?

- Read [CI_CD_SETUP.md](CI_CD_SETUP.md) for detailed documentation
- Set up monitoring and alerts
- Configure automated backups
- Customize your dashboard

## Key Commands

```bash
# Update to latest
./update-from-registry.sh latest

# Deploy specific version
./update-from-registry.sh v1.0.0

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check status
docker compose -f docker-compose.prod.yml ps

# Restart services
docker compose -f docker-compose.prod.yml restart
```

## Benefits of This Setup

✅ **No building on Pi** - Images built in GitHub Actions  
✅ **Fast deployments** - Just pull and run  
✅ **Easy rollbacks** - Deploy any previous version  
✅ **Automated** - Push code, get deployed  
✅ **Consistent** - Same images everywhere  

---

**Need help?** Check [CI_CD_SETUP.md](CI_CD_SETUP.md) for detailed documentation.
