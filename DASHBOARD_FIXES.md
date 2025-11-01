# Mining Dashboard Fixes

## Issues Fixed

### 1. ✅ 24h Average Hashrate
**Problem:** Dashboard only showed current hashrate, no 24h average.

**Solution:**
- Added `averageHashrate24h` field to `MiningStats` interface
- Calculate average from `statsHistory` array (last 60 data points)
- Display in new card on dashboard with 2 decimal precision

### 2. ✅ Active Miners Count Constantly Changing
**Problem:** Active miners number changed every 5 seconds because status was randomly recalculated each update.

**Solution:**
- Implemented persistent miner state using `Map<string, MinerState>`
- Added minimum status change interval: 5 minutes
- Only 5% chance of status change after minimum interval
- Miners maintain stable online/offline status between changes

**Before:** Random 90% probability every 5 seconds → constant flickering
**After:** Stable status with rare, realistic changes

### 3. ✅ Unrealistic BTC Mining Numbers
**Problem:** Formula `totalHashrate / 10000` accumulated ~793 BTC in 24h (impossible for small mining operation).

**Solution:**
- Implemented realistic BTC calculation based on actual network parameters:
  - Network hashrate: 600 EH/s (600,000,000 TH/s)
  - Block reward: 3.125 BTC (post-2024 halving)
  - Blocks per day: 144
  - Daily network BTC: 450 BTC
- Formula: `(miner_hashrate / network_hashrate) * daily_btc * time_fraction`
- Display with 8 decimal places for realistic small values

**Example:** 500 TH/s → ~0.00000375 BTC per 5 seconds → ~0.000065 BTC per day

### 4. ✅ Aggressive Hashrate Changes
**Problem:** ±10% variance recalculated randomly every 5 seconds caused jumpy graphs.

**Solution:**
- Reduced variance from ±10% to ±2%
- Implemented exponential moving average (EMA) with alpha=0.3
- Smooth transitions: `currentHashrate = 0.3 * target + 0.7 * lastHashrate`
- Persistent hashrate tracking per miner

**Before:** Hashrate could jump ±10 TH/s instantly
**After:** Smooth, gradual changes that look realistic

## Technical Changes

### Backend (`mining.service.ts`)
```typescript
// Added persistent state
const minerPersistentState = new Map<string, {
  status: 'online' | 'offline' | 'error';
  lastHashrate: number;
  lastStatusChange: number;
}>();

// Minimum 5 minutes between status changes
const MIN_STATUS_CHANGE_INTERVAL = 5 * 60 * 1000;

// Smooth hashrate with EMA
const alpha = 0.3;
currentHashrate = alpha * targetHashrate + (1 - alpha) * state.lastHashrate;

// Realistic BTC calculation
const networkHashrate = 600000000; // 600 EH/s
const dailyBTC = 450;
const btcMined = (totalHashrate / networkHashrate) * dailyBTC * timeFraction;

// Calculate 24h average
const averageHashrate24h = statsHistory.reduce((sum, stat) => 
  sum + stat.hashrate, 0) / statsHistory.length;
```

### Frontend (`Dashboard.tsx`)
- Changed from 3 cards to 4 cards layout (xs=12 md=3)
- Added "24h Avg Hashrate" card
- Format hashrate with 2 decimals: `toFixed(2)`
- Format BTC with 8 decimals: `toFixed(8)`

### API Interface (`api.ts`)
- Added `averageHashrate24h: number` to `MiningStatsResponse`

## Testing Recommendations

1. **Monitor Active Miners:** Should stay stable for at least 5 minutes
2. **Check Hashrate Graph:** Should show smooth curves, not jagged lines
3. **Verify BTC Accumulation:** With 500 TH/s, expect ~0.000065 BTC/day
4. **Compare 24h Average:** Should be close to current hashrate if stable

## Configuration

All simulation parameters can be adjusted in `backend/src/config/config.ts`:
- `onlineProbability`: Initial online chance (default: 0.9)
- `errorProbability`: Error chance when online (default: 0.2)
- `hashrateVariance`: Not used anymore (replaced with 2% hardcoded)
- `updateInterval`: Update frequency (default: 5000ms)

## Notes

- Miner state persists in memory (resets on server restart)
- 24h average requires time to build up history (starts with current value)
- BTC calculation assumes 600 EH/s network hashrate (adjust if needed)
- Smoothing factor (alpha=0.3) can be adjusted for more/less responsiveness
