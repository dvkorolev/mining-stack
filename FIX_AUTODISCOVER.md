# 🔧 Fix Auto-Discover - Container Can't See venv

## Problem Identified! ✅

**Error Message:**
```
{"status":"error","statusCode":500,"message":"Python virtual environment or pyasic not installed. Please run setup."}
```

**Root Cause:**
The backend container **can't see the venv** even though it exists on the host at `/opt/mining-stack/venv`.

This happens because:
1. ✅ venv exists on host
2. ✅ docker-compose.prod.yml has the mount configured
3. ❌ Backend container was started BEFORE venv was created
4. ❌ Container needs restart to pick up the mount

---

## Solution: Restart Backend Container

### Quick Fix (30 seconds)

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Restart backend to pick up venv mount
docker compose -f docker-compose.prod.yml restart backend

# Wait for backend to be healthy
sleep 30

# Test auto-discover
curl -X POST http://localhost:5000/api/mining/discover

# Should return: {"success":true,"message":"Discovered 22 miners",...}
```

---

## Complete Fix (Recommended)

If restart doesn't work, rebuild with latest code:

```bash
# On Raspberry Pi
cd /opt/mining-stack

# 1. Pull latest code (includes UI improvements)
git pull origin main

# 2. Rebuild backend and frontend
docker compose -f docker-compose.prod.yml build backend frontend

# 3. Restart all services
docker compose -f docker-compose.prod.yml up -d

# 4. Wait for services to be healthy
sleep 30

# 5. Verify venv is visible in container
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# Should show: -rwxr-xr-x ... /opt/mining-stack/venv/bin/python3

# 6. Test pyasic import in container
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"

# Should print: OK

# 7. Test auto-discover
curl -X POST http://localhost:5000/api/mining/discover

# Should return success!
```

---

## Verification Steps

### Step 1: Verify venv on Host
```bash
ls -la /opt/mining-stack/venv/bin/python3
# Expected: -rwxr-xr-x ... /opt/mining-stack/venv/bin/python3
```

### Step 2: Verify venv in Container (BEFORE restart)
```bash
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3
# Expected: ls: cannot access ... No such file or directory
# This confirms the container can't see it!
```

### Step 3: Restart Backend
```bash
docker compose -f docker-compose.prod.yml restart backend
sleep 30
```

### Step 4: Verify venv in Container (AFTER restart)
```bash
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3
# Expected: -rwxr-xr-x ... /opt/mining-stack/venv/bin/python3
# Now it should work!
```

### Step 5: Test Auto-Discover
```bash
curl -X POST http://localhost:5000/api/mining/discover | jq '.'
```

**Expected Response:**
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
      "owner": "EN",
      "thresholds": {
        "hashrate": { "expected": 104.5 },
        "power": { "expected": 3100 }
      }
    },
    // ... more miners
  ]
}
```

---

## Why This Happened

### Timeline:
1. **Initial deployment** - Backend container started
2. **venv didn't exist yet** - Mount point was empty
3. **You ran setup-pyasic-venv.sh** - Created venv on host
4. **Backend still running** - Can't see new files in mount
5. **Restart needed** - To pick up the mount

### Docker Volume Mount Behavior:
- Docker mounts are established when container **starts**
- If the host directory is empty at start, mount is empty
- If files are added to host directory later, container **won't see them**
- Container must be **restarted** to pick up new files

---

## What Will Happen After Fix

### 1. UI Auto-Discover Button Will Work ✅
- Click "Auto-Discover" in Miners Management page
- Will discover all 22-23 miners
- Success message appears
- Miners list refreshes

### 2. All UI Improvements Active ✅
- **Miners Management:** Clean table (no hashrate/temp/power)
- **Analytics:** Focused metrics (no power/shares)
- **Auto-Discover:** Working!

### 3. Metrics Continue Flowing ✅
- Already working (42 metrics!)
- Will continue after restart
- No interruption

---

## Alternative: Manual Discovery (If Restart Doesn't Work)

If for some reason the restart doesn't fix it, you can use manual discovery:

```bash
# 1. Run discovery on host
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate

# 2. Regenerate Prometheus rules
source venv/bin/activate
python3 bin/generate_prometheus_rules.py
deactivate

# 3. Reload Prometheus
docker exec prometheus kill -HUP 1

# 4. Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

This achieves the same result as the UI button.

---

## Expected Results After Fix

### Test 1: Auto-Discover API
```bash
curl -X POST http://localhost:5000/api/mining/discover | jq '.success'
# Expected: true
```

### Test 2: Miners Count
```bash
curl -s http://localhost:5000/api/mining/miners | jq 'length'
# Expected: 20-25
```

### Test 3: UI Auto-Discover Button
1. Open http://raspberrypi:3000
2. Go to Miners Management
3. Click "Auto-Discover"
4. See: "Success! Discovered 22 miners"

### Test 4: Verify miners.yaml
```bash
cat /opt/mining-stack/etc/miners.yaml | grep "ip:" | wc -l
# Expected: 20-25
```

---

## Summary

| Issue | Status | Solution |
|-------|--------|----------|
| venv exists on host | ✅ Confirmed | Already done |
| venv mounted in docker-compose | ✅ Confirmed | Line 48 |
| Container can see venv | ❌ Not yet | **Restart backend** |
| Auto-discover works | ❌ Not yet | Will work after restart |

**Action Required:** Restart backend container

**Time:** 30 seconds

**Impact:** Zero downtime, metrics continue flowing

---

## Commands Summary

### Quick Fix:
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart backend
sleep 30
curl -X POST http://localhost:5000/api/mining/discover
```

### Complete Fix:
```bash
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d
sleep 30
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3
curl -X POST http://localhost:5000/api/mining/discover
```

---

**Status:** Root cause identified, fix is simple!  
**Action:** Restart backend container  
**Expected Result:** Auto-discover will work! 🚀
