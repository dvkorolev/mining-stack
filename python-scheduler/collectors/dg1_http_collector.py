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
        
        # Fetch stats and pools from CGI endpoints
        async with aiohttp.ClientSession(auth=auth, timeout=aiohttp.ClientTimeout(total=10)) as session:
            # Fetch stats
            async with session.get(f'http://{ip}/cgi-bin/stats.cgi') as response:
                if response.status != 200:
                    logger.debug(f"DG1 HTTP {ip}: HTTP {response.status}")
                    return None
                stats_data = await response.json()
            
            # Fetch pools
            pools_data = None
            try:
                async with session.get(f'http://{ip}/cgi-bin/pools.cgi') as response:
                    if response.status == 200:
                        pools_data = await response.json()
            except Exception as e:
                logger.debug(f"DG1 HTTP {ip}: Could not fetch pools - {e}")
        
        # Parse the response
        return _parse_dg1_response(stats_data, pools_data, ip, miner_config)
        
    except asyncio.TimeoutError:
        logger.debug(f"DG1 HTTP {ip}: Timeout")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"DG1 HTTP {ip}: Connection error - {e}")
        return None
    except Exception as e:
        logger.error(f"DG1 HTTP {ip}: Unexpected error - {e}")
        return None


def _parse_dg1_response(stats_data: Dict, pools_data: Optional[Dict], ip: str, miner_config: Dict = None) -> Optional[Dict]:
    """
    Parse DG1 CGI response into normalized format.
    
    Args:
        stats_data: Response from /cgi-bin/stats.cgi
        pools_data: Response from /cgi-bin/pools.cgi (optional)
        ip: Miner IP address
    
    Expected stats format (field names as reported by the DG1+ firmware):
    {
      "STATS": [{
        "rate_unit": "MH/s",
        "rate_ideal": 14229,      # the machine's own nominal rate
        "rate_15m": 14381,        # preferred - averaged, still responsive
        "rate_avg": 14127.97,     # average over `elapsed`; slow to react
        "rate_5s": 48728.6,       # instantaneous sample; reads ~3.4x high
        "rate_30m": 0,            # present but never populated
        "elapsed": 1133087,
        "chain": [...],
        "fan": ["6060", "6000", "6060", "6120"]
      }]
    }
    
    Expected pools format:
    {
      "POOLS": [{
        "index": 0,
        "url": "stratum+tcp://pool.com:3434",
        "user": "worker.001",
        "accepted": 177989,
        "rejected": 867,
        "status": "Alive"
      }]
    }
    """
    try:
        if 'STATS' not in stats_data or not stats_data['STATS']:
            logger.debug(f"DG1 HTTP {ip}: No STATS in response")
            return None
        
        stats = stats_data['STATS'][0]
        
        # Extract hashrate (in MH/s for SCRYPT).
        # rate_5s is a 5-second sample: on this hardware it runs ~3.4x the
        # machine's own rate_ideal and spikes far higher, so it is a last
        # resort, not a reading. Prefer an averaged field (DMI-75).
        # rate_30m is present in the response but reports 0 - do not use it.
        hashrate_mhs = 0.0
        hashrate_field = None
        for field in ('rate_15m', 'rate_avg', 'rate_5s'):
            try:
                value = float(stats.get(field, 0) or 0)
            except (ValueError, TypeError):
                continue
            if value > 0:
                hashrate_mhs = value
                hashrate_field = field
                break
        
        if hashrate_mhs == 0:
            logger.debug(f"DG1 HTTP {ip}: Zero hashrate")
            return None
        
        if hashrate_field == 'rate_5s':
            logger.warning(
                f"DG1 HTTP {ip}: no averaged hashrate field, falling back to "
                f"rate_5s ({hashrate_mhs:.1f} MH/s) - this figure is an "
                f"instantaneous sample and reads high"
            )
        
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
        
        # Parse pool data if available
        pools = []
        if pools_data and 'POOLS' in pools_data:
            for pool in pools_data['POOLS']:
                try:
                    pools.append({
                        'url': pool.get('url', ''),
                        'user': pool.get('user', ''),
                        'accepted': int(pool.get('accepted', 0)),
                        'rejected': int(pool.get('rejected', 0)),
                        'status': pool.get('status', 'Unknown'),
                        'priority': int(pool.get('priority', 0))
                    })
                except (ValueError, TypeError, KeyError):
                    continue
        
        # Get power from profile (DG1 doesn't report power via API)
        power = 0
        try:
            from asic_profile_loader import get_library
            library = get_library()
            model = miner_config.get('model', 'DG1+')
            logger.info(f"DG1 HTTP {ip}: Looking up profile for model '{model}'")
            profile = library.get_profile(model)
            logger.info(f"DG1 HTTP {ip}: Profile found: {profile is not None}")
            if profile:
                power = profile.expected.get('power_typical', 0)
                logger.info(f"DG1 HTTP {ip}: Profile power_typical: {power}W")
                if power > 0:
                    logger.info(f"DG1 HTTP {ip}: Using profile power: {power}W")
        except Exception as e:
            logger.warning(f"DG1 HTTP {ip}: Failed to get profile power: {e}")
        
        # Build normalized response (DG1 is SCRYPT, so hashrate in MH/s)
        result = {
            'hashrate': hashrate_mhs,  # MH/s for SCRYPT
            'temperature': temperature,
            'fans': fans,
            'is_mining': hashrate_mhs > 0,
            'power': power,  # From profile
            'uptime': uptime,
            'efficiency': 0,
            'fault_light': False,
            'errors': [],
            'hashboards': [],
            'fan_psu': [],
            'pools': pools
        }
        
        logger.info(f"✓ DG1 HTTP {ip}: {hashrate_mhs:.2f} MH/s ({hashrate_field}), {temperature:.1f}°C, {power}W, {len(fans)} fans")
        return result
        
    except Exception as e:
        logger.error(f"DG1 HTTP {ip}: Parse error - {e}")
        return None
