# 🧪 Test Auto-Discover

## Status Check

✅ **Virtual environment exists:** `/opt/mining-stack/venv`  
✅ **pyasic installed:** version 0.77.0  
✅ **venv mounted in docker-compose:** Line 48  

## The Problem

The backend container can see the venv mount, but the API still returns:
```
{"message":"Python virtual environment or pyasic not installed. Please run setup."}
```

## Root Cause

The backend code checks if the Python executable exists:
```typescript
const pythonPath = '/opt/mining-stack/venv/bin/python3';
if (!fs.existsSync(pythonPath)) {
  throw new Error(`Python virtual environment not found at ${pythonPath}. Please run setup.`);
}
```

**Issue:** The backend container needs to be restarted to see the newly created venv!

## Solution

### Step 1: Restart Backend Container

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Restart backend to pick up venv mount
docker compose -f docker-compose.prod.yml restart backend

# Or rebuild if you pulled new code
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend
```

### Step 2: Verify venv is visible in container

```bash
# Check if venv is mounted in container
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# Should show:
# -rwxr-xr-x ... /opt/mining-stack/venv/bin/python3
```

### Step 3: Test Auto-Discover

```bash
# Test via API
curl -X POST http://localhost:5000/api/mining/discover

# Should return:
# {"success":true,"message":"Discovered 22 miners","miners":[...]}
```

### Step 4: Test in UI

1. Open browser: http://raspberrypi:3000
2. Go to **Miners Management** page
3. Click **Auto-Discover** button
4. Should show: "Success! Discovered 22 miners"

---

## Why This Happened

1. ✅ venv was created on host: `/opt/mining-stack/venv`
2. ✅ docker-compose.prod.yml has venv mount configured
3. ❌ Backend container was running BEFORE venv was created
4. ❌ Container didn't see the venv until restart

**Solution:** Restart backend container!

---

## Complete Fix Steps

```bash
# On Raspberry Pi
cd /opt/mining-stack

# 1. Pull latest code (includes UI fixes)
git pull origin main

# 2. Rebuild containers with new code
docker compose -f docker-compose.prod.yml build backend frontend

# 3. Restart all services
docker compose -f docker-compose.prod.yml up -d

# 4. Verify venv is visible
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# 5. Test auto-discover
curl -X POST http://localhost:5000/api/mining/discover

# Should work now! ✅
```

---

## Verification

### Check 1: venv exists on host
```bash
ls -la /opt/mining-stack/venv/bin/python3
# ✅ Should exist
```

### Check 2: venv visible in container
```bash
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3
# ✅ Should exist
```

### Check 3: pyasic works in container
```bash
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"
# ✅ Should print: OK
```

### Check 4: Auto-discover works
```bash
curl -X POST http://localhost:5000/api/mining/discover
# ✅ Should return success with miners list
```

### Check 5: UI Auto-Discover button works
- Open Miners Management page
- Click Auto-Discover
- ✅ Should show success message

---

## If Still Not Working

### Option 1: Check backend logs
```bash
docker logs mining-stack-backend-1 --tail 50
```

### Option 2: Test discovery script directly on host
```bash
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate
```

### Option 3: Check file permissions
```bash
ls -la /opt/mining-stack/venv/bin/python3
# Should be executable: -rwxr-xr-x
```

### Option 4: Rebuild from scratch
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Expected Result

After restart, auto-discover should work:

**API Response:**
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
    // ... 21 more miners
  ]
}
```

**UI Message:**
```
✅ Success! Discovered 22 miners
```

---

**Status:** venv exists, just needs container restart  
**Action:** Restart backend container  
**Time:** 30 seconds  
**Priority:** 🔴 High - will fix auto-discover immediately
