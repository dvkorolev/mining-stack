# 🚀 Deploy Auto-Discover Fix

## Problem Solved! ✅

**Root Cause:** Backend container didn't have Python installed. The venv Python was a symlink to host's `/usr/bin/python3`, which doesn't exist inside the container.

**Solution:** Install Python and pyasic directly in the backend container.

---

## Deployment Steps (5 minutes)

### Step 1: Pull Latest Code
```bash
cd /opt/mining-stack
git pull origin main
```

**What's new:**
- ✅ Python 3 installed in backend container
- ✅ pyasic and dependencies installed
- ✅ Backend uses system Python (no venv needed)
- ✅ UI improvements (cleaner tables)

---

### Step 2: Rebuild Backend Container
```bash
docker compose -f docker-compose.prod.yml build backend
```

**This will:**
- Install Python 3 in Alpine Linux
- Install build dependencies (gcc, musl-dev, etc.)
- Install pyasic, pyyaml, netifaces, aiohttp
- Build takes ~3-5 minutes

**Expected output:**
```
[+] Building 180.5s (15/15) FINISHED
 => [internal] load build definition
 => => transferring dockerfile
 => [internal] load .dockerignore
 => [stage-1 2/9] RUN apk add --no-cache python3 py3-pip...
 => [stage-1 3/9] RUN pip3 install --no-cache-dir pyasic...
 => exporting to image
 => => exporting layers
 => => writing image sha256:...
 => => naming to ghcr.io/.../backend:latest
```

---

### Step 3: Rebuild Frontend (Get UI Improvements)
```bash
docker compose -f docker-compose.prod.yml build frontend
```

**This includes:**
- Cleaner Miners Management page (no performance columns)
- Focused Analytics page (no power/shares)

---

### Step 4: Restart All Services
```bash
docker compose -f docker-compose.prod.yml up -d
```

**This will:**
- Start backend with Python installed
- Start frontend with UI improvements
- Restart Prometheus, Grafana, etc.
- Zero data loss (volumes preserved)

---

### Step 5: Wait for Services to be Healthy
```bash
# Wait 30 seconds
sleep 30

# Check all containers running
docker ps --format "table {{.Names}}\t{{.Status}}"
```

**Expected:**
```
NAMES                          STATUS
mining-stack-frontend-1        Up 30 seconds (healthy)
mining-stack-backend-1         Up 30 seconds (healthy)
prometheus                     Up 30 seconds
grafana                        Up 30 seconds
alertmanager                   Up 30 seconds
node-exporter                  Up 30 seconds
```

---

## Verification (2 minutes)

### Test 1: Python in Container
```bash
docker exec mining-stack-backend-1 python3 --version
```
**Expected:** `Python 3.11.x` (or similar)

---

### Test 2: pyasic Installed
```bash
docker exec mining-stack-backend-1 python3 -c "import pyasic; print('pyasic version:', pyasic.__version__)"
```
**Expected:** `pyasic version: 0.77.0` (or similar)

---

### Test 3: Discovery Script Works
```bash
docker exec mining-stack-backend-1 python3 /opt/mining-stack/bin/farm_init.py
```
**Expected:**
```
Found network: 192.168.1.0/24 (interface: eth0)
[1/3] Scanning ports...
Found 23 potential miners
[2/3] Identifying miners...
Identified 22 miners
[3/3] Creating inventory file
Success!
```

---

### Test 4: Auto-Discover API
```bash
curl -X POST http://localhost:5000/api/mining/discover | jq '.'
```
**Expected:**
```json
{
  "success": true,
  "message": "Discovered 22 miners",
  "miners": [
    {
      "ip": "192.168.1.74",
      "name": "miner-192-168-1-74",
      "model": "Antminer S19j Pro",
      "alias": "EN-S19jPro-074",
      ...
    },
    ...
  ]
}
```

---

### Test 5: UI Auto-Discover Button
1. Open browser: `http://raspberrypi:3000`
2. Go to **Miners Management** page
3. Click **"Auto-Discover"** button
4. Wait for completion (~30 seconds)
5. See success message: **"Success! Discovered 22 miners"**
6. Miners list refreshes automatically

---

### Test 6: UI Improvements
1. **Miners Management Page:**
   - ✅ Clean table with only: Status, Name, IP, Model, Alias, Owner, Actions
   - ✅ No hashrate/temp/power columns

2. **Analytics Page:**
   - ✅ Detailed statistics table
   - ✅ Columns: Miner, Status, Hashrate, Efficiency, Temperature, Rejection %
   - ✅ No Power or Shares columns

---

## Complete Test Suite

Run all smoke tests:

```bash
# 1. Backend health
curl -s http://localhost:5000/health | jq '.status'
# Expected: "ok"

# 2. Frontend accessible
curl -s http://localhost:3000 | grep -q "Mining Stack" && echo "OK"
# Expected: OK

# 3. Prometheus targets
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | .health' | grep -c "up"
# Expected: 4

# 4. Miner metrics
curl -s 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths' | jq '.data.result | length'
# Expected: 20-50 (depending on number of miners)

# 5. Auto-discover
curl -X POST http://localhost:5000/api/mining/discover | jq '.success'
# Expected: true

# 6. Miners list
curl -s http://localhost:5000/api/mining/miners | jq 'length'
# Expected: 20-25
```

---

## What Changed

### Backend Container:
**Before:**
- ❌ No Python installed
- ❌ venv symlink broken
- ❌ Auto-discover failed

**After:**
- ✅ Python 3 installed
- ✅ pyasic installed
- ✅ Auto-discover works

### Frontend:
**Before:**
- Miners Management: Too many columns
- Analytics: Too many columns

**After:**
- ✅ Miners Management: Clean, focused on management
- ✅ Analytics: Focused on key metrics

---

## Troubleshooting

### Issue: Build fails with "unable to select packages"
**Solution:** Update Alpine package index
```bash
docker compose -f docker-compose.prod.yml build --no-cache backend
```

### Issue: pyasic install fails
**Solution:** Check internet connectivity
```bash
ping pypi.org
```

### Issue: Auto-discover still fails
**Solution:** Check logs
```bash
docker logs mining-stack-backend-1 --tail 50
```

### Issue: Container won't start
**Solution:** Check for port conflicts
```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

---

## Rollback (If Needed)

If something goes wrong:

```bash
# Stop services
docker compose -f docker-compose.prod.yml down

# Pull previous version
git checkout HEAD~1

# Rebuild
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

---

## Success Criteria

✅ **All tests pass:**
- Backend health: OK
- Frontend accessible: OK
- Prometheus targets: 4 up
- Miner metrics: 20-50 results
- Auto-discover API: success = true
- UI Auto-Discover button: Works
- UI improvements: Visible

✅ **System operational:**
- All containers running
- Metrics flowing
- Alerts working
- Dashboards showing data

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| Python in container | ❌ Missing | ✅ Installed |
| pyasic in container | ❌ Missing | ✅ Installed |
| Auto-discover API | ❌ Fails | ✅ Works |
| UI Auto-Discover | ❌ Fails | ✅ Works |
| Miners Management UI | ⚠️ Cluttered | ✅ Clean |
| Analytics UI | ⚠️ Too many columns | ✅ Focused |

---

## Next Steps After Deployment

1. **Test auto-discover** in UI
2. **Verify all miners** discovered
3. **Check Grafana dashboards** for data
4. **Test alert** by setting low threshold
5. **Monitor logs** for any issues

---

## Support

If you encounter issues:

1. Check logs: `docker logs mining-stack-backend-1`
2. Verify Python: `docker exec mining-stack-backend-1 python3 --version`
3. Test discovery manually: `docker exec mining-stack-backend-1 python3 /opt/mining-stack/bin/farm_init.py`
4. Check documentation: `FINAL_AUTODISCOVER_FIX.md`

---

**Commit:** `a11708c`  
**Status:** Ready to deploy! 🚀  
**Time:** 5 minutes build + 2 minutes verification  
**Downtime:** ~30 seconds during restart
