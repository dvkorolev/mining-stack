# 🔧 Auto-Discover Fix - Virtual Environment Missing

## Problem

```bash
curl -X POST http://localhost:5000/api/mining/discover
{"status":"error","statusCode":500,"message":"Python virtual environment or pyasic not installed. Please run setup."}
```

## Root Cause

The virtual environment doesn't exist at `/opt/mining-stack/venv/bin/python3` on the Raspberry Pi.

**The backend is checking:**
```typescript
const pythonPath = '/opt/mining-stack/venv/bin/python3';
if (!fs.existsSync(pythonPath)) {
  throw new Error(`Python virtual environment not found at ${pythonPath}. Please run setup.`);
}
```

## Solution: Create Virtual Environment

### Step 1: Check if venv exists

```bash
# On Raspberry Pi
ls -la /opt/mining-stack/venv/bin/python3

# If it doesn't exist, you'll see:
# ls: cannot access '/opt/mining-stack/venv/bin/python3': No such file or directory
```

### Step 2: Create Virtual Environment

```bash
cd /opt/mining-stack

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install required packages
pip install --upgrade pip
pip install pyasic pyyaml netifaces aiohttp

# Verify installation
python3 -c "import pyasic; print('pyasic version:', pyasic.__version__)"
python3 -c "import yaml; print('pyyaml installed')"
python3 -c "import netifaces; print('netifaces installed')"

# Deactivate
deactivate
```

### Step 3: Test Discovery Script

```bash
# Test the script directly
/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/farm_init.py

# Should output:
# Found network: 192.168.1.0/24 (interface: eth0)
# [1/3] Scanning ports...
# Found 23 potential miners
# [2/3] Identifying miners...
# Identified 22-23 miners
# [3/3] Creating inventory file
# Success!
```

### Step 4: Test API Endpoint

```bash
# Test via API
curl -X POST http://localhost:5000/api/mining/discover

# Should return:
# {"success":true,"message":"Discovered 22 miners","miners":[...]}
```

---

## Alternative: Use System Python (Quick Fix)

If you don't want to create a venv, modify the backend to use system Python:

**File:** `backend/src/services/mining.service.ts`

```typescript
// Change from:
const pythonPath = process.env.NODE_ENV === 'production'
  ? '/opt/mining-stack/venv/bin/python3'
  : path.join(process.cwd(), 'venv', 'bin', 'python3');

// To:
const pythonPath = process.env.NODE_ENV === 'production'
  ? 'python3'  // Use system Python
  : path.join(process.cwd(), 'venv', 'bin', 'python3');
```

**But you'll need to install pyasic system-wide:**

```bash
sudo pip3 install pyasic pyyaml netifaces aiohttp
```

---

## Recommended: Setup Script

Create a setup script to automate this:

**File:** `scripts/setup-venv.sh`

```bash
#!/bin/bash
# Setup virtual environment for mining stack

echo "🔧 Setting up Python virtual environment..."

cd /opt/mining-stack

# Check if venv exists
if [ -d "venv" ]; then
  echo "✅ Virtual environment already exists"
else
  echo "📦 Creating virtual environment..."
  python3 -m venv venv
fi

# Activate and install packages
echo "📥 Installing Python packages..."
source venv/bin/activate
pip install --upgrade pip
pip install pyasic pyyaml netifaces aiohttp

# Verify
echo ""
echo "✅ Verifying installation..."
python3 -c "import pyasic; print('✓ pyasic:', pyasic.__version__)"
python3 -c "import yaml; print('✓ pyyaml installed')"
python3 -c "import netifaces; print('✓ netifaces installed')"
python3 -c "import aiohttp; print('✓ aiohttp installed')"

deactivate

echo ""
echo "✅ Setup complete!"
echo ""
echo "Test discovery with:"
echo "  ./venv/bin/python3 bin/farm_init.py"
```

**Usage:**

```bash
chmod +x scripts/setup-venv.sh
./scripts/setup-venv.sh
```

---

## Why This Happened

The virtual environment was never created on the Raspberry Pi. The code expects it to exist, but it doesn't.

**Two options:**
1. ✅ **Create venv** (recommended) - Isolated Python environment
2. ⚠️ **Use system Python** - Simpler but less isolated

---

## Complete Fix Steps

### On Raspberry Pi:

```bash
# 1. Pull latest code
cd /opt/mining-stack
git pull origin main

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install pyasic pyyaml netifaces aiohttp
deactivate

# 3. Rebuild and restart backend
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d

# 4. Test discovery
curl -X POST http://localhost:5000/api/mining/discover

# Should work now! ✅
```

---

## Verification

After setup, verify everything works:

```bash
# 1. Check venv exists
ls -la /opt/mining-stack/venv/bin/python3
# Should show: -rwxr-xr-x ... /opt/mining-stack/venv/bin/python3

# 2. Check pyasic is installed
/opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"
# Should show: OK

# 3. Test discovery script
/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/farm_init.py
# Should discover miners

# 4. Test API
curl -X POST http://localhost:5000/api/mining/discover
# Should return success
```

---

**Status:** Virtual environment missing on Raspberry Pi  
**Solution:** Create venv and install pyasic  
**Time:** 5 minutes  
**Priority:** 🔴 High - blocks auto-discovery feature
