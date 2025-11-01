# 🔧 File System Permission Fix

## The Problem

```bash
{"status":"error","statusCode":500,"message":"EROFS: read-only file system, open '/opt/mining-stack/etc/miners.yaml'"}
```

The backend container **cannot write** to `miners.yaml` because it was mounted as **read-only** (`:ro`).

---

## Root Cause

In `docker-compose.prod.yml` line 46:

```yaml
volumes:
  - ./etc/miners.yaml:/opt/mining-stack/etc/miners.yaml:ro  # ❌ Read-only!
```

The `:ro` flag makes the file read-only, preventing the backend from saving configuration changes.

---

## Fix Applied

### Changed Volume Mounts

**Before:**
```yaml
volumes:
  - ./logs:/app/logs
  - ./data:/app/data
  - ./etc/miners.yaml:/opt/mining-stack/etc/miners.yaml:ro  # ❌ Read-only
```

**After:**
```yaml
volumes:
  - ./logs:/app/logs
  - ./data:/app/data
  - ./etc:/opt/mining-stack/etc                              # ✅ Read-write entire directory
  - ./bin:/opt/mining-stack/bin:ro                           # ✅ Discovery scripts
  - ./venv:/opt/mining-stack/venv:ro                         # ✅ Python virtual environment
```

### Benefits:

1. ✅ **Write Access** - Backend can save miners.yaml
2. ✅ **Discovery Scripts** - Backend can run farm_init.py
3. ✅ **Virtual Environment** - Backend can use pyasic
4. ✅ **Entire etc Directory** - Can create backup files, temp files, etc.

---

## Deploy Fix to Raspberry Pi

### Step 1: Commit & Push

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Add all fixes
git add docker-compose.prod.yml \
        backend/src/config/miners.config.ts \
        backend/src/services/mining.service.ts \
        frontend/src/App.tsx \
        frontend/src/components/Sidebar.tsx \
        docker/grafana/dashboards/mining-overview.json \
        docker/alertmanager/alertmanager.yml

# Commit
git commit -m "Fix all issues: filesystem permissions, save, discovery, mobile UI

Critical Fixes:
- Remove read-only flag from miners.yaml mount
- Mount entire etc, bin, venv directories
- Ensure name field is always set
- Use venv Python for discovery
- Mobile UI responsive
- Grafana dashboard provisioning
- Telegram webhook-only config

Fixes Issues:
- EROFS: read-only file system error
- 500 errors when saving miners
- 404 errors for miner lookups
- Discovery using wrong Python
- Mobile UI not responsive"

# Push
git push origin main
```

### Step 2: Deploy on Raspberry Pi

```bash
# On Raspberry Pi (you're already SSH'd in)
cd /opt/mining-stack

# Pull changes
git pull origin main

# Rebuild backend (has code fixes)
docker compose -f docker-compose.prod.yml build backend

# Restart with new volume mounts
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Check backend logs
docker logs mining-stack-backend-1 --tail 20
```

### Step 3: Verify Fix

```bash
# Test 1: Save miner (should work now!)
curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.74 \
  -H "Content-Type: application/json" \
  -d '{"thresholds":{"temperature":{"warning":80,"critical":90}}}'

# Expected: {"success":true,"miner":{...}}
# NOT: EROFS error

# Test 2: Check file was updated
cat /opt/mining-stack/etc/miners.yaml

# Should show updated thresholds

# Test 3: Discovery (should work now!)
curl -X POST http://localhost:5000/api/mining/discover

# Expected: {"success":true,"message":"Discovered X miners",...}
```

---

## What Changed

### Volume Mounts Comparison

| Path | Before | After | Purpose |
|------|--------|-------|---------|
| `miners.yaml` | Read-only file | Read-write directory | Save config changes |
| `bin/` | Not mounted | Read-only | Discovery scripts |
| `venv/` | Not mounted | Read-only | Python with pyasic |

### File Access

**Before:**
```
Backend Container:
  ❌ Cannot write to miners.yaml (read-only)
  ❌ Cannot access discovery scripts
  ❌ Cannot use venv Python
```

**After:**
```
Backend Container:
  ✅ Can write to miners.yaml
  ✅ Can run farm_init.py
  ✅ Can use venv Python with pyasic
  ✅ Can create backup files
```

---

## Security Considerations

### Read-Only Mounts (Safe):
- `./bin:/opt/mining-stack/bin:ro` - Scripts don't need write access
- `./venv:/opt/mining-stack/venv:ro` - Python environment is read-only

### Read-Write Mounts (Necessary):
- `./etc:/opt/mining-stack/etc` - **Must** be writable for config saves
- `./logs:/app/logs` - **Must** be writable for logging
- `./data:/app/data` - **Must** be writable for database

### Why This is Safe:
1. Only the backend container has write access
2. Files are owned by the host user
3. Container runs as non-root (in production)
4. Limited to specific directories

---

## Testing After Deploy

### Test 1: Save Miner Configuration

```bash
curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.74 \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "Updated Miner",
    "thresholds": {
      "temperature": {
        "warning": 80,
        "critical": 90,
        "shutdown": 95
      },
      "hashrate": {
        "expected": 106,
        "warningPercent": 20,
        "criticalPercent": 50
      }
    }
  }'

# Expected Response:
# {
#   "success": true,
#   "miner": {
#     "ip": "192.168.1.74",
#     "name": "EN-M30SppVH90-074",
#     "alias": "Updated Miner",
#     "thresholds": { ... }
#   }
# }
```

### Test 2: Verify File Updated

```bash
cat /opt/mining-stack/etc/miners.yaml | grep -A20 "192.168.1.74"

# Should show:
# - ip: "192.168.1.74"
#   name: EN-M30SppVH90-074
#   alias: Updated Miner
#   thresholds:
#     temperature:
#       warning: 80
#       critical: 90
#       shutdown: 95
```

### Test 3: Auto-Discovery

```bash
curl -X POST http://localhost:5000/api/mining/discover

# Expected:
# {
#   "success": true,
#   "message": "Discovered 22 miners",
#   "miners": [...]
# }
```

### Test 4: Check Logs

```bash
docker logs mining-stack-backend-1 | grep -i "saved\|discovery"

# Should see:
# "Saved 22 miners to /opt/mining-stack/etc/miners.yaml"
# "Running discovery: /opt/mining-stack/venv/bin/python3 ..."
# "Discovered 22 miners"
```

---

## Troubleshooting

### If Still Getting EROFS Error:

```bash
# Check volume mounts
docker inspect mining-stack-backend-1 | grep -A10 Mounts

# Should show:
# "Source": "/opt/mining-stack/etc"
# "Destination": "/opt/mining-stack/etc"
# "RW": true  # ✅ Read-write!

# Check file permissions on host
ls -la /opt/mining-stack/etc/miners.yaml

# Should be writable by your user
```

### If Discovery Still Fails:

```bash
# Check venv is mounted
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# Check pyasic is installed
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"

# Check bin directory is mounted
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/bin/farm_init.py
```

### If Save Still Fails:

```bash
# Check backend logs for detailed error
docker logs mining-stack-backend-1 --tail 100 | grep -i error

# Test write permissions inside container
docker exec mining-stack-backend-1 touch /opt/mining-stack/etc/test.txt
docker exec mining-stack-backend-1 rm /opt/mining-stack/etc/test.txt

# If this fails, check host permissions:
ls -la /opt/mining-stack/etc/
```

---

## Expected Behavior After Fix

### Before (Broken):
```
PUT /api/mining/miners/192.168.1.74
Response: 500 Internal Server Error
Error: EROFS: read-only file system

POST /api/mining/discover
Response: 500 Internal Server Error
Error: python3: command not found
```

### After (Fixed):
```
PUT /api/mining/miners/192.168.1.74
Response: 200 OK
Body: {"success":true,"miner":{...}}

POST /api/mining/discover
Response: 200 OK
Body: {"success":true,"message":"Discovered 22 miners",...}
```

---

## Summary

### Problem:
- ❌ miners.yaml mounted as read-only
- ❌ Backend couldn't save configuration
- ❌ Discovery scripts not accessible
- ❌ Virtual environment not mounted

### Solution:
- ✅ Mount entire `etc/` directory as read-write
- ✅ Mount `bin/` directory for scripts
- ✅ Mount `venv/` directory for Python
- ✅ Backend can now save and discover

### Deploy:
1. Commit changes
2. Push to GitHub
3. Pull on Raspberry Pi
4. Rebuild backend
5. Restart with new mounts
6. Test save and discovery

**Time: 5 minutes**

---

**Status:** ✅ Fix Ready to Deploy

**Priority:** 🔴 **CRITICAL** - Blocks all save operations

**Action:** Deploy immediately using commands above
