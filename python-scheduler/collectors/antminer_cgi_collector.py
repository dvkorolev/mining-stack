"""
Antminer CGI collector - Fallback driver for Antminers when port 4028 API fails.
Uses web-based CGI endpoints with digest authentication.
"""

import asyncio
import logging
from typing import Dict, Optional

import httpx

logger = logging.getLogger(__name__)


async def collect_antminer_cgi(miner_config: Dict) -> Optional[Dict]:
    """
    Collect metrics from Antminer via CGI endpoint.
    
    Args:
        miner_config: Miner configuration dict with 'ip', 'username', 'password'
    
    Returns:
        Normalized data dict or None on failure
    """
    ip = miner_config.get('ip')
    username = miner_config.get('username', 'root')
    password = miner_config.get('password', 'root')
    
    if not ip:
        logger.error("Antminer CGI: No IP provided")
        return None
    
    url = f"http://{ip}/cgi-bin/stats.cgi"
    
    try:
        # Create digest auth using httpx (works on ARM64)
        auth = httpx.DigestAuth(username, password)
        
        # Make authenticated request with timeout
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, auth=auth)
            
            if response.status_code != 200:
                logger.warning(f"Antminer CGI {ip}: HTTP {response.status_code}")
                return None
            
            data = response.json()
            
            # Parse the CGI response
            return _parse_antminer_cgi_response(data, ip)
                
    except asyncio.TimeoutError:
        logger.debug(f"Antminer CGI {ip}: Timeout")
        return None
    except httpx.HTTPError as e:
        logger.debug(f"Antminer CGI {ip}: HTTP error - {e}")
        return None
    except Exception as e:
        logger.debug(f"Antminer CGI {ip}: Unexpected error - {e}")
        return None


def _parse_antminer_cgi_response(data: Dict, ip: str) -> Optional[Dict]:
    """
    Parse Antminer CGI JSON response into normalized format.
    
    Expected structure:
    {
        "STATS": [{...}, {
            "chain_acs1": "...",
            "chain_acs2": "...",
            "chain_rate1": "...",
            "chain_rate2": "...",
            "temp_chip1": 65000,  # Divide by 1000
            "temp_chip2": 67000,
            "fan1": 3600,
            "fan2": 3800,
            ...
        }]
    }
    """
    try:
        if 'STATS' not in data or len(data['STATS']) < 2:
            logger.debug(f"Antminer CGI {ip}: Invalid STATS structure")
            return None
        
        stats = data['STATS'][1]  # Second element contains miner stats
        
        # Find active chains and extract hashrate
        hashrate_total = 0.0
        active_chains = []
        
        for i in range(1, 20):  # Check up to 20 chains
            chain_status_key = f'chain_acs{i}'
            chain_rate_key = f'chain_rate{i}'
            
            if chain_status_key in stats and chain_rate_key in stats:
                chain_status = stats[chain_status_key]
                
                # Check if chain is active (contains 'o' or 'x' indicating working chips)
                if chain_status and ('o' in chain_status.lower() or 'x' in chain_status.lower()):
                    try:
                        # Parse rate_real or chain_rate (in GH/s)
                        rate_str = stats.get(chain_rate_key, '0')
                        rate_gh = float(rate_str) if rate_str else 0.0
                        
                        if rate_gh > 0:
                            active_chains.append(i)
                            hashrate_total += rate_gh / 1000.0  # Convert GH/s to TH/s
                    except (ValueError, TypeError):
                        continue
        
        if hashrate_total == 0:
            logger.debug(f"Antminer CGI {ip}: No active chains found")
            return None
        
        # Extract temperatures (divide by 1000)
        temps = []
        for i in range(1, 20):
            temp_key = f'temp_chip{i}'
            if temp_key in stats:
                try:
                    temp_raw = int(stats[temp_key])
                    temp_c = temp_raw / 1000.0
                    if temp_c > 0 and temp_c < 200:  # Sanity check
                        temps.append(temp_c)
                except (ValueError, TypeError):
                    continue
        
        max_temp = max(temps) if temps else 0.0
        
        # Extract fan speeds
        fans = []
        for i in range(1, 10):
            fan_key = f'fan{i}'
            if fan_key in stats:
                try:
                    fan_speed = int(stats[fan_key])
                    if fan_speed > 0:
                        fans.append({'speed': fan_speed})
                except (ValueError, TypeError):
                    continue
        
        # Build normalized response
        result = {
            'hashrate': hashrate_total,
            'temperature': max_temp,
            'fans': fans,
            'is_mining': hashrate_total > 0,
            'power': 0,  # CGI doesn't provide power
            'uptime': 0,  # CGI doesn't provide uptime
            'efficiency': 0,
            'fault_light': False,
            'errors': [],
            'hashboards': [],
            'fan_psu': [],
            'pools': []
        }
        
        logger.info(f"✓ Antminer CGI {ip}: {hashrate_total:.2f} TH/s, {max_temp:.1f}°C, {len(fans)} fans")
        return result
        
    except Exception as e:
        logger.error(f"Antminer CGI {ip}: Parse error - {e}")
        return None
