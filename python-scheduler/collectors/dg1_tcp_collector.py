"""
ElphaPex DG1 TCP collector - Specialized driver for DG1 SCRYPT miners.
Uses reverse-engineered TCP socket protocol on port 4028.
"""

import asyncio
import logging
import re
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# DG1 uses port 4028 with a custom protocol
DG1_PORT = 4028
DG1_COMMAND = b"status\n"  # Simple status command


async def collect_dg1_tcp(miner_config: Dict) -> Optional[Dict]:
    """
    Collect metrics from DG1 miner via custom TCP protocol.
    
    Args:
        miner_config: Miner configuration dict with 'ip'
    
    Returns:
        Normalized data dict or None on failure
    """
    ip = miner_config.get('ip')
    
    if not ip:
        logger.error("DG1 TCP: No IP provided")
        return None
    
    try:
        # Connect to DG1 miner
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, DG1_PORT),
            timeout=10.0
        )
        
        # Send status command
        writer.write(DG1_COMMAND)
        await writer.drain()
        
        # Read response (DG1 sends a single line response)
        response_bytes = await asyncio.wait_for(
            reader.read(4096),
            timeout=10.0
        )
        
        # Close connection
        writer.close()
        await writer.wait_closed()
        
        # Decode response
        response = response_bytes.decode('utf-8', errors='ignore').strip()
        
        if not response:
            logger.debug(f"DG1 TCP {ip}: Empty response")
            return None
        
        # Parse the response
        return _parse_dg1_response(response, ip)
        
    except asyncio.TimeoutError:
        logger.debug(f"DG1 TCP {ip}: Timeout")
        return None
    except ConnectionRefusedError:
        logger.debug(f"DG1 TCP {ip}: Connection refused")
        return None
    except Exception as e:
        logger.debug(f"DG1 TCP {ip}: Error - {e}")
        return None


def _parse_dg1_response(response: str, ip: str) -> Optional[Dict]:
    """
    Parse DG1 TCP response into normalized format.
    
    Expected formats (examples from community scripts):
    - "hashrate:1234.56M;temp:65;fan1:3600;fan2:3800;uptime:12345"
    - "MHS:1234.56;TEMP:65;FAN1:3600;FAN2:3800"
    - JSON-like: {"hashrate": "1234.56M", "temp": 65, ...}
    
    DG1 is a SCRYPT miner, so hashrate is in MH/s
    """
    try:
        data = {}
        
        # Try to parse as key:value pairs separated by semicolons
        if ';' in response:
            pairs = response.split(';')
            for pair in pairs:
                if ':' in pair:
                    key, value = pair.split(':', 1)
                    data[key.strip().lower()] = value.strip()
                elif '=' in pair:
                    key, value = pair.split('=', 1)
                    data[key.strip().lower()] = value.strip()
        
        # Extract hashrate (in MH/s for SCRYPT)
        hashrate_mhs = 0.0
        for key in ['hashrate', 'mhs', 'rate', 'hash']:
            if key in data:
                hashrate_str = data[key]
                # Remove units like 'M', 'G', 'MH/s'
                hashrate_str = re.sub(r'[MGmg].*', '', hashrate_str).strip()
                try:
                    hashrate_mhs = float(hashrate_str)
                    break
                except ValueError:
                    continue
        
        if hashrate_mhs == 0:
            logger.debug(f"DG1 TCP {ip}: No hashrate found in response")
            return None
        
        # Extract temperature
        temperature = 0.0
        for key in ['temp', 'temperature', 'temp1']:
            if key in data:
                try:
                    temp_str = re.sub(r'[Cc°].*', '', data[key]).strip()
                    temperature = float(temp_str)
                    break
                except ValueError:
                    continue
        
        # Extract fan speeds
        fans = []
        for i in range(1, 5):  # Check for fan1, fan2, fan3, fan4
            fan_key = f'fan{i}'
            if fan_key in data:
                try:
                    fan_speed = int(data[fan_key])
                    if fan_speed > 0:
                        fans.append({'speed': fan_speed})
                except ValueError:
                    continue
        
        # If no numbered fans, try generic 'fan' key
        if not fans and 'fan' in data:
            try:
                fan_speed = int(data['fan'])
                if fan_speed > 0:
                    fans.append({'speed': fan_speed})
            except ValueError:
                pass
        
        # Extract uptime (if available)
        uptime = 0
        for key in ['uptime', 'elapsed', 'runtime']:
            if key in data:
                try:
                    uptime = int(data[key])
                    break
                except ValueError:
                    continue
        
        # Build normalized response (DG1 is SCRYPT, so hashrate in MH/s)
        result = {
            'hashrate': hashrate_mhs,  # MH/s for SCRYPT
            'temperature': temperature,
            'fans': fans,
            'is_mining': hashrate_mhs > 0,
            'power': 0,  # DG1 doesn't report power
            'uptime': uptime,
            'efficiency': 0,
            'fault_light': False,
            'errors': [],
            'hashboards': [],
            'fan_psu': [],
            'pools': []
        }
        
        logger.info(f"✓ DG1 TCP {ip}: {hashrate_mhs:.2f} MH/s, {temperature:.1f}°C, {len(fans)} fans")
        return result
        
    except Exception as e:
        logger.error(f"DG1 TCP {ip}: Parse error - {e}")
        return None
