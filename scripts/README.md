# 🛠️ Utility Scripts

Maintenance and utility scripts for the Mining Stack project.

---

## 📋 Scripts

### cleanup-docs.sh
**Purpose:** Remove old/temporary documentation files  
**Usage:** `./cleanup-docs.sh`  
**When:** After major documentation updates

### cleanup-temp-docs.sh
**Purpose:** Remove temporary session documentation  
**Usage:** `./cleanup-temp-docs.sh`  
**When:** After completing work sessions

### fix-permissions.sh
**Purpose:** Fix file permissions for Docker volumes  
**Usage:** `sudo ./fix-permissions.sh`  
**When:** After deployment or permission issues

---

## 🚀 Deployment Scripts (in root)

These are kept in the root directory for easy access:

- `deploy-from-registry.sh` - Deploy from GitHub Container Registry
- `update-from-registry.sh` - Update running deployment
- `health-check.sh` - Comprehensive system health check

---

## 📦 Collector Scripts (in bin/)

Mining data collection and setup scripts:

- `collect_all_metrics.sh` - Run all collectors in parallel
- `pyasic_textfile.py` - PyASIC metrics collector
- `universal_miner_collector.py` - Universal miner collector
- `farm_init.py` - Auto-discover miners on network
- `generate_prometheus_rules.py` - Generate alert rules from config
- `test_single_miner.py` - Test single miner connection
- `setup-pyasic-venv.sh` - Setup Python virtual environment
- `setup-metrics-cron.sh` - Setup cron jobs for metrics
- `setup-universal-collector.sh` - Setup universal collector

---

## 📁 Directory Structure

```
mining-stack/
├── deploy-from-registry.sh    # Deployment
├── update-from-registry.sh    # Updates
├── health-check.sh            # Health monitoring
├── scripts/                   # Utility scripts
│   ├── cleanup-docs.sh
│   ├── cleanup-temp-docs.sh
│   └── fix-permissions.sh
└── bin/                       # Collector & setup scripts
    ├── collect_all_metrics.sh
    ├── farm_init.py
    ├── generate_prometheus_rules.py
    ├── pyasic_textfile.py
    ├── universal_miner_collector.py
    ├── test_single_miner.py
    ├── setup-pyasic-venv.sh
    ├── setup-metrics-cron.sh
    └── setup-universal-collector.sh
```

---

## 🎯 Quick Reference

### Maintenance
```bash
# Clean up documentation
./scripts/cleanup-temp-docs.sh

# Fix permissions
sudo ./scripts/fix-permissions.sh
```

### Deployment
```bash
# Deploy from registry
./deploy-from-registry.sh

# Update deployment
./update-from-registry.sh

# Check health
./health-check.sh
```

### Collectors
```bash
# Setup environment
./bin/setup-pyasic-venv.sh

# Discover miners
./venv/bin/python3 bin/farm_init.py

# Collect metrics
./bin/collect_all_metrics.sh

# Generate Prometheus rules
./venv/bin/python3 bin/generate_prometheus_rules.py
```

---

**Last Updated:** November 1, 2025
