# Issues Fixed - October 31, 2025

## Summary
Fixed 3 critical issues in the `bin/` directory that would have caused runtime failures on Raspberry Pi deployment.

---

## Issues Found & Fixed

### 1. ✅ Missing `import os` in `farm_init.py`
**Problem:** The script used `os.makedirs()` without importing the `os` module.

**Impact:** Would cause `NameError: name 'os' is not defined` at runtime when creating directories.

**Fix:** Added `import os` to the imports section.

```python
# Before
import asyncio
import ipaddress
import socket
import sys
import yaml

# After
import asyncio
import ipaddress
import os  # ← Added
import socket
import sys
import yaml
```

---

### 2. ✅ Path Inconsistency: `/opt/mining-monitor` vs `/opt/mining-stack`
**Problem:** Multiple files used the old path `/opt/mining-monitor` while `deploy-pi.sh` creates `/opt/mining-stack`.

**Impact:** Scripts would fail to find configuration files and write metrics to wrong locations.

**Files Updated:**
- `bin/farm_init.py` - Changed `INVENTORY_FILE` path
- `bin/pyasic_textfile.py` - Changed `INVENTORY_PATH` and `OUT_PATH`
- `bin/setup.sh` - Changed all directory references and added backward compatibility symlink

**Fix:**
```python
# Before
INVENTORY_FILE = "/opt/mining-monitor/etc/miners.yaml"
OUT_PATH = "/opt/mining-monitor/textfile/pyasic_metrics.prom"

# After
INVENTORY_FILE = "/opt/mining-stack/etc/miners.yaml"
OUT_PATH = "/opt/mining-stack/textfile/pyasic_metrics.prom"
```

**Backward Compatibility:** Added symlink in `setup.sh`:
```bash
sudo ln -sf /opt/mining-stack /opt/mining-monitor
```

---

### 3. ✅ Python Scripts Not Executable
**Problem:** Python scripts had shebang lines but lacked execute permissions.

**Impact:** Scripts couldn't be run directly (e.g., `./farm_init.py`), requiring `python3` prefix.

**Fix:** Applied execute permissions:
```bash
chmod +x bin/*.py bin/*.sh
```

**Result:**
```
-rwxr-xr-x  farm_init.py      # Now executable
-rwxr-xr-x  pyasic_textfile.py # Now executable
-rwxr-xr-x  setup.sh          # Now executable
```

---

## Docker Directory Status

### ✅ All Configuration Files Present

**`docker/alertmanager/`**
- ✅ `alertmanager.yml` - Telegram notification configuration

**`docker/blackbox/`**
- ✅ `blackbox.yml` - TCP probe configuration

**`docker/prometheus/`**
- ✅ `prometheus.yml` - Main Prometheus configuration
- ✅ `miners_list.yml` - Miner targets for monitoring

All configuration files are properly formatted and ready for deployment.

---

## Verification

Run these commands to verify the fixes:

```bash
# Check Python syntax
python3 -m py_compile bin/farm_init.py
python3 -m py_compile bin/pyasic_textfile.py

# Verify execute permissions
ls -la bin/

# Check for path consistency
grep -r "/opt/mining-monitor" bin/
# Should return no results (or only comments)

grep -r "/opt/mining-stack" bin/
# Should show updated paths
```

---

## Impact on Deployment

These fixes ensure:
1. ✅ Scripts will run without import errors
2. ✅ Configuration files will be found at correct locations
3. ✅ Metrics will be written to correct paths
4. ✅ Scripts can be executed directly without `python3` prefix
5. ✅ Backward compatibility maintained via symlink

---

## Next Steps

The project is now ready for deployment. Run:

```bash
./deploy-pi.sh pi raspberrypi.local
```

Or for local installation on the Pi:
```bash
./deploy-pi.sh localhost localhost
```
