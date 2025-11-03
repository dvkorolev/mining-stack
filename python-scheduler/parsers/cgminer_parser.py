"""
CGMiner API response parser.
"""

from typing import Dict, Optional, List


def parse_cgminer_response(stats: Optional[Dict], summary: Optional[Dict], pools: Optional[Dict], devs: Optional[Dict], is_scrypt: bool) -> Dict:
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
            
            # Hashrate
            if 'MHS av' in summary_data:
                mhs = float(summary_data['MHS av'])
                result['hashrate'] = mhs if is_scrypt else (mhs / 1000000.0)
            elif 'GHS av' in summary_data:
                result['hashrate'] = float(summary_data['GHS av']) / 1000.0
    
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
