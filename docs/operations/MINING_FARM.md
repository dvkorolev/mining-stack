# Mining Farm Setup Guide

Complete guide to initialize and configure your mining farm with the Mining Stack dashboard.

---

## 📋 Prerequisites

- Raspberry Pi 4 (4GB+ RAM recommended)
- All miners connected to the same network
- Miners with accessible web interfaces or API
- SSH access to Raspberry Pi

---

## 🚀 Quick Setup (5 Steps)

### Step 1: Deploy Dashboard to Raspberry Pi

```bash
# On your computer
ssh pi@raspberrypi.local

# Clone and deploy
git clone https://github.com/dvkorolev/mining-stack.git /opt/mining-stack
cd /opt/mining-stack
chmod +x deploy-from-registry.sh
./deploy-from-registry.sh $(whoami) localhost
```

### Step 2: Discover Miners on Network

The system includes an automatic miner discovery tool:

```bash
cd /opt/mining-stack
python3 bin/farm_init.py
```

**What it does:**
- Scans your local network (192.168.x.x)
- Detects miners on common ports (4028, 80)
- Attempts to identify miner models
- Creates `etc/miners.yaml` configuration file

**Output example:**
```
Found network: 192.168.1.0/24 (interface: eth0)
Scanning 254 IPs...
✓ Found miner at 192.168.1.100 - Antminer S19j Pro
✓ Found miner at 192.168.1.101 - Antminer S19
✓ Found miner at 192.168.1.102 - Whatsminer M30S

Discovered 3 miners
Configuration saved to: /opt/mining-stack/etc/miners.yaml
```

### Step 3: Review & Edit Miner Configuration

```bash
nano /opt/mining-stack/etc/miners.yaml
```

**Example configuration:**
```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19j Pro"
    alias: "Main Mining Rig"
    
  - ip: "192.168.1.101"
    name: "miner-02"
    model: "Antminer S19"
    alias: "Backup Miner"
    
  - ip: "192.168.1.102"
    name: "miner-03"
    model: "Whatsminer M30S"
    alias: "Test Rig"
```

**Configuration fields:**
- `ip` - Miner IP address (required)
- `name` - Unique identifier (required)
- `model` - Miner model name (required)
- `alias` - Friendly display name (optional)

### Step 4: Restart Services

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart backend
```

### Step 5: Access Dashboard

Open in browser:
- **Dashboard**: http://raspberrypi.local:3000
- **Grafana**: http://raspberrypi.local:3001 (admin/<GF_SECURITY_ADMIN_PASSWORD>)

---

## 🔧 Manual Configuration (Alternative)

If automatic discovery doesn't work:

### 1. Find Miner IPs Manually

```bash
# Scan network for devices
sudo nmap -sn 192.168.1.0/24

# Or use arp-scan
sudo arp-scan --localnet
```

### 2. Create Configuration File

```bash
mkdir -p /opt/mining-stack/etc
nano /opt/mining-stack/etc/miners.yaml
```

Add your miners:
```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19j Pro"
    alias: "Main Rig"
```

### 3. Test Configuration

```bash
cd /opt/mining-stack
# Check if file is valid YAML
python3 -c "import yaml; yaml.safe_load(open('etc/miners.yaml'))"

# Restart backend to load config
docker compose -f docker-compose.prod.yml restart backend
```

---

## 📊 Monitoring Setup

### Configure Prometheus Targets

Edit Prometheus configuration:
```bash
nano /opt/mining-stack/docker/prometheus/prometheus.yml
```

Add miner targets:
```yaml
scrape_configs:
  - job_name: 'miners'
    static_configs:
      - targets:
        - '192.168.1.100:4028'
        - '192.168.1.101:4028'
        - '192.168.1.102:4028'
```

Restart Prometheus:
```bash
docker compose -f docker-compose.prod.yml restart prometheus
```

---

## 🔍 Verification

### Check Backend Logs

```bash
docker compose -f docker-compose.prod.yml logs backend | grep -i miner
```

Expected output:
```
backend  | Loaded configuration for 3 miners
backend  | Mining simulation started automatically
```

### Check Dashboard

1. Open http://raspberrypi.local:3000
2. Verify miners appear in the dashboard
3. Check real-time statistics are updating

### Check Grafana

1. Open http://raspberrypi.local:3001
2. Login: admin/<GF_SECURITY_ADMIN_PASSWORD>
3. Import mining dashboard
4. Verify metrics are being collected

---

## 🛠️ Troubleshooting

### Miners Not Detected

**Problem**: `farm_init.py` doesn't find miners

**Solutions:**
1. Check miners are powered on
2. Verify network connectivity: `ping 192.168.1.100`
3. Check firewall isn't blocking ports
4. Manually add IPs to `EXTRA_IPS` in `farm_init.py`

### Configuration Not Loading

**Problem**: Backend doesn't load miners.yaml

**Solutions:**
1. Check file location: `/opt/mining-stack/etc/miners.yaml`
2. Verify YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('etc/miners.yaml'))"`
3. Check file permissions: `chmod 644 etc/miners.yaml`
4. Restart backend: `docker compose restart backend`

### No Real-Time Data

**Problem**: Dashboard shows "N/A" or no updates

**Solutions:**
1. Check WebSocket connection (green badge in dashboard)
2. Verify backend is running: `docker compose ps`
3. Check backend logs: `docker compose logs backend`
4. Ensure miners.yaml is configured correctly

### Miner API Not Accessible

**Problem**: Can't connect to miner API

**Solutions:**
1. Check miner web interface is accessible
2. Verify API is enabled in miner settings
3. Check miner firewall settings
4. Try different ports (4028, 80, 8080)

---

## 📈 Advanced Configuration

### Custom Simulation Settings

Edit environment variables in `.env`:

```bash
# Simulation parameters (for testing)
SIM_ONLINE_PROBABILITY=0.9    # 90% miners online
SIM_ERROR_PROBABILITY=0.2     # 20% error rate
SIM_HASHRATE_VARIANCE=0.1     # ±10% hashrate variance

# Temperature ranges
SIM_TEMP_MIN=60               # 60°C minimum
SIM_TEMP_MAX=90               # 90°C maximum

# Fan speed ranges
SIM_FAN_MIN=3000              # 3000 RPM minimum
SIM_FAN_MAX=5000              # 5000 RPM maximum
```

### Multiple Networks

If miners are on different subnets:

```bash
# Edit farm_init.py
EXTRA_IPS = [
    "192.168.1.100",
    "192.168.2.100",
    "10.0.0.100"
]
```

### Scheduled Discovery

Auto-discover new miners daily:

```bash
crontab -e

# Add this line (runs at 2 AM daily)
0 2 * * * cd /opt/mining-stack && python3 bin/farm_init.py >> /var/log/miner-discovery.log 2>&1
```

---

## 🔄 Updating Configuration

### Add New Miner

1. Edit configuration:
```bash
nano /opt/mining-stack/etc/miners.yaml
```

2. Add new miner:
```yaml
  - ip: "192.168.1.103"
    name: "miner-04"
    model: "Antminer S19 XP"
    alias: "New Rig"
```

3. Restart backend:
```bash
docker compose -f docker-compose.prod.yml restart backend
```

### Remove Miner

1. Remove from `miners.yaml`
2. Restart backend
3. Old data will remain in history

---

## 📚 Related Documentation

- [Configuration Guide](docs/CONFIGURATION.md) - Detailed configuration options
- [API Documentation](docs/API.md) - REST API endpoints
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues
- [CI/CD Setup](CI_CD_SETUP.md) - Automated deployment

---

## 🎯 Quick Reference

### Essential Commands

```bash
# Discover miners
python3 bin/farm_init.py

# Edit configuration
nano /opt/mining-stack/etc/miners.yaml

# Restart services
docker compose -f docker-compose.prod.yml restart

# View logs
docker compose -f docker-compose.prod.yml logs -f backend

# Check status
docker compose -f docker-compose.prod.yml ps

# Update dashboard
./update-from-registry.sh latest
```

### File Locations

- **Miner Config**: `/opt/mining-stack/etc/miners.yaml`
- **Environment**: `/opt/mining-stack/.env`
- **Logs**: `/opt/mining-stack/logs/`
- **Prometheus Config**: `/opt/mining-stack/docker/prometheus/`

### Default Ports

- **Dashboard**: 3000
- **Backend API**: 5000
- **WebSocket**: 5000/ws
- **Prometheus**: 9090
- **Grafana**: 3001
- **Miner API**: 4028 (common)

---

## ✅ Setup Checklist

- [ ] Raspberry Pi deployed with dashboard
- [ ] Miners discovered or manually configured
- [ ] `etc/miners.yaml` created and validated
- [ ] Backend restarted and loading config
- [ ] Dashboard accessible and showing data
- [ ] WebSocket connected (green badge)
- [ ] Grafana configured with dashboards
- [ ] Prometheus scraping metrics
- [ ] Auto-updates configured (optional)
- [ ] Monitoring alerts set up (optional)

---

## 🆘 Support

If you encounter issues:

1. Check logs: `docker compose logs backend`
2. Verify configuration: `cat etc/miners.yaml`
3. Test connectivity: `ping <miner-ip>`
4. Review [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
5. Check GitHub Issues

---

**Happy Mining! ⛏️**
