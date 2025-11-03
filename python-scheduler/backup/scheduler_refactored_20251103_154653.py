#!/usr/bin/env python3
"""
Mining Metrics Collector Service - V2 Architecture
Serves Prometheus metrics directly from memory, eliminating Node Exporter dependency

Features:
- Direct /metrics endpoint for Prometheus scraping
- In-memory metric storage using prometheus-client
- Background scheduled collection
- Full API compatibility with V1
"""

import os
import sys
import time
import logging
import asyncio
import threading
from datetime import datetime
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import yaml
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import Response
import uvicorn

# Prometheus client
from prometheus_client import Gauge, Counter, generate_latest, REGISTRY

# Import collector modules
from pyasic import get_miner
import aiohttp
import socket
import subprocess
import re
import json

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Configuration
MINERS_CONFIG = os.getenv('MINERS_CONFIG', '/app/etc/miners.yaml')
COLLECTION_INTERVAL = int(os.getenv('COLLECTION_INTERVAL', '2'))  # minutes
ENABLE_ICMP_PING = os.getenv('ENABLE_ICMP_PING', 'false').lower() == 'true'
MAX_CONCURRENT_REQUESTS = 5
BACKEND_URL = os.getenv('BACKEND_URL', 'http://backend:5000')
PUSH_TO_BACKEND = os.getenv('PUSH_TO_BACKEND', 'true').lower() == 'true'

# Collection lock to prevent concurrent collections
collection_lock = asyncio.Lock()

# ============================================================================
# PROMETHEUS METRICS DEFINITIONS (In-Memory)
# ============================================================================

# Miner General Metrics
miner_hashrate = Gauge('miner_hashrate_ths', 'Miner hashrate in TH/s', ['ip', 'name', 'model'])
miner_power = Gauge('miner_power_watts', 'Miner power consumption in watts', ['ip', 'name', 'model'])
miner_temp_max = Gauge('miner_temp_max_c', 'Maximum temperature in Celsius', ['ip', 'name', 'model'])
miner_is_mining = Gauge('miner_is_mining', 'Mining status (1=mining, 0=not mining)', ['ip', 'name', 'model'])
miner_uptime = Gauge('miner_uptime_seconds', 'Miner uptime in seconds', ['ip', 'name', 'model'])
miner_efficiency = Gauge('miner_efficiency_j_th', 'Miner efficiency in J/TH', ['ip', 'name', 'model'])
miner_fault_light = Gauge('miner_fault_light_on', 'Fault light status (1=on, 0=off)', ['ip', 'name', 'model'])
miner_errors_count = Gauge('miner_errors_count', 'Number of errors', ['ip', 'name', 'model'])
miner_scrape_status = Gauge('miner_scrape_status', 'Scrape status (2=success, 1=partial, 0=timeout, -1=refused, -2=error)', ['ip', 'name', 'model'])

# Miner Board Metrics
miner_board_hashrate = Gauge('miner_board_hashrate_ths', 'Board hashrate in TH/s', ['ip', 'name', 'model', 'slot'])
miner_board_temp = Gauge('miner_board_temp_c', 'Board temperature in Celsius', ['ip', 'name', 'model', 'slot'])
miner_board_chips_count = Gauge('miner_board_chips_count', 'Number of chips detected', ['ip', 'name', 'model', 'slot'])
miner_board_chips_expected = Gauge('miner_board_chips_expected', 'Expected number of chips', ['ip', 'name', 'model', 'slot'])

# Miner Fan Metrics
miner_fan_speed = Gauge('miner_fan_speed_rpm', 'Fan speed in RPM', ['ip', 'name', 'model', 'fan_id'])

# Miner Pool Metrics
miner_pool_accepted = Gauge('miner_pool_accepted_total', 'Total accepted shares', ['ip', 'name', 'model'])
miner_pool_rejected = Gauge('miner_pool_rejected_total', 'Total rejected shares', ['ip', 'name', 'model'])

# Pool Network Quality Metrics
pool_network_reachable = Gauge('pool_network_reachable', 'Pool reachability (1=reachable, 0=unreachable)', ['pool', 'port'])
pool_network_dns_resolved = Gauge('pool_network_dns_resolved', 'DNS resolution status (1=success, 0=failure)', ['pool', 'port'])
pool_network_connect_time = Gauge('pool_network_connect_time_ms', 'TCP connection time in milliseconds', ['pool', 'port'])
pool_network_ping_avg = Gauge('pool_network_ping_avg_ms', 'Average ping latency in milliseconds', ['pool', 'port'])
pool_network_ping_min = Gauge('pool_network_ping_min_ms', 'Minimum ping latency in milliseconds', ['pool', 'port'])
pool_network_ping_max = Gauge('pool_network_ping_max_ms', 'Maximum ping latency in milliseconds', ['pool', 'port'])
pool_network_packet_loss = Gauge('pool_network_packet_loss_percent', 'Packet loss percentage', ['pool', 'port'])

# Collection Metrics
collection_duration = Gauge('mining_collection_duration_seconds', 'Time taken for collection', ['collector'])
collection_success = Gauge('mining_collection_success', 'Collection success status', ['collector'])
collection_timestamp = Gauge('mining_collection_timestamp_seconds', 'Last collection timestamp', ['collector'])

# Miner State Metrics (NEW)
miner_state = Gauge('miner_state', 'Miner state (0=faulty, 1=idle, 2=mining)', ['ip', 'name', 'model'])
miner_hashrate_mhs = Gauge('miner_hashrate_mhs', 'Miner hashrate in MH/s (SCRYPT)', ['ip', 'name', 'model'])

# Gap-filling observability
miner_gaps_filled_total = Counter('miner_gaps_filled_total', 'Count of gaps filled by CGMiner', ['type'])

# ============================================================================
# DATA COLLECTION FUNCTIONS
# ============================================================================

# Helper functions for gap detection and merging

def _is_scrypt_miner(model: str) -> bool:
    """Detect if miner is SCRYPT-based"""
    model_lower = model.lower()
    scrypt_keywords = ['dg1', 'l3', 'l7', 'scrypt', 'litecoin', 'doge']
    return any(keyword in model_lower for keyword in scrypt_keywords)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """
    Safely convert value to float, handling PyASIC custom types, None, NaN, and invalid data.
    PyASIC returns custom objects like SHA256HashRate that need conversion.
    """
    if value is None:
        return default
    
    try:
        # Handle PyASIC custom types (SHA256HashRate, etc.)
        if hasattr(value, '__float__'):
            x = float(value)
        elif isinstance(value, (int, float)):
            x = float(value)
        else:
            # Try to extract numeric value from string or other types
            x = float(value)
        
        # Check for NaN (x != x is True for NaN)
        return default if x != x else x
    except (TypeError, ValueError, AttributeError):
        return default


def _check_data_gaps(pyasic_data: Dict, model: str) -> Dict[str, bool]:
    """
    Check which metrics are missing from PyASIC data
    Returns dict of gaps: {'power': True, 'rejected': True, ...}
    """
    gaps = {
        'power': False,
        'rejected': False,
        'temperature': False,
    }
    
    # Safely convert hashrate for comparisons (handles PyASIC SHA256HashRate objects)
    hashrate = _safe_float(pyasic_data.get('hashrate', 0))
    power = _safe_float(pyasic_data.get('power', 0))
    temperature = _safe_float(pyasic_data.get('temperature', 0))
    
    # Check power (common issue with Antminers)
    if not power or power == 0:
        # Antminers never report power via PyASIC
        if 'antminer' in model.lower() or 's19' in model.lower() or 's17' in model.lower():
            gaps['power'] = True
        elif hashrate > 0:  # Mining but no power = gap
            gaps['power'] = True
    
    # Check rejected shares (common issue with Whatsminers)
    pools = pyasic_data.get('pools', [])
    if pools:
        total_rejected = sum(getattr(p, 'rejected', 0) or 0 for p in pools)
        total_accepted = sum(getattr(p, 'accepted', 0) or 0 for p in pools)
        # If mining with accepted shares but 0 rejected, likely missing data
        if total_accepted > 100 and total_rejected == 0:
            if 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower():
                gaps['rejected'] = True
    
    # Check temperature
    if not temperature or temperature == 0:
        if hashrate > 0:  # Mining but no temp = gap
            gaps['temperature'] = True
    
    return gaps


def _get_max_temp(data) -> float:
    """Get max temperature from PyASIC data"""
    if not data or not hasattr(data, 'hashboards'):
        return 0.0
    
    hashboards = data.hashboards
    # Defensive: ensure hashboards is iterable (list/tuple), not scalar
    if not isinstance(hashboards, (list, tuple)) or not hashboards:
        return 0.0
    
    all_temps = [b.chip_temp for b in hashboards if hasattr(b, 'chip_temp') and b.chip_temp is not None] + \
                [b.temp for b in hashboards if hasattr(b, 'temp') and b.temp is not None]
    
    return max(all_temps) if all_temps else 0.0


async def _cgminer_command(ip: str, command: str, port: int = 4028) -> Optional[Dict]:
    """Send cgminer API command with newline terminator"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=10.0
        )
        
        cmd = json.dumps({"command": command})
        writer.write((cmd + "\n").encode())
        await writer.drain()
        
        data = await asyncio.wait_for(reader.read(65536), timeout=10.0)
        writer.close()
        await writer.wait_closed()
        
        # Parse JSON (handle Antminer's multiple responses)
        response_str = data.decode().strip('\x00')
        try:
            return json.loads(response_str)
        except json.JSONDecodeError:
            # Try to extract first JSON object
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(response_str)
            return obj
            
    except Exception:
        return None


def _parse_cgminer_response(stats: Optional[Dict], summary: Optional[Dict], pools: Optional[Dict], devs: Optional[Dict], is_scrypt: bool) -> Dict:
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


def _merge_data(pyasic_data: Dict, cgminer_data: Dict, gaps: Dict[str, bool], cgminer_board_temps: List[float]) -> Dict:
    """Merge PyASIC and cgminer data, using cgminer to fill gaps"""
    merged = pyasic_data.copy()
    
    # Fill power gap (Antminers)
    if gaps.get('power') and cgminer_data.get('power', 0) > 0:
        merged['power'] = cgminer_data['power']
        miner_gaps_filled_total.labels(type='power').inc()
        logger.debug(f"Filled power gap: {cgminer_data['power']}W from cgminer")
    
    # Fill rejected shares gap (Whatsminers)
    if gaps.get('rejected'):
        cgminer_pools = cgminer_data.get('pools', [])
        if cgminer_pools:
            total_rejected = sum(p.get('rejected', 0) for p in cgminer_pools)
            if total_rejected > 0:
                miner_gaps_filled_total.labels(type='rejected').inc()
            # Replace pool data with cgminer's more complete data
            merged['pools'] = cgminer_pools
            logger.debug(f"Filled rejected shares gap: {total_rejected} from cgminer")
    
    # Fill temperature gap
    if gaps.get('temperature') and cgminer_data.get('temperature', 0) > 0:
        merged['temperature'] = cgminer_data['temperature']
        merged['cgminer_board_temps'] = cgminer_board_temps
        miner_gaps_filled_total.labels(type='temperature').inc()
        logger.debug(f"Filled temperature gap: {cgminer_data['temperature']}°C from cgminer")
    
    return merged


async def collect_pyasic_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """
    Batch collection with gap filling
    Prometheus will timestamp all metrics when it scrapes /metrics
    """
    logger.info("Starting batch collection with gap filling...")
    start_time = time.time()
    
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    # Step 1: Batch collect PyASIC from ALL miners
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
                
                # Convert to dict with safe float conversion for PyASIC custom types
                # Normalize collections to lists (defensive against scalars/None)
                def _normalize_list(val):
                    """Ensure value is a list, not scalar/None"""
                    if val is None:
                        return []
                    if isinstance(val, (list, tuple)):
                        return list(val)
                    # Scalar or other non-iterable: wrap in list or return empty
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
                
                # Check for gaps
                gaps = _check_data_gaps(pyasic_data, model)
                
                return {
                    'data': pyasic_data,
                    'has_gaps': any(gaps.values()),
                    'gaps': gaps,
                    'method': 'pyasic'
                }
                
            except asyncio.TimeoutError:
                logger.warning(f"⏱️  Timeout collecting from {name} ({ip}) - miner may be hung or network issue")
                return {'error': 'timeout', 'error_type': 'timeout', 'error_detail': 'Connection timed out after 15s'}
            except ConnectionRefusedError:
                logger.warning(f"🚫 Connection refused by {name} ({ip}) - API may be disabled")
                return {'error': 'connection_refused', 'error_type': 'refused', 'error_detail': 'Miner API is disabled or port blocked'}
            except OSError as e:
                if 'refused' in str(e).lower():
                    logger.warning(f"🚫 Connection refused by {name} ({ip}): {e}")
                    return {'error': 'connection_refused', 'error_type': 'refused', 'error_detail': str(e)}
                logger.warning(f"⚠️  OS error collecting from {name} ({ip}): {e}")
                return {'error': str(e), 'error_type': 'other', 'error_detail': f'OS error: {e}'}
            except TypeError as e:
                # Catch PyASIC type comparison errors (SHA256HashRate vs int, etc.)
                logger.error(f"❌ Type error collecting from {name} ({ip}): {e}")
                logger.error(f"   This is likely a PyASIC custom type issue - check _safe_float() usage")
                return {'error': str(e), 'error_type': 'other', 'error_detail': f'TypeError: {e}'}
            except Exception as e:
                # Catch PyASIC APIError and other exceptions
                error_name = type(e).__name__
                if 'APIError' in error_name:
                    logger.warning(f"⚠️  API error from {name} ({ip}): {e}")
                    return {'error': str(e), 'error_type': 'api_error', 'error_detail': f'{error_name}: {e}'}
                logger.error(f"❌ Unexpected error collecting from {name} ({ip}): {error_name}: {e}")
                return {'error': str(e), 'error_type': 'other', 'error_detail': f'{error_name}: {e}'}
    
    # Collect from all miners in parallel
    tasks = [collect_pyasic_one(miner) for miner in miners]
    pyasic_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Step 2: Identify miners with gaps
    miners_with_gaps = []
    for i, result in enumerate(pyasic_results):
        if result and result.get('has_gaps'):
            miners_with_gaps.append({
                'index': i,
                'miner': miners[i],
                'gaps': result['gaps'],
                'pyasic_data': result['data']
            })
    
    # Step 3: Batch collect cgminer ONLY for miners with gaps
    if miners_with_gaps:
        logger.info(f"Filling gaps for {len(miners_with_gaps)} miners...")
        
        async def collect_cgminer_one(gap_info: Dict):
            async with sem:
                miner = gap_info['miner']
                ip = miner['ip']
                api_port = miner.get('api_port', 4028)
                
                try:
                    # Collect all commands, accepting partial responses
                    stats = await _cgminer_command(ip, "stats", api_port)
                    summary = await _cgminer_command(ip, "summary", api_port)
                    pools = await _cgminer_command(ip, "pools", api_port)
                    devs = await _cgminer_command(ip, "devs", api_port)
                    
                    # Accept partial responses - only require devs or summary
                    if not devs and not summary:
                        return None
                    
                    is_scrypt = _is_scrypt_miner(miner['model'])
                    cgminer_data = _parse_cgminer_response(stats, summary, pools, devs, is_scrypt)
                    
                    # Return both parsed data and raw board temps for per-board metrics
                    cgminer_data['_board_temps_raw'] = cgminer_data.get('board_temps', [])
                    return cgminer_data
                    
                except Exception as e:
                    logger.debug(f"cgminer failed for {ip}: {e}")
                    return None
        
        tasks = [collect_cgminer_one(gap_info) for gap_info in miners_with_gaps]
        cgminer_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Step 4: Merge results
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
    
    # Step 5: Update ALL metrics (Prometheus will add timestamp when it scrapes)
    # Also prepare clean data for backend push
    success_count = 0
    miners_data = []
    
    for i, result in enumerate(pyasic_results):
        miner = miners[i]
        if result and result.get('data'):
            data = result['data']
            
            # Determine scrape status
            # 2 = Full success (with or without gap-filling)
            # 1 = Partial success (PyASIC worked but gap-fill failed)
            method = result.get('method', 'pyasic')
            has_gaps = result.get('has_gaps', False)
            
            if method == 'merged':
                scrape_status = 2  # Full success with gap-filling
            elif has_gaps:
                scrape_status = 1  # Partial success (gaps not filled)
            else:
                scrape_status = 2  # Full success
            
            # Update Prometheus metrics
            _update_metrics(
                data,
                miner['ip'],
                miner['name'],
                miner['model'],
                scrape_status
            )
            success_count += 1
            
            # Prepare clean data for backend (using collected data, not gauge internals)
            # Use _safe_float to handle PyASIC custom types
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
            
            # Add pool stats if available (defensive: check list and non-empty)
            pools = data.get('pools', [])
            if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
                first_pool = pools[0]
                if hasattr(first_pool, 'accepted'):
                    # PyASIC pool objects
                    miner_data['pool_accepted'] = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
                    miner_data['pool_rejected'] = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
                elif isinstance(first_pool, dict):
                    # Dict pool data from cgminer
                    miner_data['pool_accepted'] = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
                    miner_data['pool_rejected'] = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
            
            miners_data.append(miner_data)
        else:
            # Determine failure type from error_type
            error_type = result.get('error_type', 'other') if result else 'other'
            
            if error_type == 'timeout':
                scrape_status = 0  # Timeout
            elif error_type == 'refused':
                scrape_status = -1  # Connection refused (API disabled)
            else:
                scrape_status = -2  # Other error
            
            # Mark as failed with descriptive status
            miner_scrape_status.labels(ip=miner['ip'], name=miner['name'], model=miner['model']).set(scrape_status)
            miner_state.labels(ip=miner['ip'], name=miner['name'], model=miner['model']).set(0)
            
            # Add failed miner to data with zeros
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
    
    # Count failure types for diagnostic logging
    timeout_count = sum(1 for m in miners_data if m.get('scrape_status') == 0)
    refused_count = sum(1 for m in miners_data if m.get('scrape_status') == -1)
    error_count = sum(1 for m in miners_data if m.get('scrape_status') == -2)
    partial_count = sum(1 for m in miners_data if m.get('scrape_status') == 1)
    
    logger.info(f"✓ Batch collection: {success_count}/{len(miners)} miners in {duration:.1f}s")
    logger.info(f"  Miners with gaps filled: {len(miners_with_gaps)}")
    
    if timeout_count > 0 or refused_count > 0 or error_count > 0:
        logger.warning(f"  Failed miners breakdown:")
        if timeout_count > 0:
            logger.warning(f"    ⏱️  Timeouts: {timeout_count}")
        if refused_count > 0:
            logger.warning(f"    🚫 Connection refused: {refused_count}")
        if error_count > 0:
            logger.warning(f"    ❌ Other errors: {error_count}")
    
    if partial_count > 0:
        logger.info(f"  ⚠️  Partial success (gaps not filled): {partial_count}")
    
    return {
        'success': True,
        'miners_collected': success_count,
        'duration': duration,
        'gaps_filled': len(miners_with_gaps),
        'miners_data': miners_data  # Clean collected data for backend push
    }


def _update_metrics(data: Dict, ip: str, name: str, model: str, scrape_status: int = 2):
    """Update Prometheus metrics (Prometheus adds timestamp when scraping)"""
    is_scrypt = _is_scrypt_miner(model)
    model = model.replace(" ", "_")
    
    # Determine state
    # Convert hashrate to float (handles both pyasic objects and plain numbers)
    hashrate_raw = data.get('hashrate', 0) or 0
    hashrate = float(hashrate_raw) if hashrate_raw else 0.0
    is_mining = data.get('is_mining', True)
    
    if hashrate == 0 and not is_mining:
        state = 1  # idle
    elif hashrate > 0:
        state = 2  # mining
    else:
        state = 0  # faulty
    
    # Update metrics with descriptive scrape status
    miner_scrape_status.labels(ip=ip, name=name, model=model).set(scrape_status)
    miner_state.labels(ip=ip, name=name, model=model).set(state)
    
    # Hashrate (handle SCRYPT vs SHA-256)
    if is_scrypt:
        miner_hashrate_mhs.labels(ip=ip, name=name, model=model).set(hashrate)
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate / 1000000.0)
    else:
        miner_hashrate.labels(ip=ip, name=name, model=model).set(hashrate)
    
    # Convert all numeric values to float to handle pyasic objects
    power = float(data.get('power', 0) or 0)
    temperature = float(data.get('temperature', 0) or 0)
    uptime = float(data.get('uptime', 0) or 0)
    
    miner_power.labels(ip=ip, name=name, model=model).set(power)
    miner_temp_max.labels(ip=ip, name=name, model=model).set(temperature)
    miner_is_mining.labels(ip=ip, name=name, model=model).set(1 if is_mining else 0)
    miner_uptime.labels(ip=ip, name=name, model=model).set(uptime)
    
    # Efficiency
    # SCRYPT miners: keep efficiency at 0.0 (no J/TH metric for SCRYPT)
    efficiency_raw = data.get('efficiency', 0) or 0
    efficiency = float(efficiency_raw) if efficiency_raw else 0.0
    power = float(data.get('power', 0) or 0)
    if is_scrypt:
        efficiency = 0.0  # Do not calculate J/TH for SCRYPT
    elif efficiency == 0 and hashrate > 0 and power > 0:
        efficiency = power / hashrate if hashrate > 0 else 0
    miner_efficiency.labels(ip=ip, name=name, model=model).set(efficiency)
    
    miner_fault_light.labels(ip=ip, name=name, model=model).set(1 if data.get('fault_light') else 0)
    
    errors = data.get('errors', [])
    miner_errors_count.labels(ip=ip, name=name, model=model).set(len(errors) if errors else 0)
    
    # Fans
    fans = data.get('fans', [])
    if fans:
        for i, fan in enumerate(fans):
            if hasattr(fan, 'speed'):
                miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id=str(i)).set(fan.speed or 0)
    
    fan_psu = data.get('fan_psu', [])
    if fan_psu and isinstance(fan_psu, (list, tuple)) and len(fan_psu) > 0:
        if hasattr(fan_psu[0], 'speed'):
            miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id='psu').set(fan_psu[0].speed or 0)
    
    # Pools (defensive: check if list and non-empty before indexing)
    pools = data.get('pools', [])
    if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
        # Detect type by checking first element safely
        first_pool = pools[0]
        if hasattr(first_pool, 'accepted'):
            # PyASIC pool objects
            total_accepted = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
            total_rejected = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
        elif isinstance(first_pool, dict):
            # Dict pool data from cgminer
            total_accepted = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
            total_rejected = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
        else:
            # Unknown format, skip
            total_accepted = 0
            total_rejected = 0
        
        miner_pool_accepted.labels(ip=ip, name=name, model=model).set(total_accepted)
        miner_pool_rejected.labels(ip=ip, name=name, model=model).set(total_rejected)
    
    # Hashboards (defensive: check if list and non-empty before indexing)
    # If PyASIC hashboards are absent but we have CGMiner board temps, publish them
    cgminer_board_temps = data.get('cgminer_board_temps', [])
    if cgminer_board_temps and isinstance(cgminer_board_temps, list):
        for slot_idx, temp in enumerate(cgminer_board_temps):
            if temp > 0:
                slot = str(slot_idx)
                miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(temp)
    
    hashboards = data.get('hashboards', [])
    if hashboards and isinstance(hashboards, (list, tuple)) and len(hashboards) > 0:
        # Only iterate if first element has expected structure
        if hasattr(hashboards[0], 'slot'):
            for board in hashboards:
                if not hasattr(board, 'slot'):
                    continue  # Skip malformed boards
                slot = str(board.slot)
                miner_board_hashrate.labels(ip=ip, name=name, model=model, slot=slot).set(board.hashrate or 0)
                
                board_temp = board.chip_temp if board.chip_temp is not None else (board.temp or 0)
                miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(board_temp)
                
                if hasattr(board, 'chips'):
                    miner_board_chips_count.labels(ip=ip, name=name, model=model, slot=slot).set(board.chips or 0)
                if hasattr(board, 'expected_chips'):
                    miner_board_chips_expected.labels(ip=ip, name=name, model=model, slot=slot).set(board.expected_chips or 0)


async def collect_pool_network_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Collect pool network quality metrics"""
    logger.info("Starting pool network collection...")
    start_time = time.time()
    
    # Discover pools from miners
    pools = set()
    
    async def get_miner_pools(ip: str):
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, 4028),
                timeout=5.0
            )
            
            command = json.dumps({"command": "pools"})
            writer.write(command.encode())
            await writer.drain()
            
            data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
            writer.close()
            await writer.wait_closed()
            
            response = json.loads(data.decode().strip('\x00'))
            
            miner_pools = []
            if 'POOLS' in response:
                for pool in response['POOLS']:
                    url = pool.get('URL', '')
                    if url:
                        # Parse pool URL
                        url = re.sub(r'^(stratum\+tcp|stratum\+ssl|stratum)://', '', url)
                        if ':' in url:
                            hostname, port_str = url.rsplit(':', 1)
                            port_str = port_str.split('/')[0]
                            miner_pools.append((hostname, int(port_str)))
            
            return miner_pools
        except Exception:
            return []
    
    # Discover pools
    tasks = [get_miner_pools(miner['ip']) for miner in miners]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for pool_list in results:
        if isinstance(pool_list, list):
            pools.update(pool_list)
    
    logger.info(f"Discovered {len(pools)} unique pools")
    
    # Test each pool
    async def test_pool(hostname: str, port: int):
        # Ping test
        if ENABLE_ICMP_PING:
            try:
                result = subprocess.run(
                    ['ping', '-c', '5', '-W', '2', hostname],
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                
                output = result.stdout
                
                # Parse packet loss
                packet_loss = 100.0
                loss_match = re.search(r'(\d+)% packet loss', output)
                if loss_match:
                    packet_loss = float(loss_match.group(1))
                
                # Parse RTT statistics
                ping_avg = 0.0
                ping_min = 0.0
                ping_max = 0.0
                rtt_match = re.search(r'rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)', output)
                if rtt_match:
                    ping_min = float(rtt_match.group(1))
                    ping_avg = float(rtt_match.group(2))
                    ping_max = float(rtt_match.group(3))
                
                pool_network_ping_avg.labels(pool=hostname, port=str(port)).set(ping_avg)
                pool_network_ping_min.labels(pool=hostname, port=str(port)).set(ping_min)
                pool_network_ping_max.labels(pool=hostname, port=str(port)).set(ping_max)
                pool_network_packet_loss.labels(pool=hostname, port=str(port)).set(packet_loss)
                
            except Exception as e:
                logger.debug(f"Ping failed for {hostname}: {e}")
                pool_network_packet_loss.labels(pool=hostname, port=str(port)).set(100.0)
        else:
            # ICMP disabled - report 0 packet loss and rely on TCP connect times
            pool_network_packet_loss.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_avg.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_min.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_max.labels(pool=hostname, port=str(port)).set(0.0)
        
        # TCP connection test
        try:
            start = time.time()
            
            # DNS resolution
            try:
                socket.gethostbyname(hostname)
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(1)
            except socket.gaierror:
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(0)
                pool_network_reachable.labels(pool=hostname, port=str(port)).set(0)
                pool_network_connect_time.labels(pool=hostname, port=str(port)).set(0)
                return
            
            # TCP connection
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(hostname, port),
                timeout=5.0
            )
            
            connect_time = (time.time() - start) * 1000  # ms
            
            writer.close()
            await writer.wait_closed()
            
            pool_network_reachable.labels(pool=hostname, port=str(port)).set(1)
            pool_network_connect_time.labels(pool=hostname, port=str(port)).set(connect_time)
            
        except asyncio.TimeoutError:
            pool_network_reachable.labels(pool=hostname, port=str(port)).set(0)
            pool_network_connect_time.labels(pool=hostname, port=str(port)).set(5000.0)
        except Exception as e:
            logger.debug(f"Connection failed for {hostname}:{port}: {e}")
            pool_network_reachable.labels(pool=hostname, port=str(port)).set(0)
            pool_network_connect_time.labels(pool=hostname, port=str(port)).set(0)
    
    if pools:
        tasks = [test_pool(hostname, port) for hostname, port in pools]
        await asyncio.gather(*tasks, return_exceptions=True)
    
    duration = time.time() - start_time
    collection_duration.labels(collector='pool_network').set(duration)
    collection_success.labels(collector='pool_network').set(1)
    collection_timestamp.labels(collector='pool_network').set(time.time())
    
    logger.info(f"✓ Pool network collection complete: {len(pools)} pools in {duration:.1f}s")
    return {'success': True, 'pools_tested': len(pools), 'duration': duration}


# ============================================================================
# COLLECTION ORCHESTRATION
# ============================================================================

last_collection = {
    'timestamp': None,
    'success': False,
    'message': '',
    'details': {}
}

# Failure streak tracking (per miner)
failure_streaks = {}  # {(ip, name, model): consecutive_failures}
FAILURE_THRESHOLD = 5

# Cache miners config at startup
miners_config_cache = None
last_config_load = 0
CONFIG_CACHE_TTL = 300  # 5 minutes


def load_miners_config() -> List[Dict]:
    """Load miners configuration with caching"""
    global miners_config_cache, last_config_load
    
    current_time = time.time()
    if miners_config_cache and (current_time - last_config_load) < CONFIG_CACHE_TTL:
        return miners_config_cache
    
    config_path = Path(MINERS_CONFIG)
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    miners = config.get('miners', [])
    
    # Ensure each miner has a 'name' field (use alias or IP as fallback)
    for miner in miners:
        if 'name' not in miner:
            if 'alias' in miner:
                miner['name'] = miner['alias']
            else:
                miner['name'] = f"miner-{miner['ip'].replace('.', '-')}"
    
    miners_config_cache = miners
    last_config_load = current_time
    return miners_config_cache


async def push_metrics_to_backend(miners_data: List[Dict], collection_info: Dict):
    """Push collected metrics to backend for real-time UI updates (async)"""
    if not PUSH_TO_BACKEND:
        return
    
    try:
        # Prepare payload with collected data
        payload = {
            'miners': miners_data,
            'timestamp': int(time.time() * 1000),  # milliseconds
            'collection_info': collection_info if isinstance(collection_info, dict) else {}
        }
        
        # Use async HTTP client (non-blocking)
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/internal/metrics",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    logger.info(f"✓ Pushed metrics to backend: {len(miners_data)} miners")
                else:
                    text = await response.text()
                    logger.warning(f"Backend push failed: {response.status} - {text}")
            
    except asyncio.TimeoutError:
        logger.warning("Backend push timed out after 5 seconds")
    except Exception as e:
        logger.warning(f"Failed to push metrics to backend: {e}")


async def collect_all_metrics():
    """Collect all metrics and update in-memory gauges (with lock)"""
    global last_collection, failure_streaks
    
    # Try to acquire lock (non-blocking)
    if collection_lock.locked():
        logger.warning("Collection already in progress, skipping this run")
        return {
            'success': False,
            'message': 'Collection already in progress',
            'skipped': True
        }
    
    async with collection_lock:
        try:
            logger.info("=" * 60)
            logger.info(f"Starting metrics collection at {datetime.now()}")
            logger.info("=" * 60)
            
            # Load miners configuration (cached)
            miners = load_miners_config()
            logger.info(f"Found {len(miners)} miners in configuration")
            
            # Collect pyasic metrics (returns collected data + metadata)
            pyasic_result = await collect_pyasic_metrics(miners)
            
            # Extract collected miner data for backend push
            miners_data = pyasic_result.get('miners_data', [])
            
            # Push to backend BEFORE updating Prometheus gauges
            # This uses the clean collected data, not gauge internals
            await push_metrics_to_backend(miners_data, pyasic_result)
            
            # Collect pool network metrics
            pool_result = await collect_pool_network_metrics(miners)
            
            # Update failure streaks and remove stale metrics
            for miner in miners:
                key = (miner['ip'], miner['name'], miner['model'])
                miner_data = next((m for m in miners_data if m['ip'] == miner['ip']), None)
                
                if miner_data and miner_data.get('scrape_status', -2) >= 1:
                    # Success or partial success - reset streak
                    failure_streaks[key] = 0
                else:
                    # Failure - increment streak
                    failure_streaks[key] = failure_streaks.get(key, 0) + 1
                    
                    # Remove metrics after N consecutive failures
                    if failure_streaks[key] >= FAILURE_THRESHOLD:
                        model_normalized = miner['model'].replace(" ", "_")
                        try:
                            miner_scrape_status.remove(miner['ip'], miner['name'], model_normalized)
                            miner_state.remove(miner['ip'], miner['name'], model_normalized)
                        except KeyError:
                            pass
            
            # Update last collection status
            last_collection = {
                'timestamp': datetime.now().isoformat(),
                'success': True,
                'message': 'All collections successful',
                'details': {
                    'pyasic': pyasic_result,
                    'pool_network': pool_result
                }
            }
            
            logger.info("=" * 60)
            logger.info("Collection complete: All collectors successful")
            logger.info("=" * 60)
            
            return last_collection
            
        except Exception as e:
            logger.error(f"Collection error: {e}")
            last_collection = {
                'timestamp': datetime.now().isoformat(),
                'success': False,
                'message': f'Collection failed: {str(e)}',
                'details': {}
            }
            return last_collection


async def scheduler_loop():
    """Async scheduler loop (runs as background task)"""
    logger.info(f"Starting async scheduler loop (interval: {COLLECTION_INTERVAL} minutes)")
    
    # Run initial collection
    logger.info("Running initial metrics collection...")
    await collect_all_metrics()
    
    # Schedule periodic collections
    interval_seconds = COLLECTION_INTERVAL * 60
    
    while True:
        await asyncio.sleep(interval_seconds)
        logger.info(f"Scheduled collection triggered (every {COLLECTION_INTERVAL} minutes)")
        await collect_all_metrics()


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Health check and service info"""
    return {
        "service": "Mining Metrics Collector Service",
        "version": "2.0.0",
        "status": "running",
        "architecture": "direct_prometheus_scraping",
        "collection_interval": f"{COLLECTION_INTERVAL} minutes",
        "last_collection": last_collection.get('timestamp'),
        "endpoints": {
            "metrics": "/metrics (Prometheus scrape endpoint)",
            "health": "/health",
            "status": "/status",
            "jobs": "/jobs (scheduler status)",
            "collect": "/collect (manual trigger)",
            "reload": "/reload (force config reload)"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.get("/status")
async def status():
    """Get collector status"""
    return {
        "last_collection": last_collection,
        "collection_in_progress": collection_lock.locked(),
        "collection_interval_minutes": COLLECTION_INTERVAL,
        "architecture": "v2_in_memory_metrics_with_lock",
        "miners_count": len(miners_config_cache) if miners_config_cache else 0
    }


@app.get("/jobs")
async def jobs():
    """Scheduler status endpoint (minimal)"""
    return {
        "scheduler": "running",
        "collection_interval_minutes": COLLECTION_INTERVAL,
        "last_run": last_collection.get('timestamp'),
        "next_run_in_seconds": COLLECTION_INTERVAL * 60 if last_collection.get('timestamp') else 0
    }


@app.post("/reload")
async def reload_config(background_tasks: BackgroundTasks):
    """Force config reload and immediate collection"""
    global miners_config_cache, last_config_load
    
    # Invalidate cache
    miners_config_cache = None
    last_config_load = 0
    
    logger.info("Config reload triggered via API")
    
    if collection_lock.locked():
        return {
            "success": False,
            "message": "Collection already in progress, config will reload on next cycle"
        }
    
    background_tasks.add_task(collect_all_metrics)
    
    return {
        "success": True,
        "message": "Config reloaded, collection started in background"
    }


@app.post("/collect")
async def trigger_collection(background_tasks: BackgroundTasks):
    """Manually trigger metrics collection (runs in background)"""
    if collection_lock.locked():
        return {
            "success": False,
            "message": "Collection already in progress",
            "skipped": True
        }
    
    logger.info("Manual collection triggered via API (background)")
    background_tasks.add_task(collect_all_metrics)
    
    return {
        "success": True,
        "message": "Collection started in background",
        "timestamp": datetime.now().isoformat(),
        "note": "Check /status endpoint for completion"
    }


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(REGISTRY),
        media_type="text/plain; version=0.0.4; charset=utf-8"
    )


# ============================================================================
# MAIN
# ============================================================================

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    """Lifespan context manager for startup/shutdown"""
    logger.info("=" * 60)
    logger.info("Mining Metrics Collector Service V2 Starting")
    logger.info("=" * 60)
    logger.info(f"Miners config: {MINERS_CONFIG}")
    logger.info(f"Collection interval: {COLLECTION_INTERVAL} minutes")
    logger.info(f"ICMP ping enabled: {ENABLE_ICMP_PING}")
    logger.info(f"Architecture: Direct Prometheus scraping (async scheduler + lock)")
    logger.info("=" * 60)
    
    # Start async scheduler as background task
    task = asyncio.create_task(scheduler_loop())
    
    logger.info("Starting API server on port 8000...")
    logger.info("Prometheus metrics available at: http://0.0.0.0:8000/metrics")
    
    yield
    
    # Shutdown
    task.cancel()
    logger.info("Scheduler stopped")


# Initialize FastAPI app with lifespan
app = FastAPI(title="Mining Metrics Collector Service", version="2.0.0", lifespan=lifespan)


def main():
    """Main entry point"""
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
