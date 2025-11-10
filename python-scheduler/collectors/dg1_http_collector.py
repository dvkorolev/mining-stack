"""
ElphaPex DG1 HTTP collector - Uses CGI API with HTTP Basic Auth.
"""

import asyncio
import logging
import aiohttp
from typing import Dict, Optional

logger = logging.getLogger(__name__)


async def collect_dg1_http(miner_config: Dict) -> Optional[Dict]:
    """
    Collect metrics from DG1 miner via HTTP CGI API.
    
    Args:
        miner_config: Miner configuration dict with 'ip', 'username', 'password'
    
    Returns:
        Normalized data dict or None on failure
    """
    ip = miner_config.get('ip')
    username = miner_config.get('username', 'root')
    password = miner_config.get('password', 'root')
    
    if not ip:
        logger.error("DG1 HTTP: No IP provided")
        return None
    
    try:
        # Create HTTP Basic Auth
        auth = aiohttp.BasicAuth(username, password)
        
        # Fetch stats from CGI endpoint
        async with aiohttp.ClientSession(auth=auth, timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(f'http://{ip}/cgi-bin/stats.cgi') as response:
                if response.status != 200:
                    logger.debug(f"DG1 HTTP {ip}: HTTP {response.status}")
                    return None
                
                data = await response.json()
        
        # Parse the response
        return _parse_dg1_response(data, ip)
        
    except asyncio.TimeoutError:
        logger.debug(f"DG1 HTTP {ip}: Timeout")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"DG1 HTTP {ip}: Connection error - {e}")
        return None
    except Exception as e:
        logger.error(f"DG1 HTTP {ip}: Unexpected error - {e}")
        return None


def _parse_dg1_response(data: Dict, ip: str) -> Optional[Dict]:
    """
    Parse DG1 CGI response into normalized format.
    
    Expected format:
    {
      "STATS": [{
        "rate_5s": 78980.57,  # MH/s
        "rate_15m": 14605,
        "elapsed": 846890,
        "chain": [
          {
            "temp_chip": ["60125", "64125", "", ""],
            "temp_pcb": [47, 46, 67, 66],
            "rate_real": 3540.23,
            "hw": 204,
            "asic_num": 204
          },
          ...
        ],
        "fan": ["6060", "6000", "6060", "6120"]
      }]
    }
    """
    try:
        if 'STATS' not in data or not data['STATS']:
            logger.debug(f"DG1 HTTP {ip}: No STATS in response")
            return None
        
        stats = data['STATS'][0]
        
        # Extract hashrate (in MH/s for SCRYPT)
        hashrate_mhs = float(stats.get('rate_5s', 0))
        
        if hashrate_mhs == 0:
            logger.debug(f"DG1 HTTP {ip}: Zero hashrate")
            return None
        
        # Extract maximum temperature from all chains
        temperature = 0.0
        chains = stats.get('chain', [])
        for chain in chains:
            temp_chips = chain.get('temp_chip', [])
            for temp_str in temp_chips:
                if temp_str and temp_str.strip():
                    try:
                        # Temperature is in millidegrees (e.g., "64125" = 64.125°C)
                        temp_c = float(temp_str) / 1000.0
                        temperature = max(temperature, temp_c)
                    except (ValueError, TypeError):
                        continue
        
        # Extract fan speeds
        fans = []
        fan_speeds = stats.get('fan', [])
        for fan_speed_str in fan_speeds:
            try:
                fan_speed = int(fan_speed_str)
                if fan_speed > 0:
                    fans.append({'speed': fan_speed})
            except (ValueError, TypeError):
                continue
        
        # Extract uptime
        uptime = int(stats.get('elapsed', 0))
        
        # Build normalized response (DG1 is SCRYPT, so hashrate in MH/s)
        result = {
            'hashrate': hashrate_mhs,  # MH/s for SCRYPT
            'temperature': temperature,
            'fans': fans,
            'is_mining': hashrate_mhs > 0,
            'power': 0,  # DG1 doesn't report power via API
            'uptime': uptime,
            'efficiency': 0,
            'fault_light': False,
            'errors': [],
            'hashboards': [],
            'fan_psu': [],
            'pools': []
        }
        
        logger.info(f"✓ DG1 HTTP {ip}: {hashrate_mhs:.2f} MH/s, {temperature:.1f}°C, {len(fans)} fans")
        return result
        
    except Exception as e:
        logger.error(f"DG1 HTTP {ip}: Parse error - {e}")
        return None
