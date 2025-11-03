# Backend Configuration Alignment

## Issue Found

The backend's `miners.config.ts` uses a **nested credentials structure** that is incompatible with the new Python collectors.

### Current Backend Structure (INCOMPATIBLE)
```typescript
export interface MinerCredentials {
  username: string;
  password: string;
}

export interface MinerConfig {
  ip: string;
  name?: string;
  model: string;
  alias?: string;
  owner?: string;
  credentials?: MinerCredentials;  // ❌ Nested structure
  // ...
}
```

### Expected by Python Collectors (CORRECT)
```yaml
miners:
  - ip: "192.168.1.100"
    name: "s19-01"
    model: "Antminer S19"
    username: "root"      # ✅ Flat field
    password: "root"      # ✅ Flat field
    api_port: 4028        # ✅ Optional
```

---

## Required Changes

### 1. Update TypeScript Interface

**File**: `backend/src/config/miners.config.ts`

**Change**:
```typescript
// OLD (lines 42-45) - REMOVE
export interface MinerCredentials {
  username: string;
  password: string;
}

// OLD (line 53) - REMOVE
credentials?: MinerCredentials;

// NEW - ADD to MinerConfig interface
username?: string;      // Flat field for CGI auth
password?: string;      // Flat field for CGI auth
api_port?: number;      // Custom CGMiner API port (default: 4028)
```

### 2. Update Load Function

**File**: `backend/src/config/miners.config.ts`

**Current** (lines 114-124):
```typescript
miners = config.miners.map(miner => {
  const name = miner.name || `miner-${miner.ip.replace(/\./g, '-')}`;
  
  return ({
    ...miner,
    name,
    status: 'offline',
    lastSeen: currentTime
  });
});
```

**No change needed** - spread operator will preserve flat fields

### 3. Update Save Function

**File**: `backend/src/config/miners.config.ts`

**Current** (lines 214-228):
```typescript
const minersData = minersToSave.map(m => {
  const data: any = {
    ip: m.ip,
    name: m.name || `miner-${m.ip.replace(/\./g, '-')}`,
    model: m.model,
    alias: m.alias,
    owner: m.owner,
  };
  
  if (m.thresholds) {
    data.thresholds = m.thresholds;
  }
  
  return data;
});
```

**Change to**:
```typescript
const minersData = minersToSave.map(m => {
  const data: any = {
    ip: m.ip,
    name: m.name || `miner-${m.ip.replace(/\./g, '-')}`,
    model: m.model,
    alias: m.alias,
  };
  
  // Add optional fields only if present
  if (m.username) data.username = m.username;
  if (m.password) data.password = m.password;
  if (m.api_port) data.api_port = m.api_port;
  if (m.thresholds) data.thresholds = m.thresholds;
  
  // Remove deprecated fields
  // Don't save: owner, credentials, status, lastSeen
  
  return data;
});
```

---

## Migration Strategy

### Option 1: Update Interface (Recommended)

Update the TypeScript interface to match Python collectors:

```typescript
export interface MinerConfig {
  // Required fields
  ip: string;
  name: string;  // Make required (auto-generated if missing)
  model: string;
  
  // Optional display
  alias?: string;
  
  // Optional authentication (flat structure)
  username?: string;
  password?: string;
  api_port?: number;
  
  // Runtime fields (not saved to YAML)
  status?: 'online' | 'offline' | 'error';
  lastSeen?: Date;
  
  // Optional thresholds
  thresholds?: MinerThresholds;
  
  // Optional pools
  pools?: PoolConfig[];
  
  // Deprecated - remove
  // owner?: string;
  // credentials?: MinerCredentials;
  // useHttps?: boolean;
}
```

### Option 2: Support Both Formats (Backward Compatible)

Add migration logic to handle both old and new formats:

```typescript
export const loadMinersConfig = (): MinerConfig[] => {
  // ... existing code ...
  
  miners = config.miners.map(miner => {
    const name = miner.name || `miner-${miner.ip.replace(/\./g, '-')}`;
    
    // Migrate old nested credentials to flat fields
    let username = miner.username;
    let password = miner.password;
    
    if (!username && miner.credentials) {
      username = miner.credentials.username;
      password = miner.credentials.password;
      logger.info(`Migrating credentials for ${name} to flat structure`);
    }
    
    return {
      ...miner,
      name,
      username,
      password,
      status: 'offline',
      lastSeen: currentTime
    };
  });
  
  // ... rest of code ...
};
```

---

## Testing

### 1. Test Loading Old Format
```yaml
# Old format (should still work)
miners:
  - ip: "192.168.1.100"
    model: "Antminer S19"
    credentials:
      username: "root"
      password: "root"
```

### 2. Test Loading New Format
```yaml
# New format (preferred)
miners:
  - ip: "192.168.1.100"
    name: "s19-100"
    model: "Antminer S19"
    username: "root"
    password: "root"
    api_port: 4028
```

### 3. Test Saving
After backend saves, verify YAML uses flat structure:
```yaml
miners:
  - ip: "192.168.1.100"
    name: "s19-100"
    model: "Antminer S19"
    alias: "Main Rig"
    username: "root"
    password: "root"
    api_port: 4028
```

---

## Impact Analysis

### Files to Update
1. ✅ `backend/src/config/miners.config.ts` - Interface and save/load logic
2. ⚠️ `backend/src/services/miner-control.service.ts` - If it uses credentials
3. ⚠️ Frontend TypeScript interfaces - If they reference MinerConfig

### Breaking Changes
- ❌ Old `credentials` nested structure no longer saved
- ✅ Can read both old and new formats (with migration)
- ✅ Always saves in new flat format

### Non-Breaking Changes
- ✅ `name` field auto-generated if missing
- ✅ `username`/`password` optional (defaults in collectors)
- ✅ `api_port` optional (default 4028 in collectors)

---

## Recommended Implementation

### Step 1: Update Interface
```typescript
export interface MinerConfig {
  ip: string;
  name: string;
  model: string;
  alias?: string;
  username?: string;
  password?: string;
  api_port?: number;
  status?: 'online' | 'offline' | 'error';
  lastSeen?: Date;
  thresholds?: MinerThresholds;
  pools?: PoolConfig[];
}
```

### Step 2: Add Migration Logic
```typescript
export const loadMinersConfig = (): MinerConfig[] => {
  try {
    const { config: appConfig } = require('./config');
    const configPath = fs.existsSync(appConfig.paths.minerConfig)
      ? appConfig.paths.minerConfig
      : appConfig.paths.minerConfigFallback;
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as { miners: any[] };
    
    if (config && Array.isArray(config.miners)) {
      const currentTime = new Date();
      miners = config.miners.map(miner => {
        const name = miner.name || `miner-${miner.ip.replace(/\./g, '-')}`;
        
        // Migrate old nested credentials to flat fields
        let username = miner.username;
        let password = miner.password;
        
        if (!username && miner.credentials) {
          username = miner.credentials.username;
          password = miner.credentials.password;
        }
        
        return {
          ip: miner.ip,
          name,
          model: miner.model,
          alias: miner.alias,
          username,
          password,
          api_port: miner.api_port,
          status: 'offline' as const,
          lastSeen: currentTime,
          thresholds: miner.thresholds,
          pools: miner.pools
        };
      });
      
      logger.info(`Loaded configuration for ${miners.length} miners`);
      return miners;
    }
    
    throw new Error('Invalid miners configuration format');
  } catch (error) {
    logger.error('Failed to load miners configuration:', error);
    return [];
  }
};
```

### Step 3: Update Save Logic
```typescript
export const saveMinersConfig = (minersToSave: MinerConfig[]): void => {
  try {
    const { config: appConfig } = require('./config');
    const configPath = appConfig.paths.minerConfig;
    
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const minersData = minersToSave.map(m => {
      const data: any = {
        ip: m.ip,
        name: m.name,
        model: m.model,
      };
      
      // Add optional fields only if present
      if (m.alias) data.alias = m.alias;
      if (m.username) data.username = m.username;
      if (m.password) data.password = m.password;
      if (m.api_port) data.api_port = m.api_port;
      if (m.thresholds) data.thresholds = m.thresholds;
      if (m.pools) data.pools = m.pools;
      
      return data;
    });
    
    const data = { miners: minersData };
    const yamlStr = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    
    fs.writeFileSync(configPath, yamlStr, 'utf8');
    logger.info(`Saved ${minersToSave.length} miners to ${configPath}`);
    
    regeneratePrometheusRules().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus rules:', err);
    });
  } catch (error) {
    logger.error('Failed to save miners configuration:', error);
    throw error;
  }
};
```

---

## Summary

✅ **Backend needs updates** to align with Python collectors  
✅ **Migration logic** can support both old and new formats  
✅ **Always save** in new flat format  
✅ **Backward compatible** during transition  

The updated backend will seamlessly work with the new modular collector architecture!
