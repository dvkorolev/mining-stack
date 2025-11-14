"""
Whatsminer CGI collector - Fallback driver for Whatsminer M30/M50 series.
Uses web-based CGI endpoints for data collection when PyASIC fails.
"""

import asyncio
import logging
from typing import Dict, Optional
import re

import httpx

logger = logging.getLogger(__name__)


async def collect_whatsminer_cgi(miner_config: Dict) -> Optional[Dict]:
    """
    Collect metrics from Whatsminer via CGI endpoint.
    
    Whatsminer models (M30S++, M50, M20, etc.) use a different web interface
    than Antminers. They typically use /cgi-bin/luci/admin/status/overview
    or similar endpoints.
    
    Args:
        miner_config: Miner configuration dict with 'ip', 'username', 'password'
    
    Returns:
        Normalized data dict or None on failure
    """
    ip = miner_config.get('ip')
    username = miner_config.get('username', 'admin')
    password = miner_config.get('password', 'admin')
    
    if not ip:
        logger.error("Whatsminer CGI: No IP provided")
        return None
    
    # Try multiple endpoints that Whatsminers use (HTTPS first, then HTTP)
    endpoints = [
        f"https://{ip}/cgi-bin/luci/admin/status/btminerstatus",  # Status page (HTTPS)
        f"https://{ip}/cgi-bin/luci/admin/status/overview",       # Overview page (HTTPS)
        f"https://{ip}/cgi-bin/get_system_info",                  # System info API (HTTPS)
        f"http://{ip}/cgi-bin/luci/admin/status/btminerstatus",   # Status page (HTTP fallback)
        f"http://{ip}/cgi-bin/luci/admin/status/overview",        # Overview page (HTTP fallback)
    ]
    
    try:
        # Disable SSL verification for self-signed certificates
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            # Try basic auth first (common for Whatsminers)
            auth = httpx.BasicAuth(username, password)
            
            for url in endpoints:
                try:
                    response = await client.get(url, auth=auth)
                    
                    if response.status_code == 200:
                        logger.debug(f"Whatsminer CGI {ip}: Success on {url}")
                        
                        # Try to parse as JSON first
                        try:
                            data = response.json()
                            return _parse_whatsminer_json_response(data, ip)
                        except:
                            # If not JSON, try HTML parsing
                            html = response.text
                            return _parse_whatsminer_html_response(html, ip)
                    
                except Exception as e:
                    logger.debug(f"Whatsminer CGI {ip}: Failed {url} - {e}")
                    continue
            
            logger.warning(f"Whatsminer CGI {ip}: All endpoints failed")
            return None
                
    except asyncio.TimeoutError:
        logger.debug(f"Whatsminer CGI {ip}: Timeout")
        return None
    except httpx.HTTPError as e:
        logger.debug(f"Whatsminer CGI {ip}: HTTP error - {e}")
        return None
    except Exception as e:
        logger.debug(f"Whatsminer CGI {ip}: Unexpected error - {e}")
        return None


def _parse_whatsminer_json_response(data: Dict, ip: str) -> Optional[Dict]:
    """
    Parse JSON response from Whatsminer API.
    
    Expected format varies by model, but typically includes:
    - hashrate (in TH/s or GH/s)
    - temperature
    - fan speeds
    - power
    """
    try:
        result = {
            'hashrate': 0.0,
            'temperature': 0.0,  # Standard field name
            'power': 0,
            'uptime': 0,
            'is_mining': True,  # Will be updated based on hashrate
            'fans': [],
            'hashboards': [],
            'pools': [],
            'errors': [],
            'fan_psu': [],
            'efficiency': 0,
            'fault_light': False,
        }
        
        # Try to extract hashrate (various field names)
        for field in ['hashrate', 'hs_rt', 'hash_rate', 'MHS av']:
            if field in data:
                hashrate_value = data[field]
                # Convert to TH/s if needed
                if isinstance(hashrate_value, (int, float)):
                    if hashrate_value > 1000:  # Likely in GH/s
                        result['hashrate'] = hashrate_value / 1000.0
                    else:
                        result['hashrate'] = float(hashrate_value)
                break
        
        # Extract temperature
        for field in ['temp', 'temperature', 'Temperature']:
            if field in data:
                result['temperature'] = float(data[field])
                break
        
        # Extract fan speed and convert to standard format
        for field in ['fan', 'fan_speed', 'Fan Speed']:
            if field in data:
                fan_rpm = int(data[field])
                if fan_rpm > 0:
                    result['fans'] = [{'speed': fan_rpm}]
                break
        
        # Extract power
        for field in ['power', 'Power', 'power_consumption']:
            if field in data:
                result['power'] = int(data[field])
                break
        
        # Set is_mining based on hashrate
        result['is_mining'] = result['hashrate'] > 0
        
        logger.info(f"✓ Whatsminer CGI {ip}: {result['hashrate']:.2f} TH/s, {result['temperature']:.1f}°C")
        return result
        
    except Exception as e:
        logger.error(f"Whatsminer CGI {ip}: Parse error - {e}")
        return None


def _parse_whatsminer_html_response(html: str, ip: str) -> Optional[Dict]:
    """
    Parse HTML response from Whatsminer web interface.
    
    Extracts metrics from the status page HTML using regex patterns.
    """
    try:
        result = {
            'hashrate': 0.0,
            'temperature': 0.0,  # Standard field name
            'power': 0,
            'uptime': 0,
            'is_mining': True,  # Will be updated based on hashrate
            'fans': [],
            'hashboards': [],
            'pools': [],
            'errors': [],
            'fan_psu': [],
            'efficiency': 0,
            'fault_light': False,
        }
        
        # Extract hashrate (e.g., "111.000 TH/s" or "111000 GH/s")
        hashrate_match = re.search(r'(\d+\.?\d*)\s*(TH/s|GH/s)', html, re.IGNORECASE)
        if hashrate_match:
            value = float(hashrate_match.group(1))
            unit = hashrate_match.group(2).upper()
            if 'GH' in unit:
                value = value / 1000.0  # Convert GH/s to TH/s
            result['hashrate'] = value
        
        # Extract temperature (e.g., "76.1°C" or "76.1 C")
        temp_match = re.search(r'(\d+\.?\d*)\s*[°]?C', html, re.IGNORECASE)
        if temp_match:
            result['temperature'] = float(temp_match.group(1))
        
        # Extract fan speed (e.g., "5190 RPM") and convert to standard format
        fan_match = re.search(r'(\d+)\s*RPM', html, re.IGNORECASE)
        if fan_match:
            fan_rpm = int(fan_match.group(1))
            if fan_rpm > 0:
                result['fans'] = [{'speed': fan_rpm}]
        
        # Extract power (e.g., "3500 W")
        power_match = re.search(r'(\d+)\s*W', html, re.IGNORECASE)
        if power_match:
            result['power'] = int(power_match.group(1))
        
        # Set is_mining based on hashrate
        result['is_mining'] = result['hashrate'] > 0
        
        if result['hashrate'] > 0:
            logger.info(f"✓ Whatsminer CGI {ip}: {result['hashrate']:.2f} TH/s, {result['temperature']:.1f}°C")
            return result
        else:
            logger.warning(f"Whatsminer CGI {ip}: Could not extract hashrate from HTML")
            return None
        
    except Exception as e:
        logger.error(f"Whatsminer CGI {ip}: HTML parse error - {e}")
        return None
