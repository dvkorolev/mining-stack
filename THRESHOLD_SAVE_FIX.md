# 🔧 Threshold Save & Auto-Discovery Fixes

## Issues Found

### 1️⃣ Failed to Save Miners (Thresholds)
**Error:** "Failed to save miners"

**Root Cause:** The `name` field in miners.yaml might be missing or the save function is trying to write to a path that doesn't exist in production.

### 2️⃣ Auto-Discovery Failed  
**Error:** "Failed to auto-discover miners. Make sure Python and pyasic are installed."

**Root Cause:** The backend is calling `python3 farm_init.py` instead of using the virtual environment's Python with pyasic installed.

---

## Fixes

### Fix 1: Update Discovery to Use Virtual Environment

**File:** `backend/src/services/mining.service.ts`

**Current Code (Line 824):**
```typescript
const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);
```

**Fixed Code:**
```typescript
const pythonPath = process.env.NODE_ENV === 'production'
  ? '/opt/mining-stack/venv/bin/python3'
  : path.join(process.cwd(), 'venv', 'bin', 'python3');

const { stdout, stderr } = await execAsync(`${pythonPath} ${scriptPath}`);
```

### Fix 2: Ensure Name Field is Always Set

**File:** `backend/src/config/miners.config.ts`

**In `saveMinersConfig` function (Line 158-165):**

**Current Code:**
```typescript
const minersData = minersToSave.map(m => {
  const data: any = {
    ip: m.ip,
    name: m.name,
    model: m.model,
    alias: m.alias,
    owner: m.owner,
  };
```

**Fixed Code:**
```typescript
const minersData = minersToSave.map(m => {
  const data: any = {
    ip: m.ip,
    name: m.name || `miner-${m.ip.replace(/\./g, '-')}`,  // Ensure name is always set
    model: m.model,
    alias: m.alias,
    owner: m.owner,
  };
```

### Fix 3: Add Better Error Handling

**File:** `backend/src/services/mining.service.ts`

**Enhanced discovery function:**
```typescript
const discoverMiners = async (): Promise<{ success: boolean; message: string; miners: any[] }> => {
  try {
    logger.info('Starting miner auto-discovery...');
    
    // Check if virtual environment exists
    const pythonPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/venv/bin/python3'
      : path.join(process.cwd(), 'venv', 'bin', 'python3');
    
    if (!fs.existsSync(pythonPath)) {
      throw new Error(`Python virtual environment not found at ${pythonPath}`);
    }
    
    // Run the Python discovery script
    const scriptPath = process.env.NODE_ENV === 'production' 
      ? '/opt/mining-stack/bin/farm_init.py'
      : path.join(process.cwd(), 'bin', 'farm_init.py');
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Discovery script not found at ${scriptPath}`);
    }
    
    logger.info(`Running discovery: ${pythonPath} ${scriptPath}`);
    
    const { stdout, stderr } = await execAsync(`${pythonPath} ${scriptPath}`, {
      timeout: 120000, // 2 minutes timeout
    });
    
    if (stderr && !stderr.includes('Found network')) {
      logger.warn('Discovery script warnings:', stderr);
    }
    
    if (stdout) {
      logger.info('Discovery output:', stdout);
    }
    
    // Reload miners configuration
    const newMiners = loadMinersConfig();
    
    return {
      success: true,
      message: `Discovered ${newMiners.length} miners`,
      miners: newMiners,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error during auto-discovery:', errorMessage);
    
    // Provide helpful error messages
    if (errorMessage.includes('not found')) {
      throw new Error('Python virtual environment or discovery script not found. Please run setup.');
    } else if (errorMessage.includes('timeout')) {
      throw new Error('Discovery timed out. Network might be slow or unreachable.');
    } else {
      throw new Error(`Failed to discover miners: ${errorMessage}`);
    }
  }
};
```

---

## Quick Fixes to Apply

### Option 1: Quick Patch (Recommended)

Apply these changes directly:

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack
```

**1. Fix discovery script path:**
```typescript
// backend/src/services/mining.service.ts line 824
// Change from:
const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);

// To:
const pythonPath = process.env.NODE_ENV === 'production'
  ? '/opt/mining-stack/venv/bin/python3'
  : path.join(process.cwd(), 'venv', 'bin', 'python3');
const { stdout, stderr } = await execAsync(`${pythonPath} ${scriptPath}`);
```

**2. Fix name field in save:**
```typescript
// backend/src/config/miners.config.ts line 160
// Change from:
name: m.name,

// To:
name: m.name || `miner-${m.ip.replace(/\./g, '-')}`,
```

### Option 2: Verify Python Environment

```bash
# On Raspberry Pi
ssh admin@raspberrypi

# Check if venv exists
ls -la /opt/mining-stack/venv/bin/python3

# Check if pyasic is installed
/opt/mining-stack/venv/bin/python3 -c "import pyasic; print(pyasic.__version__)"

# If not installed:
cd /opt/mining-stack
source venv/bin/activate
pip install pyasic
```

---

## Testing After Fixes

### Test 1: Save Miner with Thresholds

```bash
# From browser console or curl:
curl -X PUT http://192.168.1.66:5000/api/mining/miners/miner-192-168-1-40 \
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
```

### Test 2: Auto-Discovery

```bash
# From browser console or curl:
curl -X POST http://192.168.1.66:5000/api/mining/discover

# Should return: {"success":true,"message":"Discovered X miners","miners":[...]}
```

### Test 3: Check Backend Logs

```bash
# On Raspberry Pi
docker logs mining-stack-backend-1 | tail -50

# Look for:
# - "Starting miner auto-discovery..."
# - "Running discovery: /opt/mining-stack/venv/bin/python3 ..."
# - "Discovered X miners"
# - "Saved X miners to /opt/mining-stack/etc/miners.yaml"
```

---

## Root Causes Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Save fails | `name` field might be undefined | Always generate name from IP if missing |
| Discovery fails | Using system `python3` instead of venv | Use `/opt/mining-stack/venv/bin/python3` |
| No error details | Generic error messages | Add specific error handling |

---

## Prevention

### 1. Add Validation in Frontend

```typescript
// Before saving, ensure required fields
const validateMiner = (miner: MinerConfig) => {
  if (!miner.ip) throw new Error('IP is required');
  if (!miner.model) throw new Error('Model is required');
  if (!miner.name) {
    miner.name = `miner-${miner.ip.replace(/\./g, '-')}`;
  }
  return miner;
};
```

### 2. Add Health Check Endpoint

```typescript
// backend/src/routes/mining.routes.ts
router.get('/mining/health', async (req, res) => {
  const pythonPath = process.env.NODE_ENV === 'production'
    ? '/opt/mining-stack/venv/bin/python3'
    : path.join(process.cwd(), 'venv', 'bin', 'python3');
  
  const checks = {
    pythonExists: fs.existsSync(pythonPath),
    scriptExists: fs.existsSync('/opt/mining-stack/bin/farm_init.py'),
    configWritable: fs.accessSync('/opt/mining-stack/etc', fs.constants.W_OK),
  };
  
  res.json(checks);
});
```

---

## Deployment

```bash
# 1. Apply fixes locally
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# 2. Commit changes
git add backend/src/services/mining.service.ts
git add backend/src/config/miners.config.ts
git commit -m "Fix threshold save and auto-discovery issues

- Use venv Python for discovery instead of system python3
- Ensure name field is always set when saving miners
- Add better error handling and logging
- Add timeout for discovery script"

# 3. Push to GitHub
git push origin main

# 4. Deploy to Raspberry Pi
ssh admin@raspberrypi
cd /opt/mining-stack
git pull origin main

# 5. Rebuild backend
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d

# 6. Test
curl -X POST http://192.168.1.66:5000/api/mining/discover
```

---

**Status:** Ready to fix  
**Estimated Time:** 5 minutes  
**Downtime:** None (rolling restart)
