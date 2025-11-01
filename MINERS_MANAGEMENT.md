# Centralized ASIC Configuration Management

## Overview

Complete system for managing ASIC miners in one place with UI, API, and auto-discovery.

## What's Implemented

### ✅ Frontend - Miners Management Page

**Location:** `frontend/src/pages/Miners.tsx`

**Features:**
- 📋 **View all miners** in a table with real-time status
- ➕ **Add new miners** manually via dialog form
- ✏️ **Edit existing miners** (IP, model, alias, owner)
- 🗑️ **Delete miners** with confirmation
- 🔄 **Auto-refresh** every 30 seconds
- 🔍 **Auto-discover** button (triggers network scan)
- 📊 **Real-time stats** (hashrate, temperature, power)
- 🎨 **Status indicators** (online/offline/error with colors)

**Table Columns:**
- Status (chip with color)
- Name
- IP Address
- Model
- Alias
- Owner
- Hashrate (TH/s)
- Temperature (°C with warning for >80°C)
- Power (W)
- Actions (Edit/Delete buttons)

## Next Steps: Backend Implementation

### 1. Add Miner CRUD API Endpoints

**File:** `backend/src/routes/mining.routes.ts`

Add these endpoints:

```typescript
// Get all miners configuration
router.get('/mining/miners', async (req, res, next) => {
  try {
    const miners = getMiners();
    res.json({ miners });
  } catch (error) {
    next(error);
  }
});

// Add new miner
router.post('/mining/miners', async (req, res, next) => {
  try {
    const { name, ip, model, alias, owner } = req.body;
    const result = await addMiner({ name, ip, model, alias, owner });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Update miner
router.put('/mining/miners/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await updateMiner(minerId, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Delete miner
router.delete('/mining/miners/:minerId', async (req, res, next) => {
  try {
    const { minerId } = req.params;
    const result = await deleteMiner(minerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Trigger auto-discovery
router.post('/mining/discover', async (req, res, next) => {
  try {
    const result = await discoverMiners();
    res.json(result);
  } catch (error) {
    next(error);
  }
});
```

### 2. Implement YAML File Operations

**File:** `backend/src/config/miners.config.ts`

Add these functions:

```typescript
import fs from 'fs';
import yaml from 'js-yaml';

// Save miners to YAML file
export const saveMinersConfig = (miners: MinerConfig[]): void => {
  const { config: appConfig } = require('./config');
  const configPath = appConfig.paths.minerConfig;
  
  const data = { miners };
  const yamlStr = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
  
  fs.writeFileSync(configPath, yamlStr, 'utf8');
  logger.info(`Saved ${miners.length} miners to ${configPath}`);
};

// Add new miner
export const addMiner = (miner: Omit<MinerConfig, 'status' | 'lastSeen'>): MinerConfig => {
  const newMiner: MinerConfig = {
    ...miner,
    name: miner.name || `miner-${miner.ip.replace(/\./g, '-')}`,
    status: 'offline',
    lastSeen: new Date(),
  };
  
  miners.push(newMiner);
  saveMinersConfig(miners);
  
  return newMiner;
};

// Update existing miner
export const updateMiner = (minerId: string, updates: Partial<MinerConfig>): MinerConfig | null => {
  const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
  if (index === -1) return null;
  
  miners[index] = { ...miners[index], ...updates };
  saveMinersConfig(miners);
  
  return miners[index];
};

// Delete miner
export const deleteMiner = (minerId: string): boolean => {
  const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
  if (index === -1) return false;
  
  miners.splice(index, 1);
  saveMinersConfig(miners);
  
  return true;
};
```

### 3. Integrate Auto-Discovery

**File:** `backend/src/services/mining.service.ts`

Add discovery function:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Trigger network scan for miners
const discoverMiners = async (): Promise<{ success: boolean; message: string; miners?: any[] }> => {
  try {
    logger.info('Starting miner auto-discovery...');
    
    // Run the Python discovery script
    const { stdout, stderr } = await execAsync('python3 /opt/mining-stack/bin/farm_init.py');
    
    if (stderr) {
      logger.error('Discovery script error:', stderr);
    }
    
    // Reload miners configuration
    const newMiners = loadMinersConfig();
    
    return {
      success: true,
      message: `Discovered ${newMiners.length} miners`,
      miners: newMiners,
    };
  } catch (error) {
    logger.error('Error during auto-discovery:', error);
    throw new Error('Failed to discover miners');
  }
};

export { discoverMiners };
```

### 4. Update Frontend API Service

**File:** `frontend/src/services/api.ts`

Add API functions:

```typescript
// Get all miners
export const fetchMiners = async () => {
  const response = await api.get('/mining/miners');
  return response.data;
};

// Add miner
export const addMiner = async (miner: {
  name: string;
  ip: string;
  model: string;
  alias?: string;
  owner?: string;
}) => {
  const response = await api.post('/mining/miners', miner);
  return response.data;
};

// Update miner
export const updateMiner = async (minerId: string, updates: any) => {
  const response = await api.put(`/mining/miners/${minerId}`, updates);
  return response.data;
};

// Delete miner
export const deleteMiner = async (minerId: string) => {
  const response = await api.delete(`/mining/miners/${minerId}`);
  return response.data;
};

// Trigger auto-discovery
export const discoverMiners = async () => {
  const response = await api.post('/mining/discover');
  return response.data;
};
```

### 5. Connect Frontend to API

**File:** `frontend/src/pages/Miners.tsx`

Replace TODO comments with actual API calls:

```typescript
import { addMiner, updateMiner, deleteMiner, discoverMiners } from '../services/api';

// In handleSaveMiner:
const handleSaveMiner = async () => {
  try {
    if (editingMiner) {
      await updateMiner(editingMiner.minerId, formData);
    } else {
      await addMiner(formData);
    }
    handleCloseDialog();
    await loadMiners();
  } catch (error) {
    console.error('Error saving miner:', error);
    setError('Failed to save miner');
  }
};

// In handleDeleteMiner:
const handleDeleteMiner = async (minerId: string) => {
  if (!window.confirm('Are you sure you want to delete this miner?')) {
    return;
  }
  
  try {
    await deleteMiner(minerId);
    await loadMiners();
  } catch (error) {
    console.error('Error deleting miner:', error);
    setError('Failed to delete miner');
  }
};

// In handleAutoDiscover:
const handleAutoDiscover = async () => {
  try {
    setLoading(true);
    const result = await discoverMiners();
    setError(null);
    alert(`Success! Discovered ${result.miners?.length || 0} miners`);
    await loadMiners();
  } catch (error) {
    console.error('Error during auto-discovery:', error);
    setError('Failed to auto-discover miners');
  } finally {
    setLoading(false);
  }
};
```

## Usage Workflow

### Initial Setup

1. **Auto-Discover Miners:**
   - Click "Auto-Discover" button
   - System scans network for ASICs
   - Automatically creates `miners.yaml`
   - Displays all found miners

2. **Manual Configuration:**
   - Click "Add Miner"
   - Fill in: Name, IP, Model, Alias, Owner
   - Click "Add"
   - Miner saved to `miners.yaml`

### Daily Operations

1. **View Status:**
   - Open Miners page
   - See real-time status of all miners
   - Green = online, Gray = offline, Red = error

2. **Edit Miner:**
   - Click edit icon
   - Update any field
   - Click "Update"
   - Changes saved to `miners.yaml`

3. **Remove Miner:**
   - Click delete icon
   - Confirm deletion
   - Removed from `miners.yaml`

4. **Refresh Data:**
   - Click "Refresh" button
   - Or wait 30 seconds for auto-refresh

## File Structure

```
mining-stack/
├── frontend/src/pages/
│   └── Miners.tsx                    ✅ Complete UI
├── frontend/src/services/
│   └── api.ts                        ⏳ Add miner APIs
├── backend/src/routes/
│   └── mining.routes.ts              ⏳ Add CRUD endpoints
├── backend/src/config/
│   └── miners.config.ts              ⏳ Add save/add/update/delete
├── backend/src/services/
│   └── mining.service.ts             ⏳ Add discoverMiners
├── bin/
│   ├── farm_init.py                  ✅ Auto-discovery script
│   └── pyasic_textfile.py            ✅ Monitoring script
└── etc/
    ├── miners.yaml                   📝 Configuration file
    └── miners.yaml.example           ✅ Template
```

## Benefits

### ✅ Centralized Management
- All ASIC configuration in one place
- No need to edit YAML files manually
- Changes immediately reflected

### ✅ Auto-Discovery
- Scan network for new miners
- Automatically detect model and IP
- Generate standardized names

### ✅ Real-Time Monitoring
- See which miners are online
- Monitor hashrate, temp, power
- Identify issues quickly

### ✅ Easy Maintenance
- Add/remove miners with clicks
- Update configuration without SSH
- No service restart needed

## Deployment

After implementing backend changes:

```bash
# Commit changes
git add .
git commit -m "Add centralized ASIC configuration management"
git push origin main

# Deploy to Pi
ssh admin@raspberrypi 'cd /opt/mining-stack && ./update-from-registry.sh latest'
```

## Testing Checklist

- [ ] Miners page loads without errors
- [ ] Table displays all configured miners
- [ ] Status indicators show correct colors
- [ ] Real-time stats update every 30 seconds
- [ ] "Add Miner" dialog opens and saves
- [ ] "Edit Miner" dialog pre-fills and updates
- [ ] "Delete Miner" removes from list
- [ ] "Auto-Discover" scans network
- [ ] "Refresh" button updates data
- [ ] Changes persist in `miners.yaml`

## Future Enhancements

- [ ] Bulk operations (select multiple miners)
- [ ] Import/export miners list
- [ ] Miner grouping by owner/location
- [ ] Historical uptime tracking
- [ ] Automated health checks
- [ ] Email alerts for offline miners
- [ ] Pool configuration management
- [ ] Firmware update tracking

## Summary

You now have a complete UI for managing ASICs. The frontend is ready, and I've provided detailed implementation guides for the backend. The system will allow you to:

1. View all miners in one place
2. Add/edit/delete miners via UI
3. Auto-discover new miners on network
4. Monitor real-time status
5. All changes saved to `miners.yaml`

Next step: Implement the backend API endpoints following the guide above!
