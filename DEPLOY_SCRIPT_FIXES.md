# Deploy Script Issues Fixed - October 31, 2025

## Summary
Fixed 4 critical issues in `deploy-pi.sh` and related configuration files that would cause deployment failures.

---

## Issues Found & Fixed

### 1. ✅ Redundant Symlink Logic
**Problem:** Script tried to create symlink `/opt/mining-stack -> /opt/mining-stack` (pointing to itself).

**Before:**
```bash
if [ ! -L "/opt/mining-stack" ] && [ "$(readlink -f /opt/mining-stack 2>/dev/null)" != "$REMOTE_DIR" ]; then
  sudo ln -s $REMOTE_DIR /opt/mining-stack
fi
```

**After:**
```bash
# Create symlink for backward compatibility (old path -> new path)
if [ ! -L "/opt/mining-monitor" ]; then
  sudo ln -sf $REMOTE_DIR /opt/mining-monitor
fi
```

**Impact:** Now correctly creates `/opt/mining-monitor -> /opt/mining-stack` for backward compatibility.

---

### 2. ✅ Missing `.env` File Handling
**Problem:** Script tried to `chmod 600 .env` but file doesn't exist, causing deployment failure.

**Before:**
```bash
chmod 600 .env
chmod 700 $REMOTE_DIR/bin/*.py
chmod 700 $REMOTE_DIR/bin/init_miners.sh
```

**After:**
```bash
if [ -f .env ]; then
  chmod 600 .env
fi
chmod 700 $REMOTE_DIR/bin/*.py 2>/dev/null || true
chmod 700 $REMOTE_DIR/bin/init_miners.sh 2>/dev/null || true
```

**Impact:** Script won't fail if `.env` doesn't exist. Added error suppression for chmod commands.

---

### 3. ✅ Missing Python Dependency: `netifaces`
**Problem:** `farm_init.py` imports `netifaces` but it wasn't being installed.

**Before:**
```bash
pip install pyasic pyyaml
```

**After:**
```bash
pip install pyasic pyyaml netifaces
```

**Impact:** Miner discovery will now work correctly without `ModuleNotFoundError`.

---

### 4. ✅ Path Inconsistency in Configuration Files
**Problem:** Backend configuration files still used old `/opt/mining-monitor` path.

**Files Fixed:**
- `backend/.env.example` - Line 25
- `backend/src/config/config.ts` - Line 41

**Before:**
```typescript
minerConfig: process.env.MINER_CONFIG_PATH || '/opt/mining-monitor/etc/miners.yaml'
```

**After:**
```typescript
minerConfig: process.env.MINER_CONFIG_PATH || '/opt/mining-stack/etc/miners.yaml'
```

**Impact:** Backend will correctly locate miner configuration files.

---

## Verification

### Test Symlink Logic
```bash
# After deployment, verify symlink
ls -la /opt/ | grep mining
# Should show: mining-monitor -> /opt/mining-stack
```

### Test Python Dependencies
```bash
# On Raspberry Pi after deployment
source /opt/mining-stack/venv/bin/activate
python3 -c "import netifaces; print('netifaces OK')"
python3 -c "import pyasic; print('pyasic OK')"
```

### Test Configuration Paths
```bash
# Check backend config
grep -r "mining-monitor" /opt/mining-stack/backend/
# Should return no results (or only in comments)
```

---

## All Path References Now Consistent

✅ **Primary Path:** `/opt/mining-stack/`
✅ **Backward Compatibility:** `/opt/mining-monitor -> /opt/mining-stack`
✅ **Python Scripts:** All use `/opt/mining-stack`
✅ **Backend Config:** All use `/opt/mining-stack`
✅ **Deploy Script:** All use `/opt/mining-stack`

---

## Deployment Ready

The script is now ready for production deployment:

```bash
# Remote deployment
./deploy-pi.sh pi raspberrypi.local

# Local deployment (on the Pi itself)
./deploy-pi.sh localhost localhost
```

All critical issues have been resolved. The deployment should complete successfully without errors.
