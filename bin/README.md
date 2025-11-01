# 📁 bin/ Directory - Scripts Overview

This directory contains all operational scripts for the mining stack.

---

## 🔧 Setup Scripts

### `setup-pyasic-venv.sh`
**Purpose:** Setup Python virtual environment with pyasic  
**Usage:** `./bin/setup-pyasic-venv.sh [project_dir]`  
**What it does:**
- Creates Python virtual environment at `/opt/mining-stack/venv`
- Installs pyasic, pyyaml, netifaces, aiohttp
- Verifies installation
- **Run this first on Raspberry Pi!**

**Example:**
```bash
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh
```

---

### `setup-universal-collector.sh`
**Purpose:** Setup universal miner collector (works with all miner types)  
**Usage:** `./bin/setup-universal-collector.sh`  
**What it does:**
- Creates venv if missing
- Installs minimal dependencies (aiohttp, PyYAML)
- Makes collector executable
- Creates logs and textfile directories

**Example:**
```bash
./bin/setup-universal-collector.sh
```

---

### `setup-metrics-cron.sh`
**Purpose:** Setup automatic metrics collection via cron  
**Usage:** `./bin/setup-metrics-cron.sh [project_dir]`  
**What it does:**
- Creates textfile directory
- Adds cron job (runs every 2 minutes)
- Runs initial collection
- **Requires venv to be set up first!**

**Example:**
```bash
./bin/setup-metrics-cron.sh
```

---

## 📊 Collector Scripts

### `pyasic_textfile.py`
**Purpose:** Collect detailed metrics using pyasic library  
**Usage:** `./venv/bin/python3 bin/pyasic_textfile.py`  
**What it collects:**
- Hashrate per miner and per board
- Temperature (max and per board)
- Power consumption
- Fan speeds
- Pool statistics (accepted/rejected shares)
- Chip counts
- Uptime, efficiency, fault lights

**Output:** `/opt/mining-stack/textfile/pyasic_metrics.prom`

**Example:**
```bash
cd /opt/mining-stack
./venv/bin/python3 bin/pyasic_textfile.py
```

---

### `universal_miner_collector.py`
**Purpose:** Universal collector for all miner types (Antminer, Whatsminer, DG1+)  
**Usage:** `./venv/bin/python3 bin/universal_miner_collector.py`  
**What it collects:**
- Works with cgminer API (port 4028)
- Works with HTTP APIs
- Supports all major miner brands
- Fallback when pyasic doesn't work

**Output:** `/opt/mining-stack/textfile/universal_metrics.prom`

**Example:**
```bash
./venv/bin/python3 bin/universal_miner_collector.py
```

---

### `collect_all_metrics.sh`
**Purpose:** Run both collectors in parallel with synchronized timestamps  
**Usage:** `./bin/collect_all_metrics.sh`  
**What it does:**
- Runs pyasic and universal collectors simultaneously
- 60-second timeout per collector
- Logs to separate files
- Shows summary of results

**Example:**
```bash
./bin/collect_all_metrics.sh
```

**Output:**
```
[2025-01-01 12:00:00] Starting metrics collection (timestamp: 1735732800)
[2025-01-01 12:00:00] Running pyasic collector...
[2025-01-01 12:00:00] Running universal collector...
[2025-01-01 12:00:15] ✓ pyasic completed successfully
[2025-01-01 12:00:18] ✓ universal completed successfully

=== Collection Summary ===
Timestamp: 1735732800
pyasic collector: ✓ SUCCESS
universal collector: ✓ SUCCESS
pyasic metrics: 450 lines
universal metrics: 380 lines
```

---

## 🔍 Discovery Scripts

### `farm_init.py`
**Purpose:** Auto-discover miners on network and create inventory  
**Usage:** `./venv/bin/python3 bin/farm_init.py`  
**What it does:**
1. Scans network for miners (ports 4028, 80)
2. Identifies each miner (model, hashrate, power)
3. Generates aliases (e.g., EN-S19jPro-074)
4. Creates `/opt/mining-stack/etc/miners.yaml`
5. Sets expected thresholds based on actual performance

**Example:**
```bash
cd /opt/mining-stack
./venv/bin/python3 bin/farm_init.py
```

**Output:**
```
Found network: 192.168.1.0/24 (interface: eth0)
[1/3] Scanning ports...
Found 23 potential miners
[2/3] Identifying miners...
Identified 22 miners
[3/3] Creating inventory file
Success! Inventory file created: /opt/mining-stack/etc/miners.yaml
```

---

## 🛠️ Utility Scripts

### `generate_prometheus_rules.py`
**Purpose:** Generate Prometheus alerting rules from miners.yaml  
**Usage:** `./venv/bin/python3 bin/generate_prometheus_rules.py`  
**What it does:**
- Reads `/opt/mining-stack/etc/miners.yaml`
- Generates per-miner alert rules
- Creates `/opt/mining-stack/docker/prometheus/rules/mining_alerts.yml`
- Uses per-miner thresholds or global defaults

**Example:**
```bash
./venv/bin/python3 bin/generate_prometheus_rules.py
```

**Auto-runs after:**
- Miner discovery
- Threshold updates
- Miner configuration changes

---

### `test_single_miner.py`
**Purpose:** Test connection to a single miner  
**Usage:** `./venv/bin/python3 bin/test_single_miner.py <ip_address>`  
**What it does:**
- Tests pyasic connection
- Shows miner model, hashrate, temp, power
- Useful for debugging connectivity issues

**Example:**
```bash
./venv/bin/python3 bin/test_single_miner.py 192.168.1.74
```

**Output:**
```
Testing miner at 192.168.1.74...
✓ Connected: Antminer S19j Pro
  Hashrate: 104.5 TH/s
  Temperature: 68°C
  Power: 3100W
  Status: Mining
```

---

## 📋 Configuration Files

### `requirements-collector.txt`
**Purpose:** Python dependencies for universal collector  
**Contents:**
```
aiohttp>=3.9.0
PyYAML>=6.0
```

**Note:** pyasic has its own dependencies (installed via setup-pyasic-venv.sh)

---

## 🚀 Quick Start Guide

### First-Time Setup on Raspberry Pi:

```bash
cd /opt/mining-stack

# 1. Setup Python environment
./bin/setup-pyasic-venv.sh

# 2. Discover miners
./venv/bin/python3 bin/farm_init.py

# 3. Generate Prometheus rules
./venv/bin/python3 bin/generate_prometheus_rules.py

# 4. Setup automatic collection
./bin/setup-metrics-cron.sh

# 5. Test collection
./bin/collect_all_metrics.sh
```

---

## 📊 Cron Jobs

After running `setup-metrics-cron.sh`, these cron jobs are active:

```bash
# Collect metrics every 2 minutes
*/2 * * * * cd /opt/mining-stack && /opt/mining-stack/venv/bin/python3 bin/pyasic_textfile.py >> logs/pyasic_metrics.log 2>&1
```

**View cron jobs:**
```bash
crontab -l
```

**View logs:**
```bash
tail -f /opt/mining-stack/logs/pyasic_metrics.log
tail -f /opt/mining-stack/logs/collector.log
```

---

## 🔧 Troubleshooting

### Virtual environment not found
```bash
# Error: Python virtual environment not found at /opt/mining-stack/venv/bin/python3
# Solution:
./bin/setup-pyasic-venv.sh
```

### pyasic import error
```bash
# Error: ModuleNotFoundError: No module named 'pyasic'
# Solution:
cd /opt/mining-stack
source venv/bin/activate
pip install pyasic pyyaml netifaces aiohttp
deactivate
```

### Miner discovery finds 0 miners
```bash
# Check network connectivity
ping 192.168.1.74

# Test single miner
./venv/bin/python3 bin/test_single_miner.py 192.168.1.74

# Check if ports are open
nc -zv 192.168.1.74 4028
```

### Metrics not updating
```bash
# Check cron job is running
crontab -l | grep pyasic

# Run collector manually
./venv/bin/python3 bin/pyasic_textfile.py

# Check output file
cat /opt/mining-stack/textfile/pyasic_metrics.prom
```

---

## 📁 Directory Structure

```
bin/
├── README.md                          # This file
│
├── Setup Scripts (run once)
│   ├── setup-pyasic-venv.sh          # Create venv + install pyasic
│   ├── setup-universal-collector.sh   # Setup universal collector
│   └── setup-metrics-cron.sh         # Setup automatic collection
│
├── Collector Scripts (run periodically)
│   ├── pyasic_textfile.py            # Detailed metrics via pyasic
│   ├── universal_miner_collector.py   # Universal API collector
│   └── collect_all_metrics.sh        # Run both collectors
│
├── Discovery Scripts (run as needed)
│   └── farm_init.py                  # Auto-discover miners
│
├── Utility Scripts
│   ├── generate_prometheus_rules.py   # Generate alert rules
│   └── test_single_miner.py          # Test single miner
│
└── Configuration
    └── requirements-collector.txt     # Python dependencies
```

---

## 🔄 Workflow

### Initial Setup:
1. `setup-pyasic-venv.sh` → Create Python environment
2. `farm_init.py` → Discover miners
3. `generate_prometheus_rules.py` → Create alert rules
4. `setup-metrics-cron.sh` → Enable automatic collection

### Daily Operations:
- Cron runs `pyasic_textfile.py` every 2 minutes
- Prometheus scrapes `/opt/mining-stack/textfile/*.prom`
- Alerts fire based on generated rules
- Grafana displays metrics

### When Adding/Removing Miners:
1. `farm_init.py` → Re-discover miners
2. `generate_prometheus_rules.py` → Update rules
3. Reload Prometheus: `docker exec mining-stack-prometheus-1 kill -HUP 1`

### When Updating Thresholds:
1. Edit miner in UI (Miners Management page)
2. Backend auto-runs `generate_prometheus_rules.py`
3. Backend auto-reloads Prometheus
4. New thresholds active in ~30 seconds

---

## 📝 Notes

- **All scripts use venv Python:** `/opt/mining-stack/venv/bin/python3`
- **Metrics output:** `/opt/mining-stack/textfile/*.prom`
- **Logs:** `/opt/mining-stack/logs/`
- **Config:** `/opt/mining-stack/etc/miners.yaml`

**Dependencies:**
- Python 3.8+
- pyasic (for detailed metrics)
- aiohttp (for HTTP APIs)
- PyYAML (for config files)
- netifaces (for network detection)

---

**Last Updated:** 2025-01-01  
**Maintained by:** Mining Stack Team
