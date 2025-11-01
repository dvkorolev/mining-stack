# ✅ Centralized ASIC Configuration - COMPLETE!

## What's Implemented

### ✅ Backend (Complete)

**1. YAML Operations** (`backend/src/config/miners.config.ts`)
- `saveMinersConfig()` - Save miners to YAML file
- `addMiner()` - Add new miner with validation
- `updateMiner()` - Update existing miner
- `deleteMiner()` - Remove miner from config

**2. Auto-Discovery** (`backend/src/services/mining.service.ts`)
- `discoverMiners()` - Trigger Python script to scan network
- Automatically creates/updates `miners.yaml`
- Reloads configuration after discovery

**3. API Endpoints** (`backend/src/routes/mining.routes.ts`)
- `GET /api/mining/miners` - Get all miners
- `POST /api/mining/miners` - Add new miner
- `PUT /api/mining/miners/:minerId` - Update miner
- `DELETE /api/mining/miners/:minerId` - Delete miner
- `POST /api/mining/discover` - Trigger auto-discovery

### ✅ Frontend (Complete)

**1. Miners Management Page** (`frontend/src/pages/Miners.tsx`)
- Full CRUD interface
- Real-time status monitoring
- Auto-refresh every 30 seconds
- Add/Edit dialog with validation
- Delete with confirmation
- Auto-discover button

**2. API Integration** (`frontend/src/services/api.ts`)
- `fetchMiners()` - Get all miners
- `addMiner()` - Add new miner
- `updateMiner()` - Update miner
- `deleteMiner()` - Delete miner
- `discoverMiners()` - Trigger network scan

## Features

### 📋 View All Miners
- Table with status, name, IP, model, alias, owner
- Real-time hashrate, temperature, power
- Color-coded status indicators
- Auto-refresh every 30 seconds

### ➕ Add Miner
- Click "Add Miner" button
- Fill in: Name, IP, Model, Alias, Owner
- Validates required fields
- Saves to `miners.yaml`

### ✏️ Edit Miner
- Click edit icon on any miner
- Update any field
- Prevents duplicate IPs
- Saves changes to `miners.yaml`

### 🗑️ Delete Miner
- Click delete icon
- Confirmation dialog
- Removes from `miners.yaml`

### 🔍 Auto-Discover
- Click "Auto-Discover" button
- Scans network for ASICs
- Detects model and IP automatically
- Creates `miners.yaml` with all found miners
- Shows success message with count

### 🔄 Refresh
- Manual refresh button
- Auto-refresh every 30 seconds
- Updates status and stats

## How to Use

### Initial Setup

**Option 1: Auto-Discovery (Recommended)**
```bash
# From the UI:
1. Open http://raspberrypi:3000/miners
2. Click "Auto-Discover"
3. Wait for scan to complete
4. All miners automatically added to miners.yaml
```

**Option 2: Manual Add**
```bash
# From the UI:
1. Click "Add Miner"
2. Enter:
   - Name: miner-01
   - IP: 192.168.1.100
   - Model: Antminer S19j Pro
   - Alias: Main Rig (optional)
   - Owner: EN (optional)
3. Click "Add"
```

### Daily Operations

**View Status:**
- Open Miners page
- See all miners with real-time status
- Green = online, Gray = offline, Red = error

**Edit Configuration:**
- Click edit icon
- Update fields
- Click "Update"

**Remove Miner:**
- Click delete icon
- Confirm deletion

## File Structure

```
backend/
├── src/
│   ├── config/
│   │   └── miners.config.ts        ✅ YAML operations
│   ├── services/
│   │   └── mining.service.ts       ✅ Auto-discovery
│   └── routes/
│       └── mining.routes.ts        ✅ CRUD endpoints

frontend/
├── src/
│   ├── pages/
│   │   └── Miners.tsx              ✅ Management UI
│   └── services/
│       └── api.ts                  ✅ API functions

etc/
└── miners.yaml                     📝 Configuration file
```

## API Endpoints

### Get All Miners
```bash
GET /api/mining/miners
Response: { miners: [...] }
```

### Add Miner
```bash
POST /api/mining/miners
Body: { name, ip, model, alias, owner }
Response: { success: true, miner: {...} }
```

### Update Miner
```bash
PUT /api/mining/miners/:minerId
Body: { name, ip, model, alias, owner }
Response: { success: true, miner: {...} }
```

### Delete Miner
```bash
DELETE /api/mining/miners/:minerId
Response: { success: true, message: "..." }
```

### Auto-Discover
```bash
POST /api/mining/discover
Response: { success: true, message: "...", miners: [...] }
```

## Deployment

```bash
# 1. Commit changes
git add .
git commit -m "Add centralized ASIC configuration management"
git push origin main

# 2. Wait for GitHub Actions (~5-10 min)

# 3. Deploy to Raspberry Pi
ssh admin@raspberrypi 'cd /opt/mining-stack && ./update-from-registry.sh latest'

# 4. Verify
# Open http://raspberrypi:3000/miners
```

## Testing Checklist

- [ ] Miners page loads without errors
- [ ] Table displays all configured miners
- [ ] Status indicators show correct colors
- [ ] Real-time stats update
- [ ] "Add Miner" dialog opens and saves
- [ ] "Edit Miner" pre-fills and updates
- [ ] "Delete Miner" removes from list
- [ ] "Auto-Discover" scans network
- [ ] "Refresh" button updates data
- [ ] Changes persist in `miners.yaml`
- [ ] Validation prevents duplicate IPs
- [ ] Required fields are enforced

## Configuration File

**Location:** `/opt/mining-stack/etc/miners.yaml`

**Format:**
```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19j Pro"
    alias: "Main Rig 1"
    owner: "EN"
  - ip: "192.168.1.101"
    name: "miner-02"
    model: "Antminer S19"
    alias: "Main Rig 2"
    owner: "EN"
```

## Benefits

✅ **Centralized Management**
- All ASIC configuration in one place
- No manual YAML editing
- Changes immediately reflected

✅ **Auto-Discovery**
- Scan network for new miners
- Automatically detect model and IP
- Generate standardized names

✅ **Real-Time Monitoring**
- See which miners are online
- Monitor hashrate, temp, power
- Identify issues quickly

✅ **Easy Maintenance**
- Add/remove miners with clicks
- Update configuration without SSH
- No service restart needed

✅ **Validation**
- Prevents duplicate IPs
- Enforces required fields
- Error handling with user feedback

## Troubleshooting

### Auto-Discovery Fails

**Error:** "Failed to auto-discover miners"

**Solution:**
```bash
# Check if Python and pyasic are installed
ssh admin@raspberrypi
python3 --version
python3 -c "import pyasic"

# If missing, install:
pip3 install pyasic netifaces
```

### Changes Not Persisting

**Issue:** Miners disappear after restart

**Solution:**
- Check `/opt/mining-stack/etc/miners.yaml` exists
- Verify write permissions
- Check backend logs for errors

### Miner Not Showing Status

**Issue:** Miner shows as offline but is online

**Solution:**
- Wait 30 seconds for auto-refresh
- Click "Refresh" button
- Check miner is reachable from Pi
- Verify IP address is correct

## Next Steps

Now that you have centralized configuration, you can:

1. **Bulk Import** - Add multiple miners at once
2. **Grouping** - Organize miners by owner/location
3. **Health Checks** - Automated monitoring
4. **Alerts** - Email notifications for issues
5. **Pool Management** - Configure pools from UI
6. **Firmware Tracking** - Monitor firmware versions

## Summary

You now have a complete, production-ready ASIC configuration management system:

- ✅ Full CRUD operations via UI
- ✅ Auto-discovery of miners on network
- ✅ Real-time status monitoring
- ✅ Persistent storage in YAML
- ✅ Validation and error handling
- ✅ No manual file editing needed

All miners can be managed from one place with a beautiful, intuitive interface!
