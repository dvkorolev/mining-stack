# ASIC Profile Library Integration

## Overview

The python-scheduler now uses the **ASIC Profile Library** system for intelligent, data-driven miner management. This replaces hard-coded model detection logic with a flexible, declarative configuration system.

## What Changed

### Before (Hard-coded Logic)
```python
# Hard-coded model detection
if 'antminer' in model_lower or 's19' in model_lower:
    # Use Antminer CGI fallback
    fallback_data = await collect_antminer_cgi(miner)
elif 'dg1' in model_lower:
    # Use DG1 TCP fallback
    fallback_data = await collect_dg1_tcp(miner)
```

### After (Profile-based)
```python
# Profile-based driver selection
profile = profile_library.get_profile(miner['model'])
if profile:
    # Use profile-defined drivers in priority order
    for driver in profile.get_ordered_drivers():
        if driver.get('type') == 'antminer_cgi':
            fallback_data = await collect_antminer_cgi(miner)
```

## Key Benefits

### 1. **Zero Code Changes for New Miners**
Add support for a new miner model by simply editing `asic_profiles.yaml`:
```yaml
profiles:
  new_miner_model:
    name: "New Miner X1000"
    manufacturer: "NewCorp"
    algorithm: "sha256"
    match:
      exact:
        - "NewMiner X1000"
      patterns:
        - "^NewMiner X"
    drivers:
      - type: "pyasic"
        priority: 1
      - type: "cgminer"
        priority: 2
```

### 2. **Intelligent Unit Detection**
The parser now uses profile quirks to correctly interpret hashrate units:
```yaml
parser:
  quirks:
    hashrate_field: "MHS av"
    hashrate_unit: "TH/s"  # Actual unit despite field name
    hashrate_scale: 1.0
```

### 3. **Graceful Fallback**
If no profile is found, the system automatically falls back to legacy hard-coded logic, ensuring backward compatibility.

## Architecture

### Components Modified

1. **`pyasic_collector.py`**
   - `_is_scrypt_miner()`: Now queries profile library for algorithm
   - `_check_data_gaps()`: Uses profile manufacturer info
   - Gap-filling: Passes profile to parser

2. **`cgminer_parser.py`**
   - `_detect_actual_units()`: Uses profile quirks for unit detection
   - `parse_cgminer_response()`: Accepts optional profile parameter

3. **`main.py`**
   - Fallback logic: Uses profile-defined driver priorities
   - Startup: Loads and logs profile library statistics
   - New endpoint: `/profiles` for profile inspection
   - Reload: Now also reloads profile library

### Profile Library Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Miner Configuration                       │
│                   (miners.yaml)                              │
│  - IP: 192.168.1.100                                        │
│  - Model: "Whatsminer M50S++"                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              ASIC Profile Library                            │
│           (asic_profiles.yaml)                               │
│                                                              │
│  Matches "Whatsminer M50S++" to profile:                    │
│  - Algorithm: sha256                                         │
│  - Drivers: [pyasic, cgminer]                               │
│  - Parser quirks: hashrate_unit=TH/s                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                Collection Process                            │
│                                                              │
│  1. Try pyasic (priority 1)                                 │
│     └─> If fails, try cgminer (priority 2)                  │
│                                                              │
│  2. Parse with profile quirks                               │
│     └─> Correctly interpret "MHS av" as TH/s               │
│                                                              │
│  3. Validate against expected ranges                        │
│     └─> hashrate_min: 100 TH/s                             │
│     └─> hashrate_max: 160 TH/s                             │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### View Loaded Profiles
```bash
curl http://localhost:8000/profiles
```

Response:
```json
{
  "stats": {
    "total_profiles": 6,
    "exact_matches": 15,
    "pattern_matches": 12,
    "algorithms": {
      "sha256": 4,
      "scrypt": 2
    },
    "manufacturers": ["MicroBT", "Bitmain", "ElphaPex"]
  },
  "profiles": [
    {
      "id": "whatsminer_m50s",
      "name": "Whatsminer M50S Series",
      "manufacturer": "MicroBT",
      "algorithm": "sha256",
      "drivers": ["pyasic", "cgminer"]
    },
    ...
  ]
}
```

### Reload Profiles at Runtime
```bash
curl -X POST http://localhost:8000/reload
```

This reloads both miner configuration and profile library without restarting the service.

## Adding a New Miner Profile

### Example: Adding Antminer S21 Support

1. Edit `asic_profiles.yaml`:
```yaml
profiles:
  antminer_s21:
    name: "Antminer S21 Series"
    manufacturer: "Bitmain"
    algorithm: "sha256"
    
    match:
      exact:
        - "Antminer S21"
        - "Antminer S21 Pro"
      patterns:
        - "^Antminer S21"
    
    drivers:
      - type: "pyasic"
        priority: 1
        config:
          api_port: 4028
          timeout: 10
      - type: "cgminer"
        priority: 2
      - type: "antminer_cgi"
        priority: 3
    
    parser:
      type: "antminer"
      quirks:
        hashrate_field: "MHS av"
        hashrate_unit: "TH/s"
        hashrate_scale: 1.0
        temp_source: "chip"
        power_field: "Power"
    
    credentials:
      username: "root"
      password: "root"
    
    expected:
      hashrate_min: 180
      hashrate_max: 220
      power_min: 3200
      power_max: 3800
      temp_max: 90
```

2. Reload the service:
```bash
curl -X POST http://localhost:8000/reload
```

3. Done! The S21 is now fully supported.

## Logging

The integration adds detailed logging:

### Startup
```
ASIC Profile Library loaded: 6 profiles
  - SHA-256 miners: 4
  - SCRYPT miners: 2
  - Manufacturers: MicroBT, Bitmain, ElphaPex
```

### Collection
```
Profile 'whatsminer_m50s' has 2 drivers for Miner-01
  Trying Antminer CGI fallback for Miner-02 (192.168.1.102) [profile: antminer_s19]
  ✓ Fallback success for Miner-02: antminer_cgi
```

### Parser
```
Detected hashrate unit: TH/s (profile: whatsminer_m50s)
```

## Backward Compatibility

The integration maintains full backward compatibility:

1. **No profile found**: Falls back to legacy hard-coded logic
2. **Profile load fails**: Service continues with legacy logic
3. **Existing configurations**: Work without modification

## Performance Impact

- **Minimal overhead**: Profile lookup is O(1) for exact matches, O(n) for patterns
- **Cached**: Profile library is loaded once at startup
- **Hot-reload**: Can reload profiles without restarting service

## Future Enhancements

The profile system enables future features:

1. **Anomaly Detection**: Use `expected` ranges to detect underperforming miners
2. **Auto-tuning**: Adjust collection timeouts based on miner type
3. **Firmware-specific Quirks**: Handle different firmware versions
4. **Community Profiles**: Share profiles for new miner models
5. **Profile Validation**: Automated testing of profile configurations

## Migration Guide

### For Existing Deployments

No action required! The integration is fully backward compatible.

### For New Deployments

1. Review `asic_profiles.yaml` for supported miners
2. Add profiles for any custom/new miners
3. Use `/profiles` endpoint to verify configuration

## Troubleshooting

### Profile Not Matching
Check logs for:
```
No profile found for model 'YourMiner X100', using legacy fallback logic
```

**Solution**: Add a profile with matching rules in `asic_profiles.yaml`

### Wrong Hashrate Units
Check profile quirks:
```yaml
parser:
  quirks:
    hashrate_unit: "TH/s"  # or "GH/s" for SCRYPT
    hashrate_scale: 1.0    # or 0.001 for GH/s to TH/s
```

### Profile Load Error
Check logs at startup:
```
Failed to load ASIC Profile Library: [error details]
Will use legacy hard-coded logic as fallback
```

**Solution**: Validate YAML syntax in `asic_profiles.yaml`

## Summary

The ASIC Profile Library integration transforms the python-scheduler from a hard-coded system into a flexible, data-driven platform. Adding support for new miners is now as simple as editing a YAML file, and the system gracefully handles edge cases with intelligent fallbacks.
