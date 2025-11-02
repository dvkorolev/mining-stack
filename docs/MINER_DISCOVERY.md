# Miner Discovery Guide

## Overview

The `farm_init.py` script automatically discovers miners on your network and creates the `miners.yaml` configuration file.

## How It Works

1. **Network Detection** - Automatically detects your local network (e.g., 192.168.1.0/24)
2. **Port Scanning** - Scans all IPs for open ports 4028 (cgminer API) and 80 (HTTP)
3. **Miner Identification** - Connects to each device using pyasic to identify model
4. **Configuration Generation** - Creates `miners.yaml` with all discovered miners

## Prerequisites

### On Raspberry Pi:

```bash
# 1. Install Python and dependencies
sudo apt update
sudo apt install -y python3-full python3-venv python3-pip

# 2. Setup virtual environment
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh
```

This will install:
- pyasic (miner communication library)
- pyyaml (YAML file handling)
- netifaces (network detection)
- aiohttp (async HTTP)

## Running Discovery

### Method 1: Direct Script (Recommended)

```bash
cd /opt/mining-stack

# Activate virtual environment
source venv/bin/activate

# Run discovery
python3 bin/farm_init.py

# Deactivate when done
deactivate
```

### Method 2: Via Docker (if services are running)

```bash
# Trigger discovery via API
curl -X POST http://localhost:8000/discover

# Or via backend
curl -X POST http://localhost:5000/api/mining/discover
```

**Note**: This takes 3-5 minutes as it scans the entire network.

## What Happens

### Step 1: Network Scanning
```
Found network: 192.168.1.0/24 (interface: eth0)
[1/3] Scanning ports [4028, 80] in network 192.168.1.0/24...
Found 23 potential miners: ['192.168.1.40', '192.168.1.64', ...]
```

### Step 2: Miner Identification
```
[2/3] Identifying miners (default owner: EN)...
Identified 22 miners.
```

### Step 3: Configuration File Creation
```
[3/3] Creating inventory file: /opt/mining-stack/etc/miners.yaml
Success! Inventory file created.
```

## Output Format

The script creates `etc/miners.yaml`:

```yaml
miners:
  - ip: 192.168.1.40
    model: M30S++ VH90 (Stock)
    alias: EN-M30SppVH90-040
    owner: EN
    status: active
    thresholds:
      hashrate:
        expected: 106.1
      power:
        expected: 3408.0
        
  - ip: 192.168.1.64
    model: S19 Pro
    alias: EN-S19Pro-064
    owner: EN
    status: active
    thresholds:
      hashrate:
        expected: 110.0
      power:
        expected: 3250.0
```

## Customization

### Change Default Owner

Edit `bin/farm_init.py` line 188:

```python
default_owner = "EN"  # Change to your owner prefix
```

### Add Extra IPs

If some miners don't respond to port scanning, add them manually in line 20:

```python
EXTRA_IPS = ["192.168.1.78", "192.168.1.99"]
```

### Adjust Scanning

```python
SCAN_PORTS = [4028, 80]  # Ports to scan
SCAN_TIMEOUT = 0.2       # Timeout per port (seconds)
CONCURRENCY = 100        # Concurrent scans
```

## After Discovery

### 1. Review Configuration

```bash
nano /opt/mining-stack/etc/miners.yaml
```

Check:
- All miners found
- Correct models
- Aliases are readable
- Thresholds are reasonable

### 2. Restart Services

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart backend
```

### 3. Verify Dashboard

Go to http://raspberrypi:3000 and check:
- All miners appear
- Status shows online
- Metrics are collecting

## Adding Miners Manually

If discovery doesn't find a miner, add it manually to `etc/miners.yaml`:

```yaml
miners:
  # ... existing miners ...
  
  - ip: 192.168.1.150
    model: S19 Pro
    alias: EN-S19Pro-150
    owner: EN
    status: active
    thresholds:
      hashrate:
        expected: 110.0
      power:
        expected: 3250.0
```

Then restart backend:
```bash
docker compose -f docker-compose.prod.yml restart backend
```

## Troubleshooting

### No Miners Found

**Check network connectivity:**
```bash
# Ping a known miner
ping 192.168.1.40

# Check if port is open
nc -zv 192.168.1.40 4028
```

**Check network interface:**
```bash
ip addr show
```

Make sure Raspberry Pi is on the same network as miners.

### Some Miners Missing

**Add them to EXTRA_IPS:**
```python
EXTRA_IPS = ["192.168.1.78", "192.168.1.99"]
```

**Or test individually:**
```bash
source venv/bin/activate
python3 bin/test_single_miner.py 192.168.1.78
```

### Discovery Times Out

The script can take 3-5 minutes for large networks. This is normal.

**To speed up:**
1. Reduce CONCURRENCY (less network load)
2. Reduce SCAN_TIMEOUT (faster, but might miss miners)
3. Use EXTRA_IPS for known miners only

### Permission Denied

```bash
# Make script executable
chmod +x bin/farm_init.py

# Or run with python3
python3 bin/farm_init.py
```

### Module Not Found

```bash
# Reinstall dependencies
cd /opt/mining-stack
source venv/bin/activate
pip install pyasic pyyaml netifaces aiohttp
```

## Re-Discovery

To re-scan and update configuration:

```bash
cd /opt/mining-stack
source venv/bin/activate

# Backup existing config
cp etc/miners.yaml etc/miners.yaml.backup

# Run discovery (will overwrite miners.yaml)
python3 bin/farm_init.py

# If you want to merge with existing config, do it manually
nano etc/miners.yaml
```

**Warning**: Discovery overwrites `miners.yaml`. Backup first!

## Best Practices

### Initial Setup
1. Run discovery once to find all miners
2. Review and customize `miners.yaml`
3. Add any missing miners manually
4. Set per-miner thresholds if needed

### Adding New Miners
1. **Don't re-run discovery** (it overwrites everything)
2. Add new miner manually to `miners.yaml`
3. Restart backend

### Network Changes
If you move miners or change IPs:
1. Backup `miners.yaml`
2. Run discovery
3. Merge old and new configurations manually

## Alternative: Manual Configuration

You don't need discovery at all! Just create `etc/miners.yaml` manually:

```yaml
miners:
  - ip: 192.168.1.40
    model: M30S++
    alias: Miner-1
    owner: MyFarm
    status: active
    
  - ip: 192.168.1.41
    model: S19 Pro
    alias: Miner-2
    owner: MyFarm
    status: active
```

This is often **faster and more reliable** than discovery!

## Summary

**For initial setup:**
```bash
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh
source venv/bin/activate
python3 bin/farm_init.py
```

**For adding miners later:**
Just edit `etc/miners.yaml` manually and restart backend.

**Discovery is optional** - manual configuration is perfectly fine!
