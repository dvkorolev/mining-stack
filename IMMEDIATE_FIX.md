# 🚨 Immediate Fix Required

## Problem

The errors you're seeing are because:

1. **Backend is running OLD code** (before the fixes)
2. **Miners don't exist** in `etc/miners.yaml` (it's still the example file)
3. **Discovery fails** because backend is using old code that calls `python3` instead of venv Python

## Quick Fix (Development Mode)

### Step 1: Restart Backend with New Code

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Stop backend if running
# Press Ctrl+C in the terminal running backend

# Rebuild backend (TypeScript compilation)
cd backend
npm run build

# Start backend
npm start

# OR if using docker-compose in dev:
cd ..
docker-compose down
docker-compose up -d
```

### Step 2: Create Actual miners.yaml

You have two options:

**Option A: Run Discovery (Recommended)**

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Make sure venv exists
python3 -m venv venv
source venv/bin/activate
pip install pyasic

# Run discovery
./venv/bin/python3 bin/farm_init.py

# This will create etc/miners.yaml with your actual miners
```

**Option B: Manually Create miners.yaml**

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Create miners.yaml with your actual miners
cat > etc/miners.yaml << 'EOF'
miners:
  - ip: "192.168.1.40"
    name: "EN-M30SppVH90-040"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-040"
    owner: "Energo"
    
  - ip: "192.168.1.74"
    name: "EN-M30SppVH90-074"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-074"
    owner: "Energo"
EOF
```

### Step 3: Restart Backend

After creating miners.yaml, restart the backend so it loads the new config:

```bash
# If running via npm:
# Press Ctrl+C, then:
cd backend
npm start

# If running via docker:
docker-compose restart backend
```

### Step 4: Test

```bash
# Test getting miners
curl http://localhost:5000/api/mining/miners

# Should return your miners

# Test updating a miner
curl -X PUT http://localhost:5000/api/mining/miners/EN-M30SppVH90-040 \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": {
      "temperature": {
        "warning": 80,
        "critical": 90
      }
    }
  }'

# Should return success
```

---

## Root Cause Analysis

### Why 404 Errors?

The frontend is trying to update `miner-192-168-1-40`, but:
- The actual miner name in your system is probably `EN-M30SppVH90-040`
- Or the miner doesn't exist in `etc/miners.yaml` at all

The `updateMiner` function looks up miners by name OR IP:
```typescript
const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
```

So it should work with IP `192.168.1.40`, but only if that miner exists in the loaded config.

### Why 500 Error on Discovery?

The backend is running OLD code that calls:
```typescript
const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);
```

But it should call:
```typescript
const pythonPath = '/opt/mining-stack/venv/bin/python3';
const { stdout, stderr } = await execAsync(`${pythonPath} ${scriptPath}`);
```

The fix is in the code, but the backend needs to be rebuilt and restarted.

---

## Proper Development Workflow

### 1. Make Code Changes

```bash
# Edit TypeScript files
code backend/src/services/mining.service.ts
```

### 2. Rebuild Backend

```bash
cd backend
npm run build
```

### 3. Restart Backend

```bash
npm start
```

### 4. Test Changes

```bash
curl http://localhost:5000/api/mining/discover
```

---

## For Production (Raspberry Pi)

Once you've tested locally:

```bash
# Commit changes
git add .
git commit -m "Fix discovery and save issues"
git push origin main

# On Raspberry Pi
ssh admin@raspberrypi
cd /opt/mining-stack
git pull origin main
docker-compose -f docker-compose.prod.yml build backend
docker-compose -f docker-compose.prod.yml up -d
```

---

## Quick Checklist

- [ ] Backend rebuilt with new TypeScript code
- [ ] Backend restarted
- [ ] `etc/miners.yaml` exists with actual miners
- [ ] Virtual environment exists at `venv/`
- [ ] pyasic installed in venv
- [ ] Test discovery endpoint
- [ ] Test save endpoint

---

## If Still Not Working

### Check Backend Logs

```bash
# If running via npm:
# Look at terminal output

# If running via docker:
docker logs mining-stack-backend-1 --tail 100
```

### Check miners.yaml

```bash
cat etc/miners.yaml
```

Should show your actual miners, not the example template.

### Check Virtual Environment

```bash
ls -la venv/bin/python3
./venv/bin/python3 -c "import pyasic; print('OK')"
```

### Manual Test Discovery

```bash
./venv/bin/python3 bin/farm_init.py
```

Should create/update `etc/miners.yaml` with discovered miners.

---

## Expected Behavior After Fix

1. **Discovery Works**:
   ```bash
   curl -X POST http://localhost:5000/api/mining/discover
   # Returns: {"success":true,"message":"Discovered X miners","miners":[...]}
   ```

2. **Save Works**:
   ```bash
   curl -X PUT http://localhost:5000/api/mining/miners/192.168.1.40 \
     -H "Content-Type: application/json" \
     -d '{"thresholds":{"temperature":{"warning":80}}}'
   # Returns: {"success":true,"miner":{...}}
   ```

3. **Frontend Works**:
   - No 404 errors
   - No 500 errors
   - Miners save successfully
   - Discovery works

---

**Priority:** 🔴 **CRITICAL** - Backend needs restart with new code

**Time to Fix:** 5 minutes

**Steps:**
1. Rebuild backend: `cd backend && npm run build`
2. Restart backend: `npm start`
3. Create miners.yaml: Run discovery or manually create
4. Test: `curl http://localhost:5000/api/mining/miners`
