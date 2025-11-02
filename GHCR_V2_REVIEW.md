# GHCR Configuration Review for V2

## ✅ Overall Status: READY FOR V2

The GHCR (GitHub Container Registry) configuration is **fully compatible** with V2 changes. No modifications needed!

---

## 1. GitHub Actions Workflow

**File:** `.github/workflows/build-and-push.yml`

**Status:** ✅ **PERFECT** - Will automatically build V2

### Configuration
```yaml
env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ${{ github.repository }}

jobs:
  build-and-push:
    strategy:
      matrix:
        include:
          - service: python-scheduler
            context: ./python-scheduler
            dockerfile: ./python-scheduler/Dockerfile
            platforms: linux/arm64
```

### What Happens
1. **Trigger:** Push to `main` or `develop`
2. **Checkout:** Gets latest code (includes V2 scheduler.py)
3. **Build:** Builds ARM64 image with V2
4. **Push:** Pushes to `ghcr.io/YOUR_REPO/python-scheduler:latest`

### Tags Created
- `latest` - Latest from main branch
- `main` - Main branch
- `develop` - Develop branch
- `v1.0.0` - Version tags
- `main-abc123` - Commit SHA

**✅ No changes needed** - Workflow will automatically include V2 code!

---

## 2. Dockerfile Review

**File:** `python-scheduler/Dockerfile`

**Status:** ✅ **COMPATIBLE** with minor optimization opportunity

### Current Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy scheduler service
COPY scheduler.py /app/

# Create directories for mounted volumes
RUN mkdir -p /metrics /app/bin /app/etc  # ⚠️ /metrics not needed in V2

# Expose API port
EXPOSE 8000

# Start scheduler service
CMD ["python", "-u", "scheduler.py"]
```

### Analysis

✅ **Works perfectly** with V2  
✅ Copies `scheduler.py` (which is now V2)  
✅ Installs `prometheus-client` from requirements.txt  
✅ Exposes port 8000 for /metrics endpoint  

⚠️ **Minor optimization:** Line 20 creates `/metrics` directory which is not used in V2

### Recommended Update (Optional)

```dockerfile
# Before (V1)
RUN mkdir -p /metrics /app/bin /app/etc

# After (V2) - Optional cleanup
RUN mkdir -p /app/etc
# Note: /metrics removed - not needed in V2
# Note: /app/bin removed - scripts not copied to image
```

**Impact:** None - directory creation doesn't hurt, just unused

---

## 3. Docker Compose Configuration

**File:** `docker-compose.prod.yml`

**Status:** ✅ **UPDATED** for V2

### Current Configuration
```yaml
python-scheduler:
  image: ghcr.io/${GITHUB_REPOSITORY:-dvkorolev/mining-stack}/python-scheduler:${IMAGE_TAG:-latest}
  platform: linux/arm64
  ports:
    - "8000:8000"
  environment:
    - MINERS_CONFIG=/app/etc/miners.yaml
    - COLLECTION_INTERVAL=2
  volumes:
    - ./etc:/app/etc
  # ✅ No /metrics volume - correct for V2!
```

### Changes Made
✅ Removed `METRICS_DIR` environment variable  
✅ Removed `metrics-data:/metrics` volume  
✅ Removed `/app/bin` volume mount  

**Perfect for V2!**

---

## 4. Requirements.txt

**File:** `python-scheduler/requirements.txt`

**Status:** ✅ **UPDATED** with prometheus-client

### Current Requirements
```txt
# Core Job Runner dependencies
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
pydantic>=2.0.0
schedule>=1.2.0

# Prometheus metrics
prometheus-client>=0.19.0  # ✅ Added for V2

# Python script dependencies
pyasic>=0.50.0
pyyaml>=6.0
netifaces>=0.11.0
aiohttp>=3.9.0

# Healthcheck
requests>=2.31.0
```

✅ **All dependencies present** for V2

---

## 5. Image Registry URLs

### Production URLs
```bash
# Python Scheduler (V2)
ghcr.io/${GITHUB_REPOSITORY}/python-scheduler:latest
ghcr.io/${GITHUB_REPOSITORY}/python-scheduler:main
ghcr.io/${GITHUB_REPOSITORY}/python-scheduler:v2.0.0

# Backend (unchanged)
ghcr.io/${GITHUB_REPOSITORY}/backend:latest

# Frontend (unchanged)
ghcr.io/${GITHUB_REPOSITORY}/frontend:latest
```

### Example with Real Repository
If your repo is `dvkorolev/mining-stack`:
```bash
ghcr.io/dvkorolev/mining-stack/python-scheduler:latest
ghcr.io/dvkorolev/mining-stack/backend:latest
ghcr.io/dvkorolev/mining-stack/frontend:latest
```

---

## 6. Build Process Verification

### What Gets Built

```
GitHub Actions Workflow
├── Checkout code (includes V2 scheduler.py)
├── Setup QEMU (ARM64 emulation)
├── Setup Docker Buildx
├── Login to ghcr.io
└── Build python-scheduler
    ├── FROM python:3.11-slim
    ├── Install gcc
    ├── COPY requirements.txt (includes prometheus-client)
    ├── RUN pip install (installs prometheus-client)
    ├── COPY scheduler.py (V2 with in-memory metrics)
    ├── EXPOSE 8000
    └── CMD ["python", "-u", "scheduler.py"]
```

### Image Contents (V2)
```
/app/
├── scheduler.py          # ✅ V2 code with in-memory metrics
├── requirements.txt      # ✅ Includes prometheus-client
└── etc/                  # Mounted from host
    └── miners.yaml
```

**✅ Everything needed for V2 is included!**

---

## 7. Deployment Flow

### Automatic Deployment

```
1. Developer pushes to GitHub
   ↓
2. GitHub Actions triggered
   ↓
3. Build ARM64 image with V2
   ↓
4. Push to ghcr.io/YOUR_REPO/python-scheduler:latest
   ↓
5. On Raspberry Pi:
   docker compose pull python-scheduler
   docker compose up -d python-scheduler
   ↓
6. V2 running!
```

### Manual Verification

```bash
# Check image was built
# Go to: https://github.com/YOUR_REPO/packages

# Pull image
docker pull ghcr.io/YOUR_REPO/python-scheduler:latest

# Verify V2 is in image
docker run --rm ghcr.io/YOUR_REPO/python-scheduler:latest \
  python -c "import prometheus_client; print('V2 Ready!')"

# Check scheduler.py version
docker run --rm ghcr.io/YOUR_REPO/python-scheduler:latest \
  grep "version.*2.0.0" scheduler.py
```

---

## 8. Potential Issues & Solutions

### Issue 1: Old Image Cached

**Problem:** Raspberry Pi pulls old V1 image from cache

**Solution:**
```bash
# Force pull latest
docker compose -f docker-compose.prod.yml pull --no-cache python-scheduler

# Or remove old image first
docker rmi ghcr.io/YOUR_REPO/python-scheduler:latest
docker compose -f docker-compose.prod.yml pull python-scheduler
```

### Issue 2: Build Fails

**Problem:** GitHub Actions build fails

**Check:**
1. Go to GitHub → Actions tab
2. Click on failed workflow
3. Review build logs

**Common causes:**
- Missing `prometheus-client` in requirements.txt ✅ Fixed
- Syntax error in scheduler.py ✅ Verified
- Dockerfile issues ✅ Verified

### Issue 3: Authentication Failed

**Problem:** Can't pull from GHCR

**Solution:**
```bash
# For private repos, login first
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Or make package public
# GitHub → Packages → python-scheduler → Settings → Change visibility
```

---

## 9. Testing the Build

### Local Build Test (Optional)

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack/python-scheduler

# Build locally for ARM64
docker buildx build --platform linux/arm64 -t test-scheduler:v2 .

# Test the image
docker run --rm -p 8000:8000 \
  -e MINERS_CONFIG=/app/etc/miners.yaml \
  -v $(pwd)/../etc:/app/etc \
  test-scheduler:v2

# Check /metrics endpoint
curl http://localhost:8000/metrics
```

### CI/CD Test

```bash
# Push to develop branch first
git checkout -b test-v2
git add .
git commit -m "Test V2 build"
git push origin test-v2

# Check GitHub Actions
# Go to: https://github.com/YOUR_REPO/actions

# If successful, merge to main
git checkout main
git merge test-v2
git push origin main
```

---

## 10. Deployment Checklist

### Pre-Deployment
- [x] scheduler.py updated to V2
- [x] requirements.txt includes prometheus-client
- [x] Dockerfile compatible with V2
- [x] docker-compose.prod.yml updated
- [x] prometheus.yml updated
- [x] GitHub Actions workflow ready

### Deployment Steps
1. [ ] Push changes to GitHub
2. [ ] Wait for GitHub Actions to complete
3. [ ] Verify image built successfully
4. [ ] SSH to Raspberry Pi
5. [ ] Pull new image
6. [ ] Restart services
7. [ ] Verify /metrics endpoint
8. [ ] Check Prometheus scraping

### Post-Deployment
- [ ] Monitor logs for errors
- [ ] Verify metrics in Prometheus
- [ ] Check Grafana dashboards
- [ ] Test manual collection
- [ ] Monitor for 24 hours

---

## 11. GHCR Package Settings

### Recommended Settings

**Visibility:**
- **Public** - Anyone can pull (no authentication needed)
- **Private** - Requires GitHub token to pull

**For this project:**
- ✅ **Public** recommended (easier deployment)
- Or keep private and use tokens

### Make Package Public

1. Go to GitHub repository
2. Click **Packages** (right sidebar)
3. Click `python-scheduler` package
4. Click **Package settings**
5. Scroll to **Danger Zone**
6. Click **Change visibility** → **Public**

---

## 12. Summary

### ✅ What's Ready

| Component | Status | Notes |
|-----------|--------|-------|
| GitHub Actions | ✅ Ready | Will build V2 automatically |
| Dockerfile | ✅ Compatible | Works perfectly with V2 |
| requirements.txt | ✅ Updated | Includes prometheus-client |
| docker-compose.prod.yml | ✅ Updated | V2 configuration |
| GHCR URLs | ✅ Correct | No changes needed |

### 🎯 Action Required

**None!** Just push to GitHub and the CI/CD will:
1. Build V2 image
2. Push to GHCR
3. Ready to deploy

### 📋 Quick Deploy Commands

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Pull latest V2 image
docker compose -f docker-compose.prod.yml pull python-scheduler

# Restart with V2
docker compose -f docker-compose.prod.yml up -d python-scheduler

# Restart Prometheus
docker compose -f docker-compose.prod.yml restart prometheus

# Verify
curl http://localhost:8000/metrics | head -20
```

---

## Conclusion

✅ **GHCR configuration is 100% ready for V2**

No changes needed to CI/CD pipeline. Just push your code and the automated build will create the V2 image with:
- In-memory Prometheus metrics
- Direct /metrics endpoint
- All dependencies included
- ARM64 platform support

**Ready to deploy!** 🚀
