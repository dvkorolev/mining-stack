# Algorithm Separation Guide

## Overview
The mining stack now properly separates SHA-256 and SCRYPT miners while allowing unified querying.

## Metrics Structure

### SHA-256 Miners (Bitcoin - Antminers, Whatsminers)
- **Hashrate**: `miner_hashrate_ths{algorithm="sha256"}` - in TH/s
- **Power**: `miner_power_watts{algorithm="sha256"}` - in Watts
- **Temperature**: `miner_temp_max_c{algorithm="sha256"}` - in Celsius
- **State**: `miner_state{algorithm="sha256"}` - 0=faulty, 1=idle, 2=mining

### SCRYPT Miners (Dogecoin - DG1+)
- **Hashrate**: `miner_hashrate_mhs{algorithm="scrypt"}` - in MH/s
- **Power**: `miner_power_watts{algorithm="scrypt"}` - in Watts
- **Temperature**: `miner_temp_max_c{algorithm="scrypt"}` - in Celsius
- **State**: `miner_state{algorithm="scrypt"}` - 0=faulty, 1=idle, 2=mining

## Querying Examples

### Backend API
```python
# Get all SHA-256 miners
sha256_miners = metrics.query('miner_hashrate_ths{algorithm="sha256"}')

# Get all SCRYPT miners
scrypt_miners = metrics.query('miner_hashrate_mhs{algorithm="scrypt"}')

# Get all miners (both algorithms) by power
all_power = metrics.query('miner_power_watts')

# Filter by algorithm
sha256_power = metrics.query('miner_power_watts{algorithm="sha256"}')
scrypt_power = metrics.query('miner_power_watts{algorithm="scrypt"}')
```

### Grafana Dashboards

#### Option 1: Separate Panels
```promql
# SHA-256 Panel
sum(miner_hashrate_ths{algorithm="sha256"})

# SCRYPT Panel
sum(miner_hashrate_mhs{algorithm="scrypt"}) / 1000  # Convert to GH/s for display
```

#### Option 2: Combined with Labels
```promql
# All miners power consumption
sum by (algorithm) (miner_power_watts)

# All miners temperature
avg by (algorithm) (miner_temp_max_c)
```

### Telegram Alerts

#### Separate by Algorithm
```promql
# SHA-256 hashrate drop
(sum(miner_hashrate_ths{algorithm="sha256"}) < 2000)

# SCRYPT hashrate drop  
(sum(miner_hashrate_mhs{algorithm="scrypt"}) < 10000)
```

#### Combined Alerts
```promql
# Any miner offline (works for both)
miner_state{algorithm=~"sha256|scrypt"} == 0

# High temperature (works for both)
miner_temp_max_c{algorithm=~"sha256|scrypt"} > 85
```

## Scale Differences

**Important**: SHA-256 and SCRYPT operate at different scales:

| Metric | SHA-256 (typical) | SCRYPT (typical) |
|--------|-------------------|------------------|
| Hashrate | 100-150 TH/s | 15,000-90,000 MH/s (15-90 GH/s) |
| Power | 3000-3500W | 3400W |
| Efficiency | 30-35 J/TH | N/A (different algorithm) |

**Recommendation**: Keep them in separate dashboards/panels to avoid confusion.

## Current Fleet

- **SHA-256**: 21 miners (18 Whatsminers + 3 Antminers)
- **SCRYPT**: 1 miner (1 DG1+)

## Implementation Notes

1. All common metrics (power, temp, state, uptime, etc.) have `algorithm` label
2. Hashrate metrics are separate:
   - `miner_hashrate_ths` for SHA-256 only
   - `miner_hashrate_mhs` for SCRYPT only
3. Algorithm is automatically detected from miner model
4. Backend can query by algorithm to show/hide SCRYPT miners
5. Grafana can create algorithm-specific dashboards
6. Telegram can filter alerts by algorithm
