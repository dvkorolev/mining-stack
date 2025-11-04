# Hashrate Unit Sanity Check

## The Problem: Misleading Field Names

CGMiner API field names are **unreliable** and **misleading**. You cannot trust them to indicate the actual units of the hashrate values.

### Real-World Examples

| Miner | Model | Field Name | Actual Value | Actual Units |
|-------|-------|------------|--------------|--------------|
| Whatsminer | M50S++ | `MHS av` | 130.5 | **TH/s** (not MH/s!) |
| Whatsminer | M30S++ | `MHS av` | 112.0 | **TH/s** (not MH/s!) |
| ElphaPex | DG1 | `MHS av` | 14.2 | **GH/s** (not MH/s!) |
| Antminer | S19 Pro | `MHS av` | 110.0 | **TH/s** (not MH/s!) |
| Antminer | L7 | `MHS av` | 9.5 | **GH/s** (not MH/s!) |

**The field says "MHS" but the values are in TH/s or GH/s!**

---

## The Solution: Model-Based Detection

We cannot trust field names. Instead, we use the **miner model** to determine the actual units.

### Implementation

**File**: `parsers/cgminer_parser.py`

```python
def _detect_actual_units(model: str, raw_value: float, field_name: str) -> tuple[float, str]:
    """
    Sanity check: Detect actual hashrate units based on miner model.
    
    Returns:
        (hashrate_in_ths, detected_unit)
    """
    model_lower = model.lower()
    
    # Known TH/s scale miners (SHA-256 ASICs)
    ths_miners = [
        r'm\d+s',      # M20S, M30S, M30S+, M30S++, M50S++
        r'm\d+',       # M20, M30, M50, M60
        r's19',        # S19, S19 Pro, S19j Pro, S19 XP
        r's17',        # S17, S17 Pro
        r't19',        # T19
    ]
    
    # Known GH/s scale miners (SCRYPT ASICs)
    ghs_miners = [
        r'dg1',        # ElphaPex DG1
        r'l7',         # Antminer L7
        r'l3',         # Antminer L3+
    ]
    
    # Check model against patterns
    for pattern in ths_miners:
        if re.search(pattern, model_lower):
            return (raw_value, 'TH/s')  # Value is already in TH/s
    
    for pattern in ghs_miners:
        if re.search(pattern, model_lower):
            return (raw_value / 1000.0, 'GH/s')  # Convert GH/s to TH/s
    
    # Fallback heuristic for unknown miners
    if raw_value < 1000:
        return (raw_value, 'TH/s (assumed)')
    else:
        return (raw_value / 1000000.0, 'MH/s')
```

---

## How It Works

### Step 1: Extract Model
```python
model = "M50S++"  # From miner config
```

### Step 2: Call Parser with Model
```python
cgminer_data = parse_cgminer_response(stats, summary, pools, devs, model)
```

### Step 3: Sanity Check Applied
```python
# API returns: {"MHS av": 130.5}
raw_value = 130.5
field_name = "MHS av"

# Model "M50S++" matches pattern r'm\d+s'
# Detected: TH/s scale miner
# Result: (130.5, 'TH/s')  # Value unchanged, correct units detected
```

### Step 4: Correct Hashrate
```python
result['hashrate'] = 130.5  # TH/s (correct!)
result['hashrate_unit'] = 'TH/s'  # For debugging
```

---

## Detection Logic

### 1. TH/s Scale Miners (SHA-256)

**Pattern Matching**:
- `m\d+s` → M20S, M30S, M30S+, M30S++, M50S++
- `m\d+` → M20, M30, M50, M60
- `s19` → S19, S19 Pro, S19j Pro, S19 XP
- `s17` → S17, S17 Pro
- `t19` → T19

**Action**: Value is already in TH/s, use as-is

**Example**:
```python
Model: "M50S++"
API: {"MHS av": 130.5}
Result: 130.5 TH/s ✅
```

### 2. GH/s Scale Miners (SCRYPT)

**Pattern Matching**:
- `dg1` → ElphaPex DG1
- `l7` → Antminer L7
- `l3` → Antminer L3+

**Action**: Value is in GH/s, divide by 1000 to convert to TH/s

**Example**:
```python
Model: "DG1"
API: {"MHS av": 14.2}
Result: 0.0142 TH/s (14.2 GH/s) ✅
```

### 3. Unknown Miners (Heuristic)

**If value < 1000**:
- Assume TH/s (modern ASIC)
- Use value as-is

**If value >= 1000**:
- Assume actual MH/s (old hardware/GPU)
- Divide by 1,000,000 to convert to TH/s

---

## Before vs After

### Before (Broken)

```python
# Whatsminer M50S++
API: {"MHS av": 130.5}
Code: hashrate = 130.5 / 1000000.0  # Assumed MH/s
Result: 0.0001305 TH/s ❌ WRONG!
Display: "0.000131 TH/s" (should be 130.5 TH/s)
```

```python
# DG1 SCRYPT
API: {"MHS av": 14.2}
Code: hashrate = 14.2 if is_scrypt else (14.2 / 1000000.0)
Result: 14.2 TH/s ❌ WRONG! (should be 0.0142 TH/s)
Display: "14.2 TH/s" (should be 14.2 GH/s = 0.0142 TH/s)
```

### After (Fixed)

```python
# Whatsminer M50S++
API: {"MHS av": 130.5}
Model: "M50S++"
Detected: TH/s scale miner
Result: 130.5 TH/s ✅ CORRECT!
Display: "130.5 TH/s"
```

```python
# DG1 SCRYPT
API: {"MHS av": 14.2}
Model: "DG1"
Detected: GH/s scale miner
Result: 0.0142 TH/s (14.2 GH/s) ✅ CORRECT!
Display: "14.2 GH/s" or "0.0142 TH/s"
```

---

## Why Field Names Are Misleading

### Historical Context

1. **Old CGMiner**: Used for GPU mining, reported actual MH/s
2. **ASIC Era**: Manufacturers kept CGMiner API for compatibility
3. **Field Names Frozen**: "MHS av" field name never updated
4. **Values Changed**: Now contains TH/s or GH/s, not MH/s

### Manufacturer Quirks

| Manufacturer | Behavior |
|--------------|----------|
| **Whatsminer** | Reports TH/s in "MHS av" field |
| **Bitmain Antminer** | Reports TH/s in "MHS av" field (modern models) |
| **ElphaPex** | Reports GH/s in "MHS av" field (SCRYPT) |
| **Old Hardware** | Actually reports MH/s in "MHS av" field |

---

## Testing

### Test Cases

```python
# Test 1: Whatsminer M50S++
assert _detect_actual_units("M50S++", 130.5, "MHS av") == (130.5, 'TH/s')

# Test 2: Whatsminer M30S+
assert _detect_actual_units("M30S+", 112.0, "MHS av") == (112.0, 'TH/s')

# Test 3: Antminer S19 Pro
assert _detect_actual_units("S19 Pro", 110.0, "MHS av") == (110.0, 'TH/s')

# Test 4: ElphaPex DG1
assert _detect_actual_units("DG1", 14.2, "MHS av") == (0.0142, 'GH/s')

# Test 5: Antminer L7
assert _detect_actual_units("L7", 9.5, "MHS av") == (0.0095, 'GH/s')

# Test 6: Unknown miner (heuristic)
assert _detect_actual_units("Unknown", 50.0, "MHS av") == (50.0, 'TH/s (assumed)')
assert _detect_actual_units("Unknown", 5000.0, "MHS av") == (0.005, 'MH/s')
```

### Verify in Production

```bash
# Check logs for detected units
docker logs python-scheduler 2>&1 | grep "hashrate_unit"

# Should see:
# M50S++: hashrate_unit='TH/s'
# DG1: hashrate_unit='GH/s'
# S19: hashrate_unit='TH/s'
```

---

## Adding New Miners

To add support for a new miner model:

### 1. Determine Actual Units

Check the miner's specifications:
- **SHA-256 ASIC** (Bitcoin): Usually TH/s scale
- **SCRYPT ASIC** (Litecoin): Usually GH/s scale
- **Ethash GPU** (Ethereum): Usually MH/s scale

### 2. Add Pattern

**For TH/s miners**:
```python
ths_miners = [
    # ... existing patterns ...
    r'new_model_pattern',  # Add your pattern
]
```

**For GH/s miners**:
```python
ghs_miners = [
    # ... existing patterns ...
    r'new_model_pattern',  # Add your pattern
]
```

### 3. Test

```python
result = _detect_actual_units("NewModel", test_value, "MHS av")
assert result[0] == expected_ths
assert result[1] == expected_unit
```

---

## Debugging

### Enable Debug Logging

The parser now includes `hashrate_unit` in the result:

```python
result = {
    'hashrate': 130.5,
    'hashrate_unit': 'TH/s',  # Shows detected unit
    # ... other fields ...
}
```

### Check Prometheus Metrics

```bash
# Query Prometheus
curl http://localhost:9090/api/v1/query?query=miner_hashrate

# Should show correct values:
# miner_hashrate{name="EN-M50SppVL30-126"} 130.5
# miner_hashrate{name="EN-DG1p-078"} 0.0142
```

---

## Summary

✅ **Model-based detection** - Don't trust field names  
✅ **Pattern matching** - Regex patterns for known miners  
✅ **Fallback heuristic** - Handle unknown miners  
✅ **Correct units** - TH/s for display consistency  
✅ **Debugging info** - `hashrate_unit` field for verification  

This fixes the misleading "MHS av" field name issue and ensures all miners report correct hashrate values! 🎉
