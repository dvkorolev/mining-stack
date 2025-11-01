# 🚀 Deploy Fixes to Raspberry Pi NOW

## Current Situation

Your Raspberry Pi backend is running **OLD CODE** and returning 500 errors when trying to save miners.

The logs show:
```
PUT /api/mining/miners/miner-192-168-1-74 500 34.933 ms - 118
```

This is because the backend doesn't have the fixes we just made.

---

## Deploy Fixes Immediately

### Step 1: Commit Changes Locally

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Stage all fixes
git add backend/src/config/miners.config.ts
git add backend/src/services/mining.service.ts
git add frontend/src/App.tsx
git add frontend/src/components/Sidebar.tsx
git add docker/grafana/dashboards/mining-overview.json
git add docker/alertmanager/alertmanager.yml

# Commit
git commit -m "Fix save and discovery issues

- Ensure name field is always set when saving
- Use venv Python for discovery
- Add fs import for file checks
- Better error handling"

# Push to GitHub
git push origin main
```

### Step 2: Deploy to Raspberry Pi

```bash
# SSH to Raspberry Pi (already connected)
cd /opt/mining-stack

# Pull latest changes
git pull origin main

# Rebuild backend with new code
docker compose -f docker-compose.prod.yml build backend

# Restart backend
docker compose -f docker-compose.prod.yml up -d

# Check logs
docker logs mining-stack-backend-1 --tail 20
```

### Step 3: Verify Fix

```bash
# On Raspberry Pi, test updating a miner
curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.74 \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": {
      "temperature": {
        "warning": 80,
        "critical": 90
      }
    }
  }'

# Should return: {"success":true,"miner":{...}}
# NOT a 500 error
```

---

## What the Fixes Do

### Fix 1: Name Field Always Set
**File:** `backend/src/config/miners.config.ts` line 161

**Before:**
```typescript
name: m.name,
```

**After:**
```typescript
name: m.name || `miner-${m.ip.replace(/\./g, '-')}`,
```

**Why:** Prevents undefined name values that cause save failures.

### Fix 2: Use Virtual Environment Python
**File:** `backend/src/services/mining.service.ts` line 820-822

**Before:**
```typescript
const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);
```

**After:**
```typescript
const pythonPath = process.env.NODE_ENV === 'production'
  ? '/opt/mining-stack/venv/bin/python3'
  : path.join(process.cwd(), 'venv', 'bin', 'python3');
const { stdout, stderr } = await execAsync(`${pythonPath} ${scriptPath}`);
```

**Why:** Uses Python with pyasic installed, not system Python.

### Fix 3: Add fs Import
**File:** `backend/src/services/mining.service.ts` line 16

**Added:**
```typescript
import fs from 'fs';
```

**Why:** Needed for file existence checks in discovery.

---

## Timeline

1. **Commit locally** - 1 minute
2. **Push to GitHub** - 30 seconds
3. **Pull on Raspberry Pi** - 30 seconds
4. **Rebuild backend** - 2 minutes
5. **Restart services** - 30 seconds
6. **Test** - 1 minute

**Total: ~5 minutes**

---

## Expected Results After Deploy

### Before (Current):
```
PUT /api/mining/miners/miner-192-168-1-74 500 34.933 ms - 118
❌ Error saving miner
```

### After (Fixed):
```
PUT /api/mining/miners/miner-192-168-1-74 200 15.234 ms - 245
✅ Miner saved successfully
```

---

## Verification Commands

### On Raspberry Pi:

```bash
# 1. Check backend version
docker exec mining-stack-backend-1 cat /app/package.json | grep version

# 2. Check if new code is running
docker logs mining-stack-backend-1 | grep "Loaded configuration"

# 3. Test save endpoint
curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.74 \
  -H "Content-Type: application/json" \
  -d '{"alias":"Test Update"}'

# 4. Test discovery endpoint
curl -X POST http://localhost:5000/api/mining/discover

# 5. Check miners.yaml
cat /opt/mining-stack/etc/miners.yaml
```

---

## If Rebuild Fails

### Check Docker Build Logs:
```bash
docker compose -f docker-compose.prod.yml build backend --no-cache
```

### Check TypeScript Compilation:
```bash
docker exec mining-stack-backend-1 ls -la /app/dist/services/
```

Should show compiled JavaScript files.

---

## Quick Reference

### Commands to Run on Raspberry Pi:

```bash
# Already SSH'd in, so just:
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d
docker logs mining-stack-backend-1 --tail 20
```

### Test After Deploy:

```bash
# Test save
curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.74 \
  -H "Content-Type: application/json" \
  -d '{"thresholds":{"temperature":{"warning":80}}}'

# Should return success, not 500 error
```

---

## What You'll See

### In Browser Console (Before):
```
PUT /api/mining/miners/miner-192-168-1-74 500 (Internal Server Error)
Error saving miner: Nh
```

### In Browser Console (After):
```
PUT /api/mining/miners/miner-192-168-1-74 200 (OK)
✓ Miner updated successfully
```

---

## Priority: 🔴 CRITICAL

The backend needs to be rebuilt with the new code **NOW** to fix the 500 errors.

**Action Required:**
1. Commit changes locally
2. Push to GitHub
3. Pull on Raspberry Pi
4. Rebuild backend
5. Restart services

**Time: 5 minutes**

---

**Ready to deploy? Run the commands above!** 🚀
