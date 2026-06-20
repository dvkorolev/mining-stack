# SCRYPT Miners Dashboard

## Overview
Dedicated Grafana dashboard for monitoring SCRYPT algorithm miners (Litecoin, Dogecoin, etc.) with hashrate-focused views and efficiency metrics.

## Dashboard URL
`http://192.168.1.66:3000/d/scrypt-miners`

## Features

### 📊 Key Metrics (Top Row)
1. **Total SCRYPT Hashrate (GH/s)** - Aggregate hashrate across all SCRYPT miners
2. **Active SCRYPT Miners** - Count of online miners
3. **Average Power** - Power consumption across SCRYPT fleet
4. **Efficiency (MH/W)** - Overall mining efficiency metric

### 📈 Time Series Charts
1. **SCRYPT Hashrate Over Time (GH/s)**
   - Individual miner hashrate trends
   - Legend with last/mean/max/min values
   - 6-hour default view, 30s refresh

2. **Power Consumption (W)**
   - Power usage per miner over time
   - Helps identify power anomalies

3. **Temperature (°C)**
   - Temperature monitoring per miner
   - Color-coded thresholds (blue < 60 < green < 75 < yellow < 85 < red)

### 📋 Detailed Stats Table
Comprehensive table showing:
- **Miner Name & IP**
- **Model**
- **Hashrate (GH/s)** - Gradient gauge visualization
- **Power (W)** - Color-coded by consumption
- **Temperature (°C)** - Color-coded by heat level
- **Status** - Online/Error/Offline with color coding
- **Uptime (days)**
- **Efficiency (MH/W)** - Gradient gauge visualization

Sortable by any column, default sorted by hashrate (descending).

### 📊 Bar Gauges
1. **Hashrate by Miner** - Horizontal bar chart comparing hashrates
2. **Efficiency by Miner** - Horizontal bar chart comparing efficiency

## Metrics Used

### Primary Metrics:
- `miner_hashrate_mhs{algorithm="scrypt"}` - Hashrate in MH/s
- `miner_power_watts{algorithm="scrypt"}` - Power consumption
- `miner_temp_celsius{algorithm="scrypt"}` - Temperature
- `miner_state{algorithm="scrypt"}` - Miner status (0=offline, 1=error, 2=online)
- `miner_uptime_seconds{algorithm="scrypt"}` - Uptime

### Calculated Metrics:
- **GH/s**: `miner_hashrate_mhs / 1000`
- **Efficiency**: `miner_hashrate_mhs / miner_power_watts`
- **Uptime (days)**: `miner_uptime_seconds / 86400`

## Thresholds

### Hashrate (GH/s):
- 🔴 Red: < 15 GH/s (low)
- 🟡 Yellow: 15-20 GH/s (moderate)
- 🟢 Green: 20-30 GH/s (good)
- 🔵 Blue: > 30 GH/s (excellent)

### Power (W):
- 🟢 Green: < 3500W (normal)
- 🟡 Yellow: 3500-4000W (high)
- 🔴 Red: > 4000W (critical)

### Temperature (°C):
- 🔵 Blue: < 60°C (cool)
- 🟢 Green: 60-75°C (normal)
- 🟡 Yellow: 75-85°C (warm)
- 🔴 Red: > 85°C (hot)

### Efficiency (MH/W):
- 🔴 Red: < 5 MH/W (poor)
- 🟡 Yellow: 5-7 MH/W (moderate)
- 🟢 Green: 7-9 MH/W (good)
- 🔵 Blue: > 9 MH/W (excellent)

## Navigation

### Access Points:
1. **From Main Overview**: Click "SCRYPT Miners Dashboard" link in top navigation
2. **Direct URL**: `http://192.168.1.66:3000/d/scrypt-miners`
3. **From Dashboard List**: Search for "SCRYPT" in Grafana

### Return to Overview:
Click "Back to Overview" link in top navigation

## Current Fleet
- **DG1+ (192.168.1.78)**: ~25-90 GH/s, 3400W
- Designed to scale with additional SCRYPT miners

## Use Cases

### 1. Performance Monitoring
- Track individual miner hashrates
- Compare performance across fleet
- Identify underperforming miners

### 2. Efficiency Analysis
- Monitor MH/W efficiency
- Optimize power consumption
- Calculate profitability metrics

### 3. Health Monitoring
- Temperature tracking
- Power anomaly detection
- Uptime monitoring

### 4. Capacity Planning
- Track total fleet hashrate
- Plan for additional miners
- Analyze power requirements

## Technical Notes

### Unit Conversions:
- **Storage**: Prometheus stores SCRYPT hashrate as MH/s
- **Display**: Dashboard shows GH/s (÷ 1000) for readability
- **Efficiency**: Calculated as MH/W (no conversion needed)

### Refresh Rate:
- Dashboard: 30 seconds
- Prometheus scrape: 30 seconds
- Effective latency: ~30-60 seconds

### Data Retention:
- Default view: Last 6 hours
- Available history: Based on Prometheus retention (typically 15 days)

## Comparison with SHA-256

| Metric | SHA-256 | SCRYPT |
|--------|---------|--------|
| Hashrate Unit | TH/s | GH/s (MH/s in Prometheus) |
| Typical Range | 100-120 TH/s | 20-90 GH/s |
| Power | 3000-3500W | 3000-4000W |
| Efficiency | N/A | 5-10 MH/W |
| Algorithm | Bitcoin | Litecoin, Dogecoin |

## Future Enhancements
- [ ] Pool statistics integration
- [ ] Profitability calculator (LTC/DOGE price feeds)
- [ ] Historical efficiency trends
- [ ] Predictive maintenance alerts
- [ ] Multi-pool comparison
- [ ] Coin-specific views (LTC vs DOGE)

## Related Documentation
- `ALGORITHM_SEPARATION.md` - Algorithm separation overview
- `COMPLETE_ALGORITHM_SEPARATION.md` - Full implementation details
- `SCRYPT_TELEGRAM_FIX.md` - Telegram bot SCRYPT support
