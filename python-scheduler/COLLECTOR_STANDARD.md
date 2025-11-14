# Collector Standard Data Format

## Overview
All collectors (primary and fallback) must return data in a standardized format to ensure consistent processing.

## Standard Return Format

```python
{
    # === REQUIRED FIELDS ===
    'hashrate': float,          # TH/s (SHA-256) or GH/s (SCRYPT) - actual mining speed
    'temperature': float,       # Maximum temperature in Celsius
    'power': float,             # Power consumption in Watts
    'is_mining': bool,          # Whether miner is actively mining (True/False)
    
    # === OPTIONAL FIELDS (provide if available) ===
    'uptime': int,              # Uptime in seconds (0 if unavailable)
    'fans': list,               # List of fan objects: [{'speed': rpm}, ...]
    'hashboards': list,         # List of hashboard data (model-specific)
    'pools': list,              # Pool information
    'errors': list,             # Error messages/codes
    'fan_psu': list,            # PSU fan data
    'efficiency': float,        # Power efficiency in W/TH (0 if unknown)
    'fault_light': bool,        # Fault light status (False if unknown)
}
```

## Field Specifications

### hashrate
- **Type**: `float`
- **Unit**: TH/s for SHA-256 miners, GH/s for SCRYPT miners
- **Required**: Yes
- **Default**: `0.0` (if collection fails)
- **Notes**: Must be converted to correct unit before returning

### temperature
- **Type**: `float`
- **Unit**: Celsius
- **Required**: Yes
- **Default**: `0.0` (if unavailable)
- **Notes**: Should be maximum temperature across all sensors/boards
- **⚠️ NOT**: `temp_max`, `temp`, or other variations

### power
- **Type**: `float`
- **Unit**: Watts
- **Required**: Yes
- **Default**: `0` (if unavailable)
- **Notes**: Total power consumption

### is_mining
- **Type**: `bool`
- **Required**: Yes
- **Default**: `True` (if hashrate > 0), `False` (if hashrate == 0)
- **Notes**: Indicates if miner is intentionally mining or idle
- **Critical**: Used for state calculation (idle vs faulty)

### uptime
- **Type**: `int`
- **Unit**: Seconds
- **Required**: No
- **Default**: `0`

### fans
- **Type**: `list` of `dict`
- **Format**: `[{'speed': rpm_value}, ...]`
- **Required**: No
- **Default**: `[]`
- **Notes**: Each fan should have at least 'speed' field in RPM

### pools
- **Type**: `list` of `dict`
- **Format**: Various (model-dependent)
- **Required**: No
- **Default**: `[]`

### errors
- **Type**: `list`
- **Required**: No
- **Default**: `[]`

### efficiency
- **Type**: `float`
- **Unit**: W/TH
- **Required**: No
- **Default**: `0`

### fault_light
- **Type**: `bool`
- **Required**: No
- **Default**: `False`

## Collector-Specific Notes

### PyASIC Collector (Primary)
- Returns comprehensive data in standard format
- Uses `_update_metrics()` to set Prometheus metrics
- Handles both SHA-256 and SCRYPT miners

### Antminer CGI (Fallback)
- ✅ Returns `temperature` (correct)
- ⚠️ Cannot get power or uptime from CGI
- Sets power=0, uptime=0

### Whatsminer CGI (Fallback)
- ❌ Currently returns `temp_max` instead of `temperature` (WRONG)
- ❌ Returns `fan_speed` (int) instead of `fans` (list) (WRONG)
- Needs standardization

### Whatsminer CGMiner (Fallback)
- Should return standard format
- Check implementation

### DG1 Collectors (Fallback)
- Check both TCP and HTTP implementations
- Ensure standard format

## State Calculation Logic

State is calculated from return data:
```python
hashrate = data.get('hashrate', 0)
is_mining = data.get('is_mining', True)

if hashrate > 0:
    state = 2  # Mining
elif hashrate == 0 and not is_mining:
    state = 1  # Idle (intentionally not mining)
else:  # hashrate == 0 and is_mining == True
    state = 0  # Faulty (should be mining but isn't)
```

## Processing in main.py

```python
# Extract with fallback field names (temporary until all collectors fixed)
miner_data['temp_max'] = _safe_float(
    fallback_data.get('temperature')  # Standard field (preferred)
    or fallback_data.get('temp_max')   # Legacy field (deprecated)
    or 0
)
```

## Migration Plan

1. ✅ **Antminer CGI**: Already uses standard `temperature`
2. ❌ **Whatsminer CGI**: Fix to use `temperature` instead of `temp_max`
3. ❌ **Whatsminer CGI**: Fix to use `fans` list instead of `fan_speed` int
4. ⚠️ **Whatsminer CGMiner**: Verify format
5. ⚠️ **DG1 HTTP**: Verify format
6. ⚠️ **DG1 TCP**: Verify format
7. ✅ **main.py**: Update to prefer standard field names

## Testing Checklist

After standardization, verify:
- [ ] All collectors return `temperature` (not `temp_max`)
- [ ] All collectors return `is_mining` boolean
- [ ] All collectors return `fans` as list (not `fan_speed` int)
- [ ] State calculation works correctly from all collectors
- [ ] Prometheus metrics set correctly from all collectors
- [ ] Algorithm detection works with all collectors
