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
    Detect if miner is SCRYPT-based with proper regex matching.
    
    Args:
        model: Miner model string
        algorithm_override: Explicit algorithm from config ('sha256' or 'scrypt')
    
    Returns:
        True if SCRYPT miner, False if SHA-256
    """
    # Explicit override takes precedence
    if algorithm_override:
        return algorithm_override.lower() == 'scrypt'
    
    model_lower = model.lower()
    
    # Use word-boundary regex to avoid false positives like VL30 matching 'l3'
    import re
    scrypt_patterns = [
        r'\bdg1\b',      # ElphaPex DG1 (word boundary)
        r'\bl3\+?\b',    # Antminer L3, L3+ (word boundary, optional +)
        r'\bl7\b',       # Antminer L7 (word boundary)
        r'scrypt',       # Explicit SCRYPT mention
        r'litecoin',     # Litecoin miners
        r'doge',         # Dogecoin miners
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
    """Check which metrics are missing from PyASIC data"""
    gaps = {'power': False, 'rejected': False, 'temperature': False}
    
    hashrate = _safe_float(pyasic_data.get('hashrate', 0))
    power = _safe_float(pyasic_data.get('power', 0))
    temperature = _safe_float(pyasic_data.get('temperature', 0))
    
    if not power or power == 0:
        if 'antminer' in model.lower() or 's19' in model.lower() or 's17' in model.lower():
            gaps['power'] = True
        elif hashrate > 0:
            gaps['power'] = True
    
    pools = pyasic_data.get('pools', [])
    if pools:
        total_rejected = sum(getattr(p, 'rejected', 0) or 0 for p in pools)
        total_accepted = sum(getattr(p, 'accepted', 0) or 0 for p in pools)
        if total_accepted > 100 and total_rejected == 0:
            if 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower():
                gaps['rejected'] = True
    
    if not temperature or temperature == 0:
        if hashrate > 0:
            gaps['temperature'] = True
    
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
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(response_str)
            return obj
    except Exception:
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
        logger.debug(f"Filled temperature gap: {cgminer_data['temperature']}°C from cgminer")
    
    return merged


def _update_metrics(data: Dict, ip: str, name: str, model: str, scrape_status: int = 2, algorithm: str = None):
    """Update Prometheus metrics"""
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
    
    miner_scrape_status.labels(ip=ip, name=name, model=model).set(scrape_status)
    miner_state.labels(ip=ip, name=name, model=model).set(state)
    
    if is_scrypt:
        miner_hashrate_mhs.labels(ip=ip, name=name, model=model).set(hashrate)
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate / 1000000.0)
    else:
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate)
    
    power = float(data.get('power', 0) or 0)
    temperature = float(data.get('temperature', 0) or 0)
    uptime = float(data.get('uptime', 0) or 0)
    
    miner_power.labels(ip=ip, name=name, model=model).set(power)
    miner_temp_max.labels(ip=ip, name=name, model=model).set(temperature)
    miner_is_mining.labels(ip=ip, name=name, model=model).set(1 if is_mining else 0)
    miner_uptime.labels(ip=ip, name=name, model=model).set(uptime)
    
    efficiency_raw = data.get('efficiency', 0) or 0
    efficiency = float(efficiency_raw) if efficiency_raw else 0.0
    if is_scrypt:
        efficiency = 0.0
    elif efficiency == 0 and hashrate > 0 and power > 0:
        efficiency = power / hashrate if hashrate > 0 else 0
    miner_efficiency.labels(ip=ip, name=name, model=model).set(efficiency)
    
    miner_fault_light.labels(ip=ip, name=name, model=model).set(1 if data.get('fault_light') else 0)
    
    errors = data.get('errors', [])
    miner_errors_count.labels(ip=ip, name=name, model=model).set(len(errors) if errors else 0)
    
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
        
        miner_pool_accepted.labels(ip=ip, name=name, model=model).set(total_accepted)
        miner_pool_rejected.labels(ip=ip, name=name, model=model).set(total_rejected)
    
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


async def collect_pyasic_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Batch collection with gap filling"""
    logger.info("Starting batch collection with gap filling...")
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
                    return {'error': 'no_miner_object', 'error_type': 'other'}
                
                data = await asyncio.wait_for(miner_obj.get_data(), timeout=15)
                if not data:
                    return {'error': 'no_data', 'error_type': 'other'}
                
                def _normalize_list(val):
                    if val is None:
                        return []
                    if isinstance(val, (list, tuple)):
                        return list(val)
                    return [val] if val else []
                
                pyasic_data = {
                    'hashrate': _safe_float(data.hashrate),
                    'power': _safe_float(data.wattage),
                    'temperature': _safe_float(_get_max_temp(data)),
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
    
    miners_with_gaps = []
    for i, result in enumerate(pyasic_results):
        if result and result.get('has_gaps'):
            miners_with_gaps.append({
                'index': i,
                'miner': miners[i],
                'gaps': result['gaps'],
                'pyasic_data': result['data']
            })
    
    if miners_with_gaps:
        logger.info(f"Filling gaps for {len(miners_with_gaps)} miners...")
        
        async def collect_cgminer_one(gap_info: Dict):
            async with sem:
                miner = gap_info['miner']
                ip = miner['ip']
                api_port = miner.get('api_port', 4028)
                
                try:
                    stats = await _cgminer_command(ip, "stats", api_port)
                    summary = await _cgminer_command(ip, "summary", api_port)
                    pools = await _cgminer_command(ip, "pools", api_port)
                    devs = await _cgminer_command(ip, "devs", api_port)
                    
                    if not devs and not summary:
                        return None
                    
                    # Pass model for unit sanity checking
                    cgminer_data = parse_cgminer_response(stats, summary, pools, devs, miner['model'])
                    cgminer_data['_board_temps_raw'] = cgminer_data.get('board_temps', [])
                    return cgminer_data
                except Exception as e:
                    logger.debug(f"cgminer failed for {ip}: {e}")
                    return None
        
        tasks = [collect_cgminer_one(gap_info) for gap_info in miners_with_gaps]
        cgminer_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, cgminer_result in enumerate(cgminer_results):
            if cgminer_result:
                gap_info = miners_with_gaps[i]
                board_temps_raw = cgminer_result.pop('_board_temps_raw', [])
                merged = _merge_data(
                    gap_info['pyasic_data'],
                    cgminer_result,
                    gap_info['gaps'],
                    board_temps_raw
                )
                pyasic_results[gap_info['index']]['data'] = merged
                pyasic_results[gap_info['index']]['method'] = 'merged'
    
    success_count = 0
    miners_data = []
    
    for i, result in enumerate(pyasic_results):
        miner = miners[i]
        if result and result.get('data'):
            data = result['data']
            method = result.get('method', 'pyasic')
            has_gaps = result.get('has_gaps', False)
            
            if method == 'merged':
                scrape_status = 2
            elif has_gaps:
                scrape_status = 1
            else:
                scrape_status = 2
            
            _update_metrics(data, miner['ip'], miner['name'], miner['model'], scrape_status, miner.get('algorithm'))
            success_count += 1
            
            hashrate_val = _safe_float(data.get('hashrate', 0))
            miner_data = {
                'ip': miner['ip'],
                'name': miner['name'],
                'model': miner['model'],
                'hashrate': hashrate_val,
                'power': _safe_float(data.get('power', 0)),
                'temp_max': _safe_float(data.get('temperature', 0)),
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
            
            pools = data.get('pools', [])
            if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
                first_pool = pools[0]
                if hasattr(first_pool, 'accepted'):
                    miner_data['pool_accepted'] = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
                    miner_data['pool_rejected'] = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
                elif isinstance(first_pool, dict):
                    miner_data['pool_accepted'] = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
                    miner_data['pool_rejected'] = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
            
            miners_data.append(miner_data)
        else:
            error_type = result.get('error_type', 'other') if result else 'other'
            if error_type == 'timeout':
                scrape_status = 0
            elif error_type == 'refused':
                scrape_status = -1
            else:
                scrape_status = -2
            
            miner_scrape_status.labels(ip=miner['ip'], name=miner['name'], model=miner['model']).set(scrape_status)
            miner_state.labels(ip=miner['ip'], name=miner['name'], model=miner['model']).set(0)
            
            miners_data.append({
                'ip': miner['ip'],
                'name': miner['name'],
                'model': miner['model'],
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
            })
    
    duration = time.time() - start_time
    
    collection_duration.labels(collector='hybrid').set(duration)
    collection_success.labels(collector='hybrid').set(1 if success_count > 0 else 0)
    collection_timestamp.labels(collector='hybrid').set(time.time())
    
    logger.info(f"✓ Batch collection: {success_count}/{len(miners)} miners in {duration:.1f}s")
    logger.info(f"  Miners with gaps filled: {len(miners_with_gaps)}")
    
    return {
        'success': True,
        'miners_collected': success_count,
        'duration': duration,
        'gaps_filled': len(miners_with_gaps),
        'miners_data': miners_data
    }
