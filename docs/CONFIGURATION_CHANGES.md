# Configuration Changes Summary

## Overview

All hardcoded values have been removed from the codebase and moved to environment variables for better flexibility and configurability. The project now follows the **12-factor app** methodology for configuration management.

## What Was Changed

### 1. WebSocket Configuration

**Before:**
```typescript
// Hardcoded 30 second ping interval
setInterval(() => { ... }, 30000);
```

**After:**
```typescript
// Configurable via WS_PING_INTERVAL
setInterval(() => { ... }, config.websocket.pingInterval);
```

**New Environment Variables:**
- `WS_PATH` - WebSocket endpoint path (default: `/ws`)
- `WS_PING_INTERVAL` - Ping interval in milliseconds (default: `30000`)

### 2. Simulation Configuration

**Before:**
```typescript
// Hardcoded probabilities and ranges
const isOnline = Math.random() > 0.1; // 90% chance
const hasError = isOnline && Math.random() < 0.2; // 20% error
temperature: 60 + Math.random() * 30, // 60-90°C
fanSpeed: 3000 + Math.random() * 2000, // 3000-5000 RPM
powerUsage: 2000 + Math.random() * 1000 // 2000-3000W
```

**After:**
```typescript
// All values configurable via environment variables
const isOnline = Math.random() > (1 - config.simulation.onlineProbability);
const hasError = isOnline && Math.random() < config.simulation.errorProbability;
temperature: config.simulation.tempMin + Math.random() * (config.simulation.tempMax - config.simulation.tempMin)
```

**New Environment Variables:**
- `SIM_ONLINE_PROBABILITY` - Probability miner is online (default: `0.9`)
- `SIM_ERROR_PROBABILITY` - Probability of error when online (default: `0.2`)
- `SIM_HASHRATE_VARIANCE` - Hashrate variance fraction (default: `0.1`)
- `SIM_TEMP_MIN` - Minimum temperature in °C (default: `60`)
- `SIM_TEMP_MAX` - Maximum temperature in °C (default: `90`)
- `SIM_FAN_MIN` - Minimum fan speed in RPM (default: `3000`)
- `SIM_FAN_MAX` - Maximum fan speed in RPM (default: `5000`)
- `SIM_POWER_MIN` - Minimum power usage in W (default: `2000`)
- `SIM_POWER_MAX` - Maximum power usage in W (default: `3000`)

### 3. File Paths

**Before:**
```typescript
// Hardcoded paths
const configPath = '/opt/mining-monitor/etc/miners.yaml';
```

**After:**
```typescript
// Configurable paths with fallback
const configPath = config.paths.minerConfig || config.paths.minerConfigFallback;
```

**New Environment Variables:**
- `MINER_CONFIG_PATH` - Path to miners.yaml (default: `/opt/mining-monitor/etc/miners.yaml`)
- `LOGS_DIR` - Directory for log files (default: `./logs`)

## Benefits

### 1. **Flexibility**
- Easy to adjust simulation parameters for testing
- Can tune performance without code changes
- Different configurations for dev/staging/production

### 2. **Simplicity**
- All configuration in one place (.env file)
- Clear defaults for all values
- No need to modify code for common changes

### 3. **Maintainability**
- Easier to understand what can be configured
- Better documentation of configuration options
- Reduced risk of breaking changes

### 4. **Testing**
- Easy to create different test scenarios
- Can simulate various hardware conditions
- Quick parameter adjustments

## Migration Guide

### For Existing Deployments

1. **Copy the example environment file:**
   ```bash
   cp backend/.env.example backend/.env
   ```

2. **Review and adjust values:**
   - All existing defaults are preserved
   - No changes required for current behavior
   - Customize as needed for your environment

3. **Restart the application:**
   ```bash
   docker compose restart backend
   ```

### For New Deployments

Simply use the provided `.env.example` as a template. All defaults are production-ready.

## Configuration Examples

### High-Reliability Simulation
```bash
# More stable miners, fewer errors
SIM_ONLINE_PROBABILITY=0.98
SIM_ERROR_PROBABILITY=0.05
SIM_HASHRATE_VARIANCE=0.05
```

### Stress Testing
```bash
# More failures for testing error handling
SIM_ONLINE_PROBABILITY=0.7
SIM_ERROR_PROBABILITY=0.4
SIM_HASHRATE_VARIANCE=0.3
```

### Cool Environment
```bash
# Lower temperature ranges
SIM_TEMP_MIN=50
SIM_TEMP_MAX=70
```

### Custom Update Intervals
```bash
# Faster updates for real-time monitoring
MINING_UPDATE_INTERVAL=1000
WS_PING_INTERVAL=15000
```

## Backward Compatibility

All changes are **100% backward compatible**:
- Default values match previous hardcoded values
- No breaking changes to APIs
- Existing deployments work without modification

## Future Improvements

Potential future enhancements:
- [ ] Runtime configuration updates (without restart)
- [ ] Configuration validation on startup
- [ ] Configuration UI in the dashboard
- [ ] Per-miner configuration overrides
- [ ] Configuration profiles (dev/staging/prod)

## Documentation Updates

Updated documentation:
- ✅ `backend/.env.example` - Complete example with all options
- ✅ `docs/CONFIGURATION.md` - Full configuration reference
- ✅ `README.md` - Quick start guide
- ✅ Code comments - JSDoc documentation

## Summary

The project is now fully configurable through environment variables while maintaining simplicity and sensible defaults. No hardcoded values remain in the codebase, making it easy to adapt to different environments and use cases.
