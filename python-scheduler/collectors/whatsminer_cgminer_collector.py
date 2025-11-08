"""
Whatsminer CGMiner API collector - Uses port 4028 API for Whatsminers.
This is more reliable than web CGI as it doesn't require session authentication.
"""

import asyncio
import json
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


async def collect_whatsminer_cgminer(miner_config: Dict) -> Optional[Dict]:
    """
    Collect metrics from Whatsminer via cgminer API (port 4028).
    
    This works better than web CGI because:
    - No authentication required
    - Direct API access
    - Returns structured JSON data
    
    Args:
        miner_config: Miner configuration dict with 'ip', 'api_port'
    
    Returns:
        Normalized data dict or None on failure
    """
    ip = miner_config.get('ip')
    port = miner_config.get('api_port') or 4028
    
    if not ip:
        logger.error("Whatsminer CGMiner: No IP provided")
        return None
    
    try:
        # Get summary data (hashrate, uptime, etc.)
        summary = await _cgminer_command(ip, "summary", port)
        if not summary:
            logger.debug(f"Whatsminer CGMiner {ip}: No summary data")
            return None
        
        # Parse summary response (Whatsminer format has data in 'Msg' field)
        summary_data = summary.get('Msg', {})
        if not summary_data:
            # Try standard cgminer format as fallback
            summary_data = summary.get('SUMMARY', [{}])[0] if 'SUMMARY' in summary else {}
        
        # Extract hashrate (MHS av is in MH/s, convert to TH/s)
        mhs_av = summary_data.get('MHS av', 0)
        hashrate_ths = mhs_av / 1_000_000.0 if mhs_av else 0.0
        
        # Get temperature - CRITICAL FIX: Use DEVS command first (most reliable)
        # This is the same logic from the Nov 3rd fix that works in gap-filling
        max_temp = 0
        board_temps = []
        
        # PRIMARY: Get from DEVS command (per-board temperatures - most reliable)
        devs = await _cgminer_command(ip, "devs", port)
        if devs and 'DEVS' in devs:
            for dev in devs['DEVS']:
                # Whatsminer uses 'Temperature' field in DEVS
                if 'Temperature' in dev and dev['Temperature']:
                    temp = float(dev['Temperature'])
                    if temp > 0 and temp < 200:  # Sanity check
                        board_temps.append(temp)
            
            if board_temps:
                max_temp = max(board_temps)
                logger.debug(f"Whatsminer {ip}: Got temperature from DEVS: {max_temp}°C (boards: {board_temps})")
        
        # FALLBACK 1: Try summary fields (less reliable)
        if not max_temp or max_temp == 0:
            max_temp = (summary_data.get('Chip Temp Max') or 
                       summary_data.get('Temperature') or 
                       summary_data.get('Temp') or 
                       summary_data.get('temp_max') or 0)
            if max_temp > 0:
                logger.debug(f"Whatsminer {ip}: Got temperature from summary: {max_temp}°C")
        
        # FALLBACK 2: Try stats command (chip temps - least reliable)
        if not max_temp or max_temp == 0:
            stats = await _cgminer_command(ip, "stats", port)
            temps = []
            if stats and 'STATS' in stats:
                for stat in stats['STATS']:
                    # Whatsminer reports chip temps with various key names
                    for key, value in stat.items():
                        if ('temp' in key.lower() or 'Temp' in key or 'TEMP' in key) and isinstance(value, (int, float)):
                            if value > 0 and value < 200:  # Sanity check
                                temps.append(float(value))
            max_temp = max(temps) if temps else 0.0
            
            if max_temp > 0:
                logger.debug(f"Whatsminer {ip}: Got temperature from stats: {max_temp}°C")
            else:
                logger.warning(f"Whatsminer {ip}: Could not find temperature in DEVS, summary, or stats")
        
        # Get pool data
        pools_data = await _cgminer_command(ip, "pools", port)
        pool_urls = []
        pools_list = []
        if pools_data and 'POOLS' in pools_data:
            for pool in pools_data['POOLS']:
                url = pool.get('URL', '')
                if url:
                    pool_urls.append(url)
                # Extract pool stats for rejection rate
                pools_list.append({
                    'url': url,
                    'accepted': pool.get('Accepted', 0),
                    'rejected': pool.get('Rejected', 0),
                })
        
        # Extract power from summary (Whatsminers report this)
        power = summary_data.get('Power', 0)
        
        # Extract fan speeds
        fan_speed_in = summary_data.get('Fan Speed In', 0)
        fan_speed_out = summary_data.get('Fan Speed Out', 0)
        
        result = {
            'ip': ip,
            'hashrate': hashrate_ths,
            'temperature': max_temp,  # For _update_metrics compatibility
            'temp_max': max_temp,     # For backward compatibility
            'fan_speed': fan_speed_in,  # Use intake fan
            'power': int(power) if power else 0,
            'uptime': int(summary_data.get('Elapsed', 0)),
            'hashboards': [],
            'fans': [],
            'pools': pools_list,  # Full pool data with accepted/rejected
            'pool_urls': pool_urls,  # Just URLs for display
            'is_mining': hashrate_ths > 0,
        }
        
        logger.info(f"✓ Whatsminer CGMiner {ip}: {result['hashrate']:.2f} TH/s, {result['temp_max']:.1f}°C, {result['power']}W")
        return result
        
    except asyncio.TimeoutError:
        logger.debug(f"Whatsminer CGMiner {ip}: Timeout")
        return None
    except Exception as e:
        logger.debug(f"Whatsminer CGMiner {ip}: Error - {e}")
        return None


async def _cgminer_command(ip: str, command: str, port: int = 4028) -> Optional[Dict]:
    """Send cgminer API command with newline terminator"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=10.0)
        cmd = json.dumps({"command": command})
        writer.write((cmd + "\n").encode())
        await writer.drain()
        data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
        writer.close()
        await writer.wait_closed()
        response_str = data.decode().strip('\x00')
        try:
            return json.loads(response_str)
        except json.JSONDecodeError:
            # Try partial decode
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(response_str)
            return obj
    except Exception:
        return None
