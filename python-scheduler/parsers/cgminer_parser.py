"""
CGMiner API response parser with model-based unit sanity checking.
"""

from typing import Dict, Optional, List
import re


def _detect_actual_units(model: str, raw_value: float, field_name: str) -> tuple[float, str]:
    """
    Sanity check: Detect actual hashrate units based on miner model.
    
    The field names in CGMiner API are often misleading:
    - Whatsminer M-series reports TH/s in "MHS av" field
    - DG1 SCRYPT reports GH/s in "MHS av" field
    - Antminer reports actual MH/s in "MHS av" field
    
    Args:
        model: Miner model string (e.g., "M50S++", "DG1", "S19")
        raw_value: Raw value from API
        field_name: Field name (e.g., "MHS av", "GHS av")
    
    Returns:
        (hashrate_in_ths, detected_unit)
    """
    model_lower = model.lower()
    
    # Known TH/s scale miners (SHA-256 ASICs)
    # These report TH/s values in "MHS av" field despite the misleading name
    ths_miners = [
        # Whatsminer M-series
        r'm\d+s',      # M20S, M30S, M30S+, M30S++
        r'm\d+',       # M20, M30, M50, M60
        # Antminer S-series (modern)
        r's19',        # S19, S19 Pro, S19j Pro, S19 XP
        r's17',        # S17, S17 Pro
        r's15',        # S15
        # Antminer T-series (modern)
        r't19',        # T19
        r't17',        # T17
    ]
    
    # Known GH/s scale miners (SCRYPT ASICs)
    # These report GH/s values in "MHS av" field
    ghs_miners = [
        r'dg1',        # ElphaPex DG1
        r'l7',         # Antminer L7
        r'l3',         # Antminer L3+
    ]
    
    # Check if it's a TH/s scale miner
    for pattern in ths_miners:
        if re.search(pattern, model_lower):
            # Value is already in TH/s, despite field name saying "MHS"
            return (raw_value, 'TH/s')
    
    # Check if it's a GH/s scale miner (SCRYPT)
    for pattern in ghs_miners:
        if re.search(pattern, model_lower):
            # Value is in GH/s, convert to TH/s
            return (raw_value / 1000.0, 'GH/s')
    
    # Unknown miner - use field name as hint
    if field_name == 'GHS av':
        # Field says GH/s, trust it
        return (raw_value / 1000.0, 'GH/s')
    elif field_name == 'MHS av':
        # Field says MH/s - could be misleading
        # Apply heuristic: if value is < 1000, likely TH/s
        # if value is > 1000, likely actual MH/s
        if raw_value < 1000:
            # Likely TH/s (modern ASIC)
            return (raw_value, 'TH/s (assumed)')
        else:
            # Likely actual MH/s (old hardware or GPU)
            return (raw_value / 1000000.0, 'MH/s')
    
    # Default: assume MH/s
    return (raw_value / 1000000.0, 'MH/s (default)')


def parse_cgminer_response(stats: Optional[Dict], summary: Optional[Dict], pools: Optional[Dict], devs: Optional[Dict], model: str = '') -> Dict:
    """Parse cgminer response into unified format"""
    result = {
        'hashrate': 0,
        'power': 0,
        'temperature': 0,
        'pools': [],
        'board_temps': [],  # Per-board temperatures from DEVS
    }
    
    # Parse DEVS for per-board temperatures (Whatsminer: DEVS[*].Temperature)
    # This is more reliable than chip temps which can be 0 on some firmwares
    if devs and 'DEVS' in devs:
        board_temps = []
        for dev in devs['DEVS']:
            # Whatsminer uses 'Temperature' field
            if 'Temperature' in dev and dev['Temperature']:
                temp = float(dev['Temperature'])
                if temp > 0:
                    board_temps.append(temp)
        
        if board_temps:
            result['board_temps'] = board_temps
            result['temperature'] = max(board_temps)
    
    # Fallback: Parse stats for temperature (chip temps - less reliable)
    if result['temperature'] == 0 and stats and 'STATS' in stats and len(stats['STATS']) > 1:
        stat_data = stats['STATS'][1]
        
        # Temperature from chip temp fields
        temps = []
        for i in range(1, 20):
            for temp_key in [f'temp{i}', f'temp2_{i}', f'temp_chip{i}']:
                if temp_key in stat_data and stat_data[temp_key]:
                    temp = float(stat_data[temp_key])
                    if temp > 0:
                        temps.append(temp)
        
        if temps:
            result['temperature'] = max(temps)
    
    # Final fallback: SUMMARY.Temperature (Whatsminer aggregate)
    if result['temperature'] == 0 and summary:
        summary_data = None
        if 'SUMMARY' in summary and len(summary['SUMMARY']) > 0:
            summary_data = summary['SUMMARY'][0]
        
        if summary_data and 'Temperature' in summary_data:
            temp = float(summary_data['Temperature'])
            if temp > 0:
                result['temperature'] = temp
    
    # Parse summary for power and hashrate
    if summary:
        summary_data = None
        if 'SUMMARY' in summary and len(summary['SUMMARY']) > 0:
            summary_data = summary['SUMMARY'][0]
        elif 'Msg' in summary and isinstance(summary['Msg'], dict):
            summary_data = summary['Msg']
        
        if summary_data:
            # Power (Whatsminer specific)
            if 'Power' in summary_data:
                result['power'] = float(summary_data['Power'])
            
            # Hashrate with model-based sanity check
            if 'MHS av' in summary_data:
                raw_value = float(summary_data['MHS av'])
                hashrate_ths, detected_unit = _detect_actual_units(model, raw_value, 'MHS av')
                result['hashrate'] = hashrate_ths
                result['hashrate_unit'] = detected_unit  # For debugging
            elif 'GHS av' in summary_data:
                raw_value = float(summary_data['GHS av'])
                hashrate_ths, detected_unit = _detect_actual_units(model, raw_value, 'GHS av')
                result['hashrate'] = hashrate_ths
                result['hashrate_unit'] = detected_unit
    
    # Parse pools for rejected shares
    if pools and 'POOLS' in pools:
        pool_list = []
        for pool in pools['POOLS']:
            accepted = pool.get('Accepted', pool.get('accepted', 0))
            rejected = pool.get('Rejected', pool.get('rejected', 0))
            pool_list.append({
                'accepted': int(accepted),
                'rejected': int(rejected)
            })
        result['pools'] = pool_list
    
    return result
