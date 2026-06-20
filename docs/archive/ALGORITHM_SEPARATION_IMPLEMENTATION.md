# Algorithm Separation Implementation Summary

## Changes Made

### 1. Metrics (Python Scheduler)
✅ Added `algorithm` label to all common metrics:
- `miner_hashrate_ths{algorithm="sha256"}` - SHA-256 only
- `miner_hashrate_mhs{algorithm="scrypt"}` - SCRYPT only  
- `miner_power_watts{algorithm="sha256|scrypt"}`
- `miner_temp_max_c{algorithm="sha256|scrypt"}`
- `miner_is_mining{algorithm="sha256|scrypt"}`
- `miner_uptime{algorithm="sha256|scrypt"}`
- `miner_efficiency_j_th{algorithm="sha256|scrypt"}`
- `miner_state{algorithm="sha256|scrypt"}`
- `miner_scrape_status{algorithm="sha256|scrypt"}`

### 2. Grafana Dashboards
✅ Updated `mining-overview.json`:
- **Total Hashrate (SHA-256)** panel - shows SHA-256 miners in TH/s
- **Total Hashrate (SCRYPT)** panel - shows SCRYPT miners in MH/s
- **Farm Hashrate Over Time (SHA-256)** - time series for SHA-256
- **Miner Status Table** - shows both algorithms with separate queries

### 3. Prometheus Alerts
✅ Updated `mining_alerts.yml`:

**Miner-Level Alerts (Split by Algorithm):**
- `MinerHashrateCriticalSHA256` - SHA-256 hashrate < 50% expected
- `MinerHashrateCriticalSCRYPT` - SCRYPT hashrate < 10,000 MH/s
- `MinerHashrateWarningSHA256` - SHA-256 hashrate < 80% expected
- `MinerHashrateWarningSCRYPT` - SCRYPT hashrate < 20,000 MH/s

**Farm-Level Alerts (Split by Algorithm):**
- `FarmHashrateDropSHA256` - Total SHA-256 < 1500 TH/s
- `FarmHashrateDropSCRYPT` - Total SCRYPT < 10,000 MH/s

**Common Alerts (Work for Both):**
- `MinerOffline` - Any miner offline
- `MinerHighTemperature` - Any miner > 85°C
- `MinerNotMining` - Any miner stopped
- `MinerRejectionRate*` - Works for all miners
- `MinerFaultLight`, `MinerErrors`, etc.

### 4. Telegram Integration
✅ Alerts now include `algorithm` label:
- Telegram will show algorithm in alert messages
- Can filter alerts by algorithm in Alertmanager
- Separate notification routes possible (if needed)

## Usage Examples

### Backend Queries
```python
# Get all SHA-256 miners
sha256_miners = query('miner_power_watts{algorithm="sha256"}')

# Get all SCRYPT miners
scrypt_miners = query('miner_power_watts{algorithm="scrypt"}')

# Get all miners (both algorithms)
all_miners = query('miner_power_watts')
```

### Grafana Queries
```promql
# Total SHA-256 hashrate
sum(miner_hashrate_ths{algorithm="sha256"})

# Total SCRYPT hashrate (in GH/s)
sum(miner_hashrate_mhs{algorithm="scrypt"}) / 1000

# Power by algorithm
sum by (algorithm) (miner_power_watts)

# Temperature comparison
avg by (algorithm) (miner_temp_max_c)
```

### Telegram Alert Filtering
In `alertmanager.yml`, you can route by algorithm:
```yaml
routes:
  - match:
      algorithm: sha256
    receiver: telegram-sha256
  - match:
      algorithm: scrypt
    receiver: telegram-scrypt
  - receiver: telegram-all  # Default for common alerts
```

## Current Fleet Status
- **SHA-256**: 21 miners (18 Whatsminers + 3 Antminers)
  - Hashrate: ~2100 TH/s total
  - Power: ~70 kW total
- **SCRYPT**: 1 miner (1 DG1+)
  - Hashrate: ~40,000-90,000 MH/s (40-90 GH/s)
  - Power: ~3.4 kW

## Benefits
1. ✅ Backend can see DG1+ metrics properly
2. ✅ Grafana shows both algorithms clearly separated
3. ✅ Telegram alerts include algorithm context
4. ✅ No confusion between TH/s and MH/s
5. ✅ Can filter/group by algorithm in all tools
6. ✅ Future-proof for adding more SCRYPT miners

## Next Steps (Optional)
- [ ] Create separate Grafana dashboard for SCRYPT miners
- [ ] Set up algorithm-specific Telegram channels
- [ ] Add SCRYPT efficiency metrics (if applicable)
- [ ] Configure algorithm-specific alert thresholds per miner
