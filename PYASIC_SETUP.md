# 🐍 Python & pyasic Setup Guide

The miner auto-discovery feature requires Python and the pyasic library to be installed on your Raspberry Pi.

---

## 🚀 Quick Setup (Run on Raspberry Pi)

### **Automated Setup**

```bash
cd /opt/mining-stack

# Run the setup script
./bin/setup-pyasic-venv.sh

# This will:
# 1. Check if Python 3 is already installed
# 2. Check if virtual environment exists
# 3. Check if pyasic is already installed
# 4. Only install what's missing
# 5. Verify everything works
```

**Smart Installation:**
- If everything is already installed, it exits immediately
- Only installs missing components
- Upgrades existing packages if needed
- Verifies installation before completing

---

## 📋 Manual Setup (Alternative)

If the automated script doesn't work, follow these steps:

### **1. Install System Dependencies**

```bash
# Update package list
sudo apt-get update

# Install Python and pip
sudo apt-get install -y python3-full python3-venv python3-pip
```

### **2. Create Virtual Environment**

```bash
cd /opt/mining-stack

# Create venv
python3 -m venv venv

# Activate venv
source venv/bin/activate
```

### **3. Install Python Packages**

```bash
# Upgrade pip
pip install --upgrade pip

# Install pyasic and dependencies
pip install pyasic pyyaml netifaces
```

### **4. Verify Installation**

```bash
# Check pyasic is installed
python3 -c "import pyasic; print(f'pyasic version: {pyasic.__version__}')"

# Should output: pyasic version: X.X.X
```

---

## 🔍 Test Miner Discovery

### **Manual Discovery Test**

```bash
cd /opt/mining-stack
source venv/bin/activate

# Run discovery script
python3 bin/farm_init.py
```

This will:
- Scan your local network for miners
- Detect miner models and IPs
- Create/update `etc/miners.yaml`

### **Expected Output**

```
Found network: 192.168.1.0/24 (interface: eth0)
Scanning 254 IPs for miners...
Progress: [####################] 100%

Found 3 miners:
  - 192.168.1.100: Antminer S19j Pro
  - 192.168.1.101: Antminer S19j Pro  
  - 192.168.1.102: Whatsminer M30S++

Miners configuration saved to: /opt/mining-stack/etc/miners.yaml
```

---

## 🔧 Using Auto-Discovery in UI

Once Python and pyasic are installed:

1. Open the Mining Stack dashboard: `http://your-pi-ip:3000`
2. Go to **Miners** page
3. Click **"Auto-Discover Miners"** button
4. Wait for the scan to complete
5. Review discovered miners
6. Save configuration

---

## 📊 Automatic Metrics Collection

To enable automatic miner metrics collection:

```bash
cd /opt/mining-stack

# Setup cron job for metrics collection
./bin/setup-metrics-cron.sh

# This will collect metrics every 5 minutes
```

Verify cron is set up:
```bash
crontab -l | grep pyasic
```

Should show:
```
*/5 * * * * /opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/pyasic_textfile.py
```

---

## 🐛 Troubleshooting

### **"pyasic not found" Error**

```bash
cd /opt/mining-stack

# Recreate virtual environment
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install pyasic pyyaml netifaces
```

### **"No miners found" Error**

**Possible causes:**
1. Miners are on a different network
2. Firewall blocking connections
3. Miners using non-standard ports

**Solutions:**

```bash
# Check your network
ip addr show

# Test connectivity to a known miner
ping 192.168.1.100

# Try manual IP in farm_init.py
# Edit EXTRA_IPS in bin/farm_init.py to add your miner IPs
```

### **Permission Errors**

```bash
# Fix ownership of venv
sudo chown -R $(whoami):$(whoami) /opt/mining-stack/venv

# Make scripts executable
chmod +x /opt/mining-stack/bin/*.sh
chmod +x /opt/mining-stack/bin/*.py
```

### **Network Detection Issues**

If auto-detection doesn't find your network:

```bash
# Check network interfaces
ip addr show

# Manually specify network in farm_init.py
# Edit SCAN_NETWORK variable
```

---

## 📝 Manual Miner Configuration

If auto-discovery doesn't work, you can manually configure miners:

```bash
cd /opt/mining-stack

# Edit miners.yaml
nano etc/miners.yaml
```

Example configuration:
```yaml
miners:
  - name: "miner-1"
    ip: "192.168.1.100"
    model: "Antminer S19j Pro"
    alias: "Miner 1"
    owner: "Farm Owner"
  
  - name: "miner-2"
    ip: "192.168.1.101"
    model: "Antminer S19j Pro"
    alias: "Miner 2"
    owner: "Farm Owner"
```

---

## 🔄 Update pyasic

To update to the latest version:

```bash
cd /opt/mining-stack
source venv/bin/activate
pip install --upgrade pyasic
```

---

## 📚 Additional Resources

- **pyasic Documentation**: https://pyasic.readthedocs.io/
- **Supported Miners**: https://pyasic.readthedocs.io/en/latest/miners/supported.html
- **API Reference**: https://pyasic.readthedocs.io/en/latest/api.html

---

## ✅ Verification Checklist

After setup, verify everything works:

- [ ] Python 3 installed: `python3 --version`
- [ ] Virtual environment created: `ls -la venv/`
- [ ] pyasic installed: `source venv/bin/activate && python -c "import pyasic"`
- [ ] Discovery script works: `python3 bin/farm_init.py`
- [ ] Miners found and configured: `cat etc/miners.yaml`
- [ ] Cron job set up: `crontab -l | grep pyasic`
- [ ] Metrics collected: `ls -la textfile/`

---

## 🎯 Quick Commands Reference

```bash
# Setup
cd /opt/mining-stack
./bin/setup-pyasic-venv.sh

# Test discovery
source venv/bin/activate
python3 bin/farm_init.py

# Setup metrics collection
./bin/setup-metrics-cron.sh

# Check metrics
cat textfile/miner_metrics.prom

# View logs
tail -f logs/combined.log
```

---

**Once setup is complete, the "Auto-Discover Miners" button in the UI will work!** 🎉
