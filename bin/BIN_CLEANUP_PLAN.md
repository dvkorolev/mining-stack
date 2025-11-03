# bin/ Directory Cleanup Plan

## Current Status

The `bin/` directory contains old scripts from the previous architecture that are no longer needed with the new modular Python scheduler.

---

## Files Analysis

### ✅ Keep (Active/Required)

| File | Purpose | Status |
|------|---------|--------|
| `farm_init.py` | Auto-discovery (NEW version) | ✅ Keep |
| `generate_prometheus_rules.py` | Prometheus rules generation | ✅ Keep |
| `FARM_INIT_IMPROVEMENTS.md` | Documentation | ✅ Keep |
| `README_FARM_INIT.md` | Documentation | ✅ Keep |
| `README.md` | Documentation | ✅ Keep |
| `backup/` | Backup directory | ✅ Keep |

---

### 📦 Backup (Deprecated/Old Architecture)

| File | Purpose | Reason to Backup |
|------|---------|------------------|
| `pyasic_textfile.py` | Old PyASIC collector | Replaced by `python-scheduler/collectors/pyasic_collector.py` |
| `universal_miner_collector.py` | Old universal collector | Replaced by modular collectors |
| `collect_all_metrics.sh` | Old cron wrapper | Replaced by FastAPI scheduler |
| `pool_network_monitor.py` | Old pool monitor | Integrated into `main.py` |
| `test_single_miner.py` | Old test script | Replaced by new architecture |
| `setup-metrics-cron.sh` | Old cron setup | No longer needed (FastAPI scheduler) |
| `setup-pyasic-venv.sh` | Old venv setup | No longer needed (Docker) |
| `setup-universal-collector.sh` | Old collector setup | No longer needed |
| `requirements-collector.txt` | Old requirements | Replaced by `python-scheduler/requirements.txt` |

---

## Backup Strategy

### Step 1: Create Backup Directory
```bash
mkdir -p backup/old_architecture_$(date +%Y%m%d)
```

### Step 2: Move Deprecated Files
```bash
# Old collectors
mv pyasic_textfile.py backup/old_architecture_*/
mv universal_miner_collector.py backup/old_architecture_*/
mv pool_network_monitor.py backup/old_architecture_*/

# Old setup scripts
mv collect_all_metrics.sh backup/old_architecture_*/
mv setup-metrics-cron.sh backup/old_architecture_*/
mv setup-pyasic-venv.sh backup/old_architecture_*/
mv setup-universal-collector.sh backup/old_architecture_*/

# Old test scripts
mv test_single_miner.py backup/old_architecture_*/

# Old requirements
mv requirements-collector.txt backup/old_architecture_*/
```

### Step 3: Verify Active Files
```bash
ls -lh bin/
# Should only show:
# - farm_init.py
# - generate_prometheus_rules.py
# - Documentation files
# - backup/
```

---

## Detailed File Analysis

### 1. pyasic_textfile.py (7.6KB)
**Old Purpose**: Collect metrics using PyASIC and write to textfile

**Replaced By**: `python-scheduler/collectors/pyasic_collector.py`

**Why Deprecated**:
- Old architecture used cron + textfile collector
- New architecture uses FastAPI + in-memory metrics
- New version has gap filling and fallback drivers

**Action**: 📦 Backup

---

### 2. universal_miner_collector.py (25KB)
**Old Purpose**: Universal collector for various miner types

**Replaced By**: Modular collector system:
- `collectors/pyasic_collector.py`
- `collectors/antminer_cgi_collector.py`
- `collectors/dg1_tcp_collector.py`

**Why Deprecated**:
- Monolithic design
- No fallback support
- Replaced by modular drivers

**Action**: 📦 Backup

---

### 3. collect_all_metrics.sh (3.0KB)
**Old Purpose**: Cron wrapper to run collectors

**Replaced By**: `python-scheduler/main.py` with built-in scheduler

**Why Deprecated**:
- Cron-based scheduling replaced by async scheduler
- No longer needed with FastAPI

**Action**: 📦 Backup

---

### 4. pool_network_monitor.py (14KB)
**Old Purpose**: Monitor pool network quality

**Replaced By**: Integrated into `main.py` as `collect_pool_network_metrics()`

**Why Deprecated**:
- Standalone script replaced by integrated function
- Part of unified collection cycle

**Action**: 📦 Backup

---

### 5. test_single_miner.py (3.6KB)
**Old Purpose**: Test script for single miner

**Replaced By**: Can use `curl -X POST http://localhost:8000/collect`

**Why Deprecated**:
- Old testing approach
- New architecture has API endpoints

**Action**: 📦 Backup

---

### 6. setup-metrics-cron.sh (1.5KB)
**Old Purpose**: Setup cron jobs for metrics collection

**Replaced By**: FastAPI scheduler (no cron needed)

**Why Deprecated**:
- Cron-based approach replaced
- Scheduler runs continuously

**Action**: 📦 Backup

---

### 7. setup-pyasic-venv.sh (3.6KB)
**Old Purpose**: Setup Python virtual environment

**Replaced By**: Docker container with dependencies

**Why Deprecated**:
- Docker handles dependencies
- No manual venv setup needed

**Action**: 📦 Backup

---

### 8. setup-universal-collector.sh (1.3KB)
**Old Purpose**: Setup universal collector

**Replaced By**: Docker Compose orchestration

**Why Deprecated**:
- No manual setup needed
- Docker handles everything

**Action**: 📦 Backup

---

### 9. requirements-collector.txt (114B)
**Old Purpose**: Dependencies for old collectors

**Replaced By**: `python-scheduler/requirements.txt`

**Why Deprecated**:
- Old requirements file
- New comprehensive requirements in python-scheduler/

**Action**: 📦 Backup

---

## Files to Keep

### 1. farm_init.py (13KB) ✅
**Purpose**: Auto-discovery of miners on network

**Status**: ACTIVE - New robust version

**Why Keep**: Essential for initial setup and miner discovery

---

### 2. generate_prometheus_rules.py (10KB) ✅
**Purpose**: Generate Prometheus alerting rules

**Status**: ACTIVE - Used by backend

**Why Keep**: Backend calls this to regenerate rules after config changes

---

### 3. Documentation Files ✅
- `FARM_INIT_IMPROVEMENTS.md`
- `README_FARM_INIT.md`
- `README.md`

**Status**: ACTIVE

**Why Keep**: Essential documentation for bin/ directory

---

## After Cleanup Structure

```
bin/
├── farm_init.py                    ✅ ACTIVE
├── generate_prometheus_rules.py   ✅ ACTIVE
├── FARM_INIT_IMPROVEMENTS.md       ✅ ACTIVE
├── README_FARM_INIT.md             ✅ ACTIVE
├── README.md                       ✅ ACTIVE
└── backup/
    ├── farm_init_old_*.py          📦 Previous version
    └── old_architecture_20251103/  📦 Deprecated scripts
        ├── pyasic_textfile.py
        ├── universal_miner_collector.py
        ├── collect_all_metrics.sh
        ├── pool_network_monitor.py
        ├── test_single_miner.py
        ├── setup-metrics-cron.sh
        ├── setup-pyasic-venv.sh
        ├── setup-universal-collector.sh
        └── requirements-collector.txt
```

---

## Rollback Plan

If you need to restore old architecture:

```bash
cd /opt/mining-stack/bin/backup/old_architecture_20251103

# Restore old collectors
cp pyasic_textfile.py ../..
cp universal_miner_collector.py ../..
cp collect_all_metrics.sh ../..

# Restore old setup scripts
cp setup-metrics-cron.sh ../..
cp setup-pyasic-venv.sh ../..

# Setup cron
bash ../../setup-metrics-cron.sh
```

---

## Benefits of Cleanup

1. **Clarity**: Only active files in bin/
2. **No Confusion**: Clear what's in use vs deprecated
3. **Preserved**: All old files backed up safely
4. **Documentation**: Clear record of what changed
5. **Rollback**: Can restore if needed

---

## Execution Commands

```bash
cd /opt/mining-stack/bin

# Create backup directory
mkdir -p backup/old_architecture_20251103

# Backup deprecated files
mv pyasic_textfile.py backup/old_architecture_20251103/
mv universal_miner_collector.py backup/old_architecture_20251103/
mv collect_all_metrics.sh backup/old_architecture_20251103/
mv pool_network_monitor.py backup/old_architecture_20251103/
mv test_single_miner.py backup/old_architecture_20251103/
mv setup-metrics-cron.sh backup/old_architecture_20251103/
mv setup-pyasic-venv.sh backup/old_architecture_20251103/
mv setup-universal-collector.sh backup/old_architecture_20251103/
mv requirements-collector.txt backup/old_architecture_20251103/

# Verify
echo "=== Active Files ==="
ls -lh | grep -v backup

echo ""
echo "=== Backed Up Files ==="
ls -lh backup/old_architecture_20251103/
```

---

## Summary

📦 **9 files** to backup (deprecated old architecture)  
✅ **5 files** to keep (active/documentation)  
🗂️ **1 directory** for organized backups  

All deprecated files will be safely preserved in `backup/old_architecture_20251103/` for potential rollback or reference.
