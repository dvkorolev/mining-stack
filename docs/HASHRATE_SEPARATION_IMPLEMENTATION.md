# Hashrate Separation Implementation

## Overview
Successfully implemented separation of SHA-256 and SCRYPT hashrate metrics across the entire mining stack application.

## Changes Made

### 1. Backend - mining.service.ts
**File**: `backend/src/services/mining.service.ts`

#### Interface Updates
- Added `totalHashrateSha256` and `totalHashrateScrypt` fields to `MiningStats`
- Added `averageHashrate24hSha256` and `averageHashrate24hScrypt` for 24h averages
- Added `activeMinersSha256` and `activeMinersScrypt` for active miner counts by algorithm
- Updated `statsHistory` to include `hashrateSha256` and `hashrateScrypt` fields
- Added `maxHashrateScrypt` and `minHashrateScrypt` to aggregates

#### Calculation Updates
- Modified `simulateMiningStats()` to calculate separate hashrates by algorithm
- Modified `getRealMiningStats()` to calculate separate hashrates by algorithm
- Modified metrics push processing to calculate separate hashrates by algorithm
- Updated `getMiningStats()` owner filtering to include separate hashrate fields
- Updated `calculateAggregates()` to:
  - Calculate efficiency using SHA-256 miners only
  - Track min/max hashrates separately for each algorithm
  - Filter history by algorithm type

### 2. Backend - telegram.service.ts
**File**: `backend/src/services/telegram.service.ts`

#### Farm Status Display
- Shows separate sections for SHA-256 and SCRYPT miners
- Displays hashrate and 24h average for each algorithm
- Shows active miner count per algorithm
- Uses `formatHashrate()` helper to display correct units (TH/s vs GH/s)

#### Miners List Display
- Shows combined hashrates when both algorithm types are present
- Format: "SHA-256: X TH/s | SCRYPT: Y GH/s"
- Falls back to single display when only one type exists

### 3. Frontend - api.ts
**File**: `frontend/src/services/api.ts`

#### Interface Updates
- Updated `MiningStatsResponse` interface with all new hashrate fields
- Added comments indicating SHA-256 only metrics
- Updated `statsHistory` type to include algorithm-specific hashrates
- Updated aggregates to include SCRYPT min/max hashrates

### 4. Frontend - Analytics.tsx
**File**: `frontend/src/pages/Analytics.tsx`

#### Display Changes
- Separated metrics into SHA-256 and SCRYPT sections
- Each section shows: Avg Hashrate (24h), Peak Hashrate, Min Hashrate
- SCRYPT hashrates converted from TH/s to GH/s for display (multiply by 1000)
- Sections only appear if miners of that algorithm type are active

#### Chart Updates
- **Miner Performance Comparison**: Filters to SHA-256 miners only
- **Mining Efficiency Chart**: Filters to SHA-256 miners only
- Both charts exclude SCRYPT miners as requested

### 5. Frontend - Dashboard.tsx
**File**: `frontend/src/pages/Dashboard.tsx`

#### 24h Average Hashrate Card
- Displays separate sections for SHA-256 and SCRYPT
- SHA-256: Shows in TH/s
- SCRYPT: Shows in GH/s (converted from TH/s)
- Only shows sections for active algorithm types

## Key Technical Decisions

1. **Storage Format**: All hashrates stored in TH/s in backend for consistency
2. **Display Format**: 
   - SHA-256: Display as TH/s (no conversion needed)
   - SCRYPT: Convert to GH/s for display (multiply by 1000)
3. **Efficiency Calculations**: Use SHA-256 miners only (SCRYPT has different power characteristics)
4. **Chart Filtering**: Performance and efficiency charts exclude SCRYPT miners
5. **Backward Compatibility**: Old history entries without algorithm-specific fields default to 0

## Testing Checklist

### Backend
- [ ] Verify separate hashrate calculations in logs
- [ ] Check that `totalHashrateSha256` and `totalHashrateScrypt` are calculated correctly
- [ ] Verify 24h averages are calculated separately
- [ ] Check active miner counts by algorithm

### Telegram Bot
- [ ] Send `/status` command and verify separate SHA-256/SCRYPT sections
- [ ] Verify hashrate units (TH/s for SHA-256, GH/s for SCRYPT)
- [ ] Check miners list shows combined hashrates correctly
- [ ] Verify only active algorithm types are displayed

### Frontend - Analytics Page
- [ ] Navigate to Analytics page
- [ ] Verify SHA-256 section shows: Avg, Peak, Min hashrates in TH/s
- [ ] Verify SCRYPT section shows: Avg, Peak, Min hashrates in GH/s
- [ ] Check Miner Performance Comparison chart shows only SHA-256 miners
- [ ] Check Mining Efficiency chart shows only SHA-256 miners
- [ ] Verify sections only appear for active algorithm types

### Frontend - Dashboard
- [ ] Navigate to Dashboard
- [ ] Check 24h Avg Hashrate card shows separate sections
- [ ] Verify SHA-256 displayed in TH/s
- [ ] Verify SCRYPT displayed in GH/s
- [ ] Confirm only active algorithm types are shown

## Deployment Steps

1. Build images using local build script
2. Push to registry
3. Pull on server (admin@192.168.1.66)
4. Restart services
5. Check logs for errors
6. Verify metrics are being calculated correctly
7. Test Telegram bot commands
8. Test frontend pages

## Verification Commands

```bash
# Check backend logs for hashrate calculations
docker compose -f docker-compose.prod.yml logs backend | grep -i "hashrate"

# Check for any errors
docker compose -f docker-compose.prod.yml logs backend | grep -i "error"

# Verify services are running
docker compose -f docker-compose.prod.yml ps

# Check API response
curl http://192.168.1.66:5000/api/mining/stats | jq '.totalHashrateSha256, .totalHashrateScrypt'
```

## Git Commits

1. `d107e3f` - feat: Separate SHA256 and SCRYPT hashrate calculations (backend)
2. `1e9c949` - feat: Display separate SHA256/SCRYPT hashrates in Telegram bot
3. `ca7a11a` - feat: Separate SHA256/SCRYPT hashrates in frontend

## Notes

- All changes maintain backward compatibility
- Old history data without algorithm fields will default to 0
- SCRYPT hashrates are stored in TH/s internally but displayed in GH/s
- Efficiency calculations intentionally exclude SCRYPT miners due to different power characteristics
- Performance comparison charts exclude SCRYPT to avoid mixing incompatible metrics
