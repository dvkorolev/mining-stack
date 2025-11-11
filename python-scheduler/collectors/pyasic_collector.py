"""
PyASIC-based collector with CGMiner fallback for gap filling.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, List

from pyasic import get_miner

from config import MAX_CONCURRENT_REQUESTS
from parsers.cgminer_parser import parse_cgminer_response
from asic_profile_loader import get_library
from metrics import (
    miner_hashrate, miner_power, miner_temp_max, miner_is_mining,
    miner_uptime, miner_efficiency, miner_fault_light, miner_errors_count,
    miner_scrape_status, miner_state, miner_hashrate_mhs,
    miner_board_hashrate, miner_board_temp, miner_board_chips_count,
    miner_board_chips_expected, miner_fan_speed, miner_pool_accepted,
    miner_pool_rejected, collection_duration, collection_success,
    collection_timestamp, miner_gaps_filled_total
)

logger = logging.getLogger(__name__)


def _is_scrypt_miner(model: str, algorithm_override: str = None) -> bool:
    """
    Detect if miner is SCRYPT-based using profile library.
    
    Args:
        model: Miner model string
        algorithm_override: Explicit algorithm from config ('sha256' or 'scrypt')
    
    Returns:
        True if SCRYPT miner, False if SHA-256
    """
    # Explicit override takes precedence
    if algorithm_override:
        return algorithm_override.lower() == 'scrypt'
    
    # Ensure model is a string
    if not model or not isinstance(model, str):
        return False
    
    # Use profile library to determine algorithm
    library = get_library()
    profile = library.get_profile(model, algorithm_override)
    
    if profile:
        return profile.algorithm == 'scrypt'
    
    # Fallback to legacy detection if no profile found
    model_lower = model.lower()
    import re
    scrypt_patterns = [
        r'\bdg1\b',
        r'\bl3\+?\b',
        r'\bl7\b',
        r'scrypt',
        r'litecoin',
        r'doge',
    ]
    
    return any(re.search(pattern, model_lower) for pattern in scrypt_patterns)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float, handling PyASIC custom types"""
    if value is None:
        return default
    try:
        if hasattr(value, '__float__'):
            x = float(value)
        elif isinstance(value, (int, float)):
            x = float(value)
        else:
            x = float(value)
        return default if x != x else x
    except (TypeError, ValueError, AttributeError):
        return default


def _check_data_gaps(pyasic_data: Dict, model: str) -> Dict[str, bool]:
    """Check which metrics are missing from PyASIC data using profile library"""
    gaps = {'power': False, 'rejected': False, 'temperature': False}
    
    hashrate = _safe_float(pyasic_data.get('hashrate', 0))
    power = _safe_float(pyasic_data.get('power', 0))
    temperature = _safe_float(pyasic_data.get('temperature', 0))
    
    # Get profile to check if this miner type typically has these issues
    library = get_library()
    profile = library.get_profile(model)
    
    # Check power gap
    if not power or power == 0:
        if profile:
            # Check if profile indicates power reporting issues
            quirks = profile.get_parser_quirks()
            if quirks.get('power_field') and hashrate > 0:
                gaps['power'] = True
        else:
            # Fallback to legacy logic
            if 'antminer' in model.lower() or 's19' in model.lower() or 's17' in model.lower():
                gaps['power'] = True
            elif hashrate > 0:
                gaps['power'] = True
    
    # Check rejected shares gap
    pools = pyasic_data.get('pools', [])
    if pools:
        total_rejected = sum(getattr(p, 'rejected', 0) or 0 for p in pools)
        total_accepted = sum(getattr(p, 'accepted', 0) or 0 for p in pools)
        if total_accepted > 100 and total_rejected == 0:
            if profile and profile.manufacturer == 'MicroBT':
                gaps['rejected'] = True
            elif 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower():
                gaps['rejected'] = True
    
    # Check temperature gap
    if not temperature or temperature == 0:
        if hashrate > 0:
            gaps['temperature'] = True
            logger.debug(f"Temperature gap detected for {model}: temp={temperature}, hashrate={hashrate}")
    
    return gaps


def _get_max_temp(data) -> float:
    """Get max temperature from PyASIC data"""
    if not data or not hasattr(data, 'hashboards'):
        return 0.0
    hashboards = data.hashboards
    if not isinstance(hashboards, (list, tuple)) or not hashboards:
        return 0.0
    all_temps = [b.chip_temp for b in hashboards if hasattr(b, 'chip_temp') and b.chip_temp is not None] + \
                [b.temp for b in hashboards if hasattr(b, 'temp') and b.temp is not None]
    return max(all_temps) if all_temps else 0.0


async def _cgminer_command(ip: str, command: str, port: int = 4028) -> Optional[Dict]:
    """Send cgminer API command"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=10.0)
        cmd = json.dumps({"command": command})
        # Send command without newline - some miners reject commands with \n
        writer.write(cmd.encode())
        await writer.drain()
        data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
        writer.close()
        await writer.wait_closed()
        response_str = data.decode().strip('\x00').strip()
        # Remove trailing % if present
        if response_str.endswith('%'):
            response_str = response_str[:-1]
        try:
            result = json.loads(response_str)
            logger.debug(f"CGMiner {command} from {ip}: success")
            return result
        except json.JSONDecodeError as e:
            logger.warning(f"CGMiner {command} from {ip}: JSON decode error: {e}, response: {response_str[:100]}")
            try:
                decoder = json.JSONDecoder()
                obj, _ = decoder.raw_decode(response_str)
                return obj
            except:
                return None
    except Exception as e:
        logger.warning(f"_cgminer_command failed for {ip}:4028 cmd={command}: {type(e).__name__}: {e}")
        return None


def _merge_data(pyasic_data: Dict, cgminer_data: Dict, gaps: Dict[str, bool], cgminer_board_temps: List[float]) -> Dict:
    """Merge PyASIC and cgminer data, using cgminer to fill gaps"""
    merged = pyasic_data.copy()
    
    if gaps.get('power') and cgminer_data.get('power', 0) > 0:
        merged['power'] = cgminer_data['power']
        miner_gaps_filled_total.labels(type='power').inc()
        logger.debug(f"Filled power gap: {cgminer_data['power']}W from cgminer")
    
    if gaps.get('rejected'):
        cgminer_pools = cgminer_data.get('pools', [])
        if cgminer_pools:
            total_rejected = sum(p.get('rejected', 0) for p in cgminer_pools)
            if total_rejected > 0:
                miner_gaps_filled_total.labels(type='rejected').inc()
            merged['pools'] = cgminer_pools
            logger.debug(f"Filled rejected shares gap: {total_rejected} from cgminer")
    
    if gaps.get('temperature') and cgminer_data.get('temperature', 0) > 0:
        merged['temperature'] = cgminer_data['temperature']
        merged['cgminer_board_temps'] = cgminer_board_temps
        miner_gaps_filled_total.labels(type='temperature').inc()
        logger.info(f"✓ Filled temperature gap: {cgminer_data['temperature']}°C from cgminer")
    elif gaps.get('temperature'):
        logger.warning(f"⚠️  Temperature gap detected but cgminer returned 0 or None")
    
    return merged


def _update_metrics(data: Dict, ip: str, name: str, model: str, scrape_status: int = 2, algorithm: str = None):
    """Update Prometheus metrics"""
    # Ensure model is a string
    model = str(model) if model else "Unknown"
    is_scrypt = _is_scrypt_miner(model, algorithm)
    model = model.replace(" ", "_")
    
    hashrate_raw = data.get('hashrate', 0) or 0
    hashrate = float(hashrate_raw) if hashrate_raw else 0.0
    is_mining = data.get('is_mining', True)
    
    if hashrate == 0 and not is_mining:
        state = 1
    elif hashrate > 0:
        state = 2
    else:
        state = 0
    
    # Determine algorithm label
    algo = 'scrypt' if is_scrypt else 'sha256'
    
    miner_scrape_status.labels(ip=ip, name=name, model=model, algorithm=algo).set(scrape_status)
    miner_state.labels(ip=ip, name=name, model=model, algorithm=algo).set(state)
    
    if is_scrypt:
        # SCRYPT: hashrate is in MH/s, only report in MH/s metric
        miner_hashrate_mhs.labels(ip=ip, name=name, model=model, algorithm=algo).set(hashrate)
    else:
        # SHA-256: hashrate is in TH/s
        miner_hashrate.labels(ip=ip, name=name, model=model, algorithm=algo).set(hashrate)
    
    power = float(data.get('power', 0) or 0)
    temperature = float(data.get('temperature', 0) or 0)
    uptime = float(data.get('uptime', 0) or 0)
    
    miner_power.labels(ip=ip, name=name, model=model, algorithm=algo).set(power)
    miner_temp_max.labels(ip=ip, name=name, model=model, algorithm=algo).set(temperature)
    miner_is_mining.labels(ip=ip, name=name, model=model, algorithm=algo).set(1 if is_mining else 0)
    miner_uptime.labels(ip=ip, name=name, model=model, algorithm=algo).set(uptime)
    
    efficiency_raw = data.get('efficiency', 0) or 0
    efficiency = float(efficiency_raw) if efficiency_raw else 0.0
    if is_scrypt:
        efficiency = 0.0
    elif efficiency == 0 and hashrate > 0 and power > 0:
        efficiency = power / hashrate if hashrate > 0 else 0
    miner_efficiency.labels(ip=ip, name=name, model=model, algorithm=algo).set(efficiency)
    
    miner_fault_light.labels(ip=ip, name=name, model=model, algorithm=algo).set(1 if data.get('fault_light') else 0)
    
    errors = data.get('errors', [])
    miner_errors_count.labels(ip=ip, name=name, model=model, algorithm=algo).set(len(errors) if errors else 0)
    
    fans = data.get('fans', [])
    if fans:
        for i, fan in enumerate(fans):
            if hasattr(fan, 'speed'):
                miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id=str(i)).set(fan.speed or 0)
    
    fan_psu = data.get('fan_psu', [])
    if fan_psu and isinstance(fan_psu, (list, tuple)) and len(fan_psu) > 0:
        if hasattr(fan_psu[0], 'speed'):
            miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id='psu').set(fan_psu[0].speed or 0)
    
    pools = data.get('pools', [])
    if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
        first_pool = pools[0]
        if hasattr(first_pool, 'accepted'):
            total_accepted = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
            total_rejected = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
        elif isinstance(first_pool, dict):
            total_accepted = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
            total_rejected = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
        else:
            total_accepted = 0
            total_rejected = 0
        
        miner_pool_accepted.labels(ip=ip, name=name, model=model, algorithm=algo).set(total_accepted)
        miner_pool_rejected.labels(ip=ip, name=name, model=model, algorithm=algo).set(total_rejected)
    
    cgminer_board_temps = data.get('cgminer_board_temps', [])
    if cgminer_board_temps and isinstance(cgminer_board_temps, list):
        for slot_idx, temp in enumerate(cgminer_board_temps):
            if temp > 0:
                slot = str(slot_idx)
                miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(temp)
    
    hashboards = data.get('hashboards', [])
    if hashboards and isinstance(hashboards, (list, tuple)) and len(hashboards) > 0:
        if hasattr(hashboards[0], 'slot'):
            for board in hashboards:
                if not hasattr(board, 'slot'):
                    continue
                slot = str(board.slot)
                miner_board_hashrate.labels(ip=ip, name=name, model=model, slot=slot).set(board.hashrate or 0)
                board_temp = board.chip_temp if board.chip_temp is not None else (board.temp or 0)
                miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(board_temp)
                if hasattr(board, 'chips'):
                    miner_board_chips_count.labels(ip=ip, name=name, model=model, slot=slot).set(board.chips or 0)
                if hasattr(board, 'expected_chips'):
                    miner_board_chips_expected.labels(ip=ip, name=name, model=model, slot=slot).set(board.expected_chips or 0)


async def _collect_via_cgminer_only(ip: str, name: str, model: str, api_port: int, miner_config: Dict = None) -> Dict:
    """Collect data using only CGMiner API or specialized collectors (for miners PyASIC can't identify)"""
    
    # Check if this is a DG1 miner - use HTTP collector instead
    if 'DG1' in model.upper():
        logger.info(f"{name}: Detected DG1 miner, using HTTP collector")
        try:
            from collectors.dg1_http_collector import collect_dg1_http
            data = await collect_dg1_http(miner_config or {'ip': ip})
            if data:
                return {
                    'data': data,
                    'has_gaps': False,
                    'gaps': {},
                    'method': 'dg1_http'
                }
            else:
                return {'error': 'dg1_http_failed', 'error_type': 'other'}
        except Exception as e:
            logger.warning(f"{name}: DG1 HTTP collector failed: {e}")
            return {'error': str(e), 'error_type': 'other'}
    
    # For other miners, try CGMiner API
    try:
        # Get all data from CGMiner API
        stats = await _cgminer_command(ip, "stats", api_port)
        summary = await _cgminer_command(ip, "summary", api_port)
        devs = await _cgminer_command(ip, "devs", api_port)
        
        if not summary:
            # CGMiner API not available
            logger.warning(f"{name}: CGMiner API not available on port {api_port}. Miner type '{model}' may not be supported.")
            return {'error': 'cgminer_not_available', 'error_type': 'unsupported'}
        
        # Extract data
        msg = summary.get('Msg', {})
        if not isinstance(msg, dict):
            return {'error': 'invalid_cgminer_response', 'error_type': 'other'}
        
        hashrate = msg.get('MHS av', 0) / 1_000_000 if 'MHS av' in msg else 0  # Convert MH/s to TH/s
        power = msg.get('Power', 0)
        uptime = msg.get('Elapsed', 0)
        
        # Get temperature from devs
        chip_temp = 0
        if devs and devs.get('DEVS'):
            temps = [d.get('Temperature') for d in devs['DEVS'] if d.get('Temperature')]
            if temps:
                chip_temp = max(temps)
        
        logger.info(f"{name}: Collected via CGMiner only - hashrate={hashrate:.2f} TH/s, power={power}W, temp={chip_temp}°C")
        
        return {
            'data': {
                'hashrate': hashrate,
                'power': power,
                'temperature': chip_temp,
                'is_mining': True,
                'uptime': uptime,
                'efficiency': 0,
                'fault_light': False,
                'errors': [],
                'hashboards': [],
                'fans': [],
                'fan_psu': [],
                'pools': [],
            },
            'has_gaps': False,
            'gaps': {},
            'method': 'cgminer_only'
        }
    except Exception as e:
        logger.warning(f"{name}: CGMiner-only collection failed: {e}")
        return {'error': str(e), 'error_type': 'other'}


async def collect_pyasic_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Batch collection using PyASIC with direct CGMiner API access for temperature
    
    Args:
        miners: List of miner configurations
    
    Note: Temperature is collected directly via PyASIC's CGMiner API access.
          Power for Antminers is not available via API (hardware limitation).
    """
    logger.info(f"Starting batch collection...")
    start_time = time.time()
    
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    async def collect_pyasic_one(miner_config: Dict):
        async with sem:
            ip = miner_config['ip']
            name = miner_config['name']
            model = miner_config['model']
            
            try:
                miner_obj = await asyncio.wait_for(get_miner(ip), timeout=15)
                if not miner_obj:
                    # PyASIC couldn't identify miner (e.g., DG1+ with auth)
                    # Try to get data directly via specialized collectors
                    logger.info(f"{name}: PyASIC couldn't identify miner, trying specialized collectors")
                    return await _collect_via_cgminer_only(ip, name, model, miner_config.get('api_port', 4028), miner_config)
                
                data = await asyncio.wait_for(miner_obj.get_data(), timeout=15)
                if not data:
                    return {'error': 'no_data', 'error_type': 'other'}
                
                # For Whatsminers, get chip temperature directly from CGMiner API
                chip_temp = _safe_float(_get_max_temp(data))
                hashrate = _safe_float(data.hashrate)
                power = _safe_float(data.wattage)
                
                # If PyASIC returns None/0 for critical metrics, try CGMiner API
                if (chip_temp == 0 or hashrate == 0 or power == 0) and hasattr(miner_obj, 'api'):
                    try:
                        # Get summary for hashrate and power
                        if hashrate == 0 or power == 0:
                            summary_data = await asyncio.wait_for(miner_obj.api.summary(), timeout=5)
                            if summary_data:
                                msg = summary_data.get('Msg', {})
                                if isinstance(msg, dict):
                                    if hashrate == 0 and 'MHS av' in msg:
                                        # Convert MH/s to TH/s
                                        hashrate = msg['MHS av'] / 1_000_000
                                        logger.debug(f"{name}: Got hashrate from CGMiner API: {hashrate:.2f} TH/s")
                                    if power == 0 and 'Power' in msg:
                                        power = msg['Power']
                                        logger.debug(f"{name}: Got power from CGMiner API: {power}W")
                        
                        # Get devs for temperature
                        if chip_temp == 0 and hasattr(miner_obj.api, 'devs'):
                            devs_data = await asyncio.wait_for(miner_obj.api.devs(), timeout=5)
                            if devs_data and devs_data.get('DEVS'):
                                temps = [d.get('Temperature') for d in devs_data['DEVS'] if d.get('Temperature')]
                                if temps:
                                    chip_temp = max(temps)
                                    logger.debug(f"{name}: Got chip temp from CGMiner API: {chip_temp}°C")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get data from CGMiner API: {e}")
                
                def _normalize_list(val):
                    if val is None:
                        return []
                    if isinstance(val, (list, tuple)):
                        return list(val)
                    return [val] if val else []
                
                # If power is still 0 after CGMiner attempt, try profile default (for Antminers)
                if power == 0:
                    logger.info(f"{name}: Power is 0, attempting to get from profile (model={model})")
                    # Try to get power from profile
                    try:
                        library = get_library()
                        profile = library.get_profile(model)
                        if profile:
                            # Use typical power from profile (Antminers don't report power via API)
                            power = profile.expected.get('power_typical', 0)
                            if power > 0:
                                logger.info(f"{name}: Using profile typical power: {power}W")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get profile power: {e}")
                
                pyasic_data = {
                    'hashrate': hashrate,
                    'power': power,
                    'temperature': chip_temp,
                    'is_mining': data.is_mining if hasattr(data, 'is_mining') else True,
                    'uptime': _safe_float(data.uptime),
                    'efficiency': _safe_float(data.efficiency),
                    'fault_light': data.fault_light if hasattr(data, 'fault_light') else False,
                    'errors': _normalize_list(data.errors if hasattr(data, 'errors') else None),
                    'hashboards': _normalize_list(data.hashboards if hasattr(data, 'hashboards') else None),
                    'fans': _normalize_list(data.fans if hasattr(data, 'fans') else None),
                    'fan_psu': _normalize_list(data.fan_psu if hasattr(data, 'fan_psu') else None),
                    'pools': _normalize_list(data.pools if hasattr(data, 'pools') else None),
                }
                
                gaps = _check_data_gaps(pyasic_data, model)
                
                # For Whatsminers, supplement with CGMiner data for pool stats (rejected shares)
                # PyASIC doesn't return pool rejection data for Whatsminers
                if 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower() or 'm20' in model.lower():
                    try:
                        pools_data = await asyncio.wait_for(miner_obj.api.pools(), timeout=5)
                        if pools_data and 'POOLS' in pools_data:
                            pools_list = []
                            for pool in pools_data['POOLS']:
                                pools_list.append({
                                    'url': pool.get('URL', ''),
                                    'user': pool.get('User', ''),
                                    'accepted': pool.get('Accepted', 0),
                                    'rejected': pool.get('Rejected', 0),
                                    'status': pool.get('Status', 'Unknown'),
                                    'priority': pool.get('Priority', 0)
                                })
                            pyasic_data['pools'] = pools_list
                            logger.debug(f"{name}: Added pool data from CGMiner API")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get pool data: {e}")
                
                return {
                    'data': pyasic_data,
                    'has_gaps': any(gaps.values()),
                    'gaps': gaps,
                    'method': 'pyasic'
                }
                
            except asyncio.TimeoutError:
                logger.warning(f"⏱️  Timeout collecting from {name} ({ip})")
                return {'error': 'timeout', 'error_type': 'timeout'}
            except ConnectionRefusedError:
                logger.warning(f"🚫 Connection refused by {name} ({ip})")
                return {'error': 'connection_refused', 'error_type': 'refused'}
            except OSError as e:
                if 'refused' in str(e).lower():
                    return {'error': 'connection_refused', 'error_type': 'refused'}
                return {'error': str(e), 'error_type': 'other'}
            except Exception as e:
                error_name = type(e).__name__
                if 'APIError' in error_name:
                    return {'error': str(e), 'error_type': 'api_error'}
                return {'error': str(e), 'error_type': 'other'}
    
    tasks = [collect_pyasic_one(miner) for miner in miners]
    pyasic_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    success_count = 0
    miners_data = []
    
    for i, result in enumerate(pyasic_results):
        miner = miners[i]
        
        # Ensure required fields have valid values
        miner_ip = miner.get('ip') or 'unknown'
        miner_name = miner.get('name') or f'miner-{miner_ip}'
        miner_model = miner.get('model') or 'Unknown'
        
        if result and isinstance(result, dict) and result.get('data'):
            data = result['data']
            has_gaps = result.get('has_gaps', False)
            
            # Scrape status: 2 = full data, 1 = partial data (has gaps)
            scrape_status = 1 if has_gaps else 2
            
            _update_metrics(data, miner_ip, miner_name, miner_model, scrape_status, miner.get('algorithm'))
            success_count += 1
            
            hashrate_val = _safe_float(data.get('hashrate', 0))
            temp_val = _safe_float(data.get('temperature', 0))
            
            # Detect SCRYPT algorithm
            is_scrypt = _is_scrypt_miner(miner.get('algorithm'))
            
            miner_data = {
                'ip': miner_ip,
                'name': miner_name,
                'model': miner_model,
                'hashrate': hashrate_val,
                'power': _safe_float(data.get('power', 0)),
                'temp_max': temp_val,
                'is_mining': 1 if data.get('is_mining', True) else 0,
                'uptime': _safe_float(data.get('uptime', 0)),
                'efficiency': _safe_float(data.get('efficiency', 0)),
                'fault_light': 1 if data.get('fault_light') else 0,
                'errors_count': len(data.get('errors', [])) if data.get('errors') else 0,
                'scrape_status': scrape_status,
                'state': 2 if hashrate_val > 0 else (1 if not data.get('is_mining', True) else 0),
                'pool_accepted': 0,
                'pool_rejected': 0,
            }
            
            # Add hashrate_mhs for SCRYPT miners (for backend algorithm detection)
            if is_scrypt:
                miner_data['hashrate_mhs'] = hashrate_val  # Raw MH/s value
            
            pools = data.get('pools', [])
            pool_urls = []
            if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
                first_pool = pools[0]
                if hasattr(first_pool, 'accepted'):
                    miner_data['pool_accepted'] = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
                    miner_data['pool_rejected'] = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
                    # Extract pool URLs
                    for p in pools:
                        if hasattr(p, 'url') and p.url:
                            pool_urls.append(str(p.url))
                        elif hasattr(p, 'pool_url') and p.pool_url:
                            pool_urls.append(str(p.pool_url))
                elif isinstance(first_pool, dict):
                    miner_data['pool_accepted'] = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
                    miner_data['pool_rejected'] = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
                    # Extract pool URLs from dict
                    for p in pools:
                        if isinstance(p, dict):
                            url = p.get('url') or p.get('pool_url') or p.get('URL')
                            if url:
                                pool_urls.append(str(url))
            
            # Add pool URLs to miner data
            miner_data['pools'] = pool_urls
            
            miners_data.append(miner_data)
        else:
            error_type = result.get('error_type', 'other') if result else 'other'
            if error_type == 'timeout':
                scrape_status = 0
            elif error_type == 'refused':
                scrape_status = -1
            else:
                scrape_status = -2
            
            miner_scrape_status.labels(ip=miner_ip, name=miner_name, model=miner_model).set(scrape_status)
            miner_state.labels(ip=miner_ip, name=miner_name, model=miner_model).set(0)
            
            miners_data.append({
                'ip': miner_ip,
                'name': miner_name,
                'model': miner_model,
                'hashrate': 0,
                'power': 0,
                'temp_max': 0,
                'is_mining': 0,
                'uptime': 0,
                'efficiency': 0,
                'fault_light': 0,
                'errors_count': 0,
                'scrape_status': scrape_status,
                'state': 0,
                'pool_accepted': 0,
                'pool_rejected': 0,
                'pools': [],  # No pool data for offline miners
            })
    
    duration = time.time() - start_time
    
    collection_duration.labels(collector='hybrid').set(duration)
    collection_success.labels(collector='hybrid').set(1 if success_count > 0 else 0)
    collection_timestamp.labels(collector='hybrid').set(time.time())
    
    logger.info(f"✓ Batch collection: {success_count}/{len(miners)} miners in {duration:.1f}s")
    
    return {
        'success': True,
        'miners_collected': success_count,
        'duration': duration,
        'miners_data': miners_data
    }
