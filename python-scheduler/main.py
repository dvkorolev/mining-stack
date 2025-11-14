#!/usr/bin/env python3
"""
Mining Metrics Collector Service - Main Application
FastAPI app with Prometheus metrics and scheduled collection
"""

import os
import sys
import logging
import asyncio
import time
import json
import socket
import subprocess
import re
from datetime import datetime
from typing import Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.responses import Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn
import aiohttp
from prometheus_client import generate_latest, REGISTRY
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Import our modules
from config import (
    MINERS_CONFIG, POOLS_CONFIG, COLLECTION_INTERVAL, POOL_TEST_INTERVAL, ENABLE_ICMP_PING,
    BACKEND_URL, PUSH_TO_BACKEND,
    load_miners_config, load_pools_config, invalidate_config_cache,
    miners_config_cache
)
from state_manager import ServiceState
from asic_profile_loader import get_library
from metrics import (
    pool_network_reachable, pool_network_dns_resolved,
    pool_network_connect_time, pool_network_ping_avg,
    pool_network_ping_min, pool_network_ping_max,
    pool_network_packet_loss, collection_duration,
    collection_success, collection_timestamp,
    miner_scrape_status, miner_state
)
from collectors.pyasic_collector import collect_pyasic_metrics, _update_metrics, _safe_float
from collectors.antminer_cgi_collector import collect_antminer_cgi
from collectors.whatsminer_cgi_collector import collect_whatsminer_cgi
from collectors.whatsminer_cgminer_collector import collect_whatsminer_cgminer
from collectors.dg1_tcp_collector import collect_dg1_tcp
from collectors.dg1_http_collector import collect_dg1_http
from health_check import HealthCheck
from logging_config import setup_logging, log_event

# Setup structured logging
setup_logging(service_name="python-scheduler")
logger = logging.getLogger(__name__)

# Collection lock to prevent concurrent collections
collection_lock = asyncio.Lock()

# Service state manager (replaces global variables)
service_state = ServiceState()

# Health check system
health_checker = HealthCheck(collection_lock, service_state)

# Scheduler instance (initialized in lifespan)
scheduler = None

FAILURE_THRESHOLD = 5


# ============================================================================
# POOL NETWORK METRICS COLLECTION
# ============================================================================

async def collect_pool_network_metrics_from_config() -> Dict[str, Any]:
    """Collect pool network quality metrics from pools.yaml configuration"""
    logger.info("Starting pool network collection from configuration...")
    start_time = time.time()
    
    # Load pools from configuration
    pools_config = load_pools_config()
    
    if not pools_config:
        logger.info("No pools configured in pools.yaml, skipping pool collection")
        return {'success': True, 'pools_tested': 0, 'duration': 0, 'source': 'pools_yaml'}
    
    pools = [(p['hostname'], p['port']) for p in pools_config]
    logger.info(f"Testing {len(pools)} configured pools")
    
    async def test_pool(hostname: str, port: int):
        if ENABLE_ICMP_PING:
            try:
                result = subprocess.run(
                    ['ping', '-c', '5', '-W', '2', hostname],
                    capture_output=True, text=True, timeout=15)
                output = result.stdout
                packet_loss = 100.0
                loss_match = re.search(r'(\d+)% packet loss', output)
                if loss_match:
                    packet_loss = float(loss_match.group(1))
                ping_avg = ping_min = ping_max = 0.0
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
            pool_network_packet_loss.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_avg.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_min.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_max.labels(pool=hostname, port=str(port)).set(0.0)
        
        try:
            start = time.time()
            try:
                socket.gethostbyname(hostname)
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(1)
            except socket.gaierror:
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(0)
                pool_network_reachable.labels(pool=hostname, port=str(port)).set(0)
                pool_network_connect_time.labels(pool=hostname, port=str(port)).set(0)
                return
            
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(hostname, port), timeout=5.0)
            connect_time = (time.time() - start) * 1000
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
    collection_duration.labels(collector='pool_network_config').set(duration)
    collection_success.labels(collector='pool_network_config').set(1)
    collection_timestamp.labels(collector='pool_network_config').set(time.time())
    
    logger.info(f"✓ Pool network collection from config complete: {len(pools)} pools in {duration:.1f}s")
    return {'success': True, 'pools_tested': len(pools), 'duration': duration, 'source': 'pools_yaml'}


async def collect_pool_network_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Collect pool network quality metrics"""
    logger.info("Starting pool network collection...")
    start_time = time.time()
    
    pools = set()
    
    async def get_miner_pools(ip: str):
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, 4028), timeout=5.0)
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
                    url = pool.get('URL') or ''
                    if url and isinstance(url, str):
                        url = re.sub(r'^(stratum\+tcp|stratum\+ssl|stratum)://', '', url)
                        if ':' in url:
                            hostname, port_str = url.rsplit(':', 1)
                            port_str = port_str.split('/')[0]
                            miner_pools.append((hostname, int(port_str)))
            return miner_pools
        except Exception:
            return []
    
    tasks = [get_miner_pools(miner['ip']) for miner in miners]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for pool_list in results:
        if isinstance(pool_list, list):
            pools.update(pool_list)
    
    logger.info(f"Discovered {len(pools)} unique pools")
    
    async def test_pool(hostname: str, port: int):
        if ENABLE_ICMP_PING:
            try:
                result = subprocess.run(
                    ['ping', '-c', '5', '-W', '2', hostname],
                    capture_output=True, text=True, timeout=15)
                output = result.stdout
                packet_loss = 100.0
                loss_match = re.search(r'(\d+)% packet loss', output)
                if loss_match:
                    packet_loss = float(loss_match.group(1))
                ping_avg = ping_min = ping_max = 0.0
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
            pool_network_packet_loss.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_avg.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_min.labels(pool=hostname, port=str(port)).set(0.0)
            pool_network_ping_max.labels(pool=hostname, port=str(port)).set(0.0)
        
        try:
            start = time.time()
            try:
                socket.gethostbyname(hostname)
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(1)
            except socket.gaierror:
                pool_network_dns_resolved.labels(pool=hostname, port=str(port)).set(0)
                pool_network_reachable.labels(pool=hostname, port=str(port)).set(0)
                pool_network_connect_time.labels(pool=hostname, port=str(port)).set(0)
                return
            
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(hostname, port), timeout=5.0)
            connect_time = (time.time() - start) * 1000
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
# BACKEND PUSH
# ============================================================================

async def push_metrics_to_backend(miners_data: List[Dict], collection_info: Dict):
    """Push collected metrics to backend for real-time UI updates"""
    if not PUSH_TO_BACKEND:
        return
    
    try:
        payload = {
            'miners': miners_data,
            'timestamp': int(time.time() * 1000),
            'collection_info': collection_info if isinstance(collection_info, dict) else {}
        }
        
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


# ============================================================================
# COLLECTION ORCHESTRATION
# ============================================================================

async def collect_all_metrics():
    """Collect all metrics and update in-memory gauges"""
    if collection_lock.locked():
        logger.warning("Collection already in progress, skipping this run")
        return {
            'success': False,
            'message': 'Collection already in progress',
            'skipped': True
        }
    
    async with collection_lock:
        # Track lock acquisition time for health checks
        health_checker.set_lock_acquired_time(time.time())
        collection_start = time.time()
        
        try:
            log_event(logger, 'info', 'Starting metrics collection',
                     collection_id=int(time.time()))
            
            miners = load_miners_config()
            log_event(logger, 'info', 'Loaded miner configuration',
                     miners_count=len(miners))
            
            pyasic_result = await collect_pyasic_metrics(miners)
            miners_data = pyasic_result.get('miners_data', [])
            
            # Multi-layered probing: Try fallback drivers for failed miners using profile library
            logger.info("Checking for failed miners to retry with fallback drivers...")
            fallback_attempts = 0
            fallback_successes = 0
            
            # Get profile library for intelligent fallback selection
            profile_library = get_library()
            
            for i, miner in enumerate(miners):
                # Ensure miner has valid required fields
                if not miner.get('ip') or not miner.get('name'):
                    logger.warning(f"Skipping miner with missing IP or name: {miner}")
                    continue
                    
                miner_data = miners_data[i]
                scrape_status = miner_data.get('scrape_status', -2)
                hashrate = miner_data.get('hashrate', 0)
                
                # Get profile for intelligent data quality checks
                miner_model = miner.get('model') or 'Unknown'
                profile = profile_library.get_profile(miner_model, miner.get('algorithm'))
                
                # Intelligent data quality checks
                needs_fallback = False
                fallback_reason = None
                
                # 1. Primary collection failed
                if scrape_status < 1:
                    needs_fallback = True
                    fallback_reason = "connection_failed"
                
                # 2. Zero hashrate (API returns bad data)
                elif scrape_status >= 1 and hashrate == 0:
                    needs_fallback = True
                    fallback_reason = "zero_hashrate"
                
                # 3. "Zombie Board" - Hashrate significantly below expected
                elif profile and scrape_status >= 1:
                    expected_hashrate = profile.get_expected_hashrate()
                    if expected_hashrate and hashrate > 0 and hashrate < (expected_hashrate * 0.5):
                        needs_fallback = True
                        fallback_reason = f"low_hashrate ({hashrate:.1f} < {expected_hashrate * 0.5:.1f} TH/s)"
                        logger.warning(f"  ⚠ Zombie board detected on {miner['name']}: {hashrate:.1f} TH/s (expected {expected_hashrate:.1f}+)")
                
                # 4. "Stuck Uptime" - Uptime hasn't changed since last collection
                if scrape_status >= 1 and not needs_fallback:
                    current_uptime = miner_data.get('uptime', 0)
                    last_uptime = service_state.get_last_uptime(miner['ip'])
                    if last_uptime is not None and current_uptime > 0 and current_uptime == last_uptime:
                        needs_fallback = True
                        fallback_reason = f"stuck_uptime ({current_uptime}s)"
                        logger.warning(f"  ⚠ Hung state detected on {miner['name']}: uptime frozen at {current_uptime}s")
                    elif current_uptime > 0:
                        service_state.set_last_uptime(miner['ip'], current_uptime)
                
                # 5. "Missing Boards/Fans" - Board or fan count doesn't match expected
                if profile and scrape_status >= 1 and not needs_fallback:
                    expected_boards = profile.get_expected_board_count()
                    expected_fans = profile.get_expected_fan_count()
                    actual_boards = len(miner_data.get('hashboards', []))
                    actual_fans = len(miner_data.get('fans', []))
                    
                    if expected_boards and actual_boards > 0 and actual_boards != expected_boards:
                        needs_fallback = True
                        fallback_reason = f"board_mismatch ({actual_boards}/{expected_boards})"
                        logger.warning(f"  ⚠ Board count mismatch on {miner['name']}: {actual_boards} found, {expected_boards} expected")
                    
                    elif expected_fans and actual_fans > 0 and actual_fans != expected_fans:
                        needs_fallback = True
                        fallback_reason = f"fan_mismatch ({actual_fans}/{expected_fans})"
                        logger.warning(f"  ⚠ Fan count mismatch on {miner['name']}: {actual_fans} found, {expected_fans} expected")
                
                if needs_fallback:
                    logger.info(f"  → Fallback triggered for {miner['name']}: {fallback_reason}")
                    fallback_data = None
                    fallback_method = None
                    
                    # Get profile for this miner to determine fallback drivers
                    profile = profile_library.get_profile(miner['model'], miner.get('algorithm'))
                    
                    if profile:
                        # Use profile-defined fallback drivers (ordered by priority)
                        drivers = profile.get_ordered_drivers()
                        logger.debug(f"Profile '{profile.id}' has {len(drivers)} drivers for {miner['name']}")
                        
                        # Skip pyasic (priority 1) since it already failed, try next drivers
                        for driver in drivers:
                            driver_type = driver.get('type')
                            if driver_type == 'pyasic':
                                continue  # Already tried
                            
                            if driver_type == 'antminer_cgi':
                                logger.info(f"  Trying Antminer CGI fallback for {miner['name']} ({miner['ip']}) [profile: {profile.id}]")
                                fallback_attempts += 1
                                fallback_data = await collect_antminer_cgi(miner)
                                fallback_method = 'antminer_cgi'
                                if fallback_data:
                                    break
                            elif driver_type == 'dg1_tcp':
                                logger.info(f"  Trying DG1 HTTP fallback for {miner['name']} ({miner['ip']}) [profile: {profile.id}]")
                                fallback_attempts += 1
                                fallback_data = await collect_dg1_http(miner)
                                fallback_method = 'dg1_http'
                                if fallback_data:
                                    break
                    else:
                        # No profile found, use legacy hard-coded fallback logic
                        model_lower = miner['model'].lower()
                        logger.debug(f"No profile found for {miner['model']}, using legacy fallback logic")
                        
                        # Try Whatsminer CGMiner API for Whatsminer models (port 4028)
                        if 'whatsminer' in model_lower or 'm30' in model_lower or 'm50' in model_lower or 'm20' in model_lower:
                            logger.info(f"  Trying Whatsminer CGMiner API fallback for {miner['name']} ({miner['ip']}) [legacy]")
                            fallback_attempts += 1
                            fallback_data = await collect_whatsminer_cgminer(miner)
                            fallback_method = 'whatsminer_cgminer'
                        
                        # Try Antminer CGI driver for Antminers
                        elif 'antminer' in model_lower or 's19' in model_lower or 's17' in model_lower:
                            logger.info(f"  Trying Antminer CGI fallback for {miner['name']} ({miner['ip']}) [legacy]")
                            fallback_attempts += 1
                            fallback_data = await collect_antminer_cgi(miner)
                            fallback_method = 'antminer_cgi'
                        
                        # Try DG1 HTTP driver for DG1 miners
                        elif 'dg1' in model_lower:
                            logger.info(f"  Trying DG1 HTTP fallback for {miner['name']} ({miner['ip']}) [legacy]")
                            fallback_attempts += 1
                            fallback_data = await collect_dg1_http(miner)
                            fallback_method = 'dg1_http'
                    
                    # If fallback succeeded, merge and update metrics
                    if fallback_data:
                        fallback_successes += 1
                        
                        # Merge fallback data with any partial data from primary attempt
                        # Fallback data takes precedence for missing fields
                        for key, value in fallback_data.items():
                            if key not in miner_data or miner_data[key] == 0:
                                miner_data[key] = value
                        
                        # Assign descriptive scrape_status
                        if fallback_method == 'antminer_cgi':
                            new_scrape_status = 0.5  # Antminer CGI success
                        elif fallback_method == 'whatsminer_cgi':
                            new_scrape_status = 0.5  # Whatsminer CGI success
                        elif fallback_method == 'whatsminer_cgminer':
                            new_scrape_status = 0.6  # Whatsminer CGMiner API success
                        elif fallback_method == 'dg1_tcp':
                            new_scrape_status = 0.4  # DG1 TCP success
                        else:
                            new_scrape_status = 0.3  # Generic fallback
                        
                        miner_data['scrape_status'] = new_scrape_status
                        
                        # Update Prometheus metrics with fallback data
                        _update_metrics(
                            fallback_data,
                            miner['ip'],
                            miner['name'],
                            miner['model'],
                            new_scrape_status,
                            miner.get('algorithm')  # Pass algorithm from config
                        )
                        
                        # Update miners_data with merged result
                        hashrate_val = _safe_float(fallback_data.get('hashrate', 0))
                        is_mining = fallback_data.get('is_mining', True)
                        miner_data['hashrate'] = hashrate_val
                        miner_data['power'] = _safe_float(fallback_data.get('power', 0))
                        miner_data['temp_max'] = _safe_float(fallback_data.get('temp_max', fallback_data.get('temperature', 0)))
                        miner_data['is_mining'] = 1 if is_mining else 0
                        # State calculation should match primary collection logic
                        # state: 2=mining (hashrate>0), 1=idle (hashrate=0, not mining), 0=faulty (hashrate=0, should be mining)
                        miner_data['state'] = 2 if hashrate_val > 0 else (1 if not is_mining else 0)
                        
                        # Note: _update_metrics() already set miner_state metric, no need to duplicate
                        
                        # Also update pools if available
                        if 'pools' in fallback_data and fallback_data['pools']:
                            miner_data['pools'] = fallback_data['pools']
                            # Calculate total accepted/rejected from pools
                            pools = fallback_data['pools']
                            if isinstance(pools, list):
                                total_accepted = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
                                total_rejected = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
                                miner_data['pool_accepted'] = total_accepted
                                miner_data['pool_rejected'] = total_rejected
                                logger.info(f"  Pool stats for {miner['name']}: accepted={total_accepted}, rejected={total_rejected}")
                        # Add pool URLs for display (separate from pool stats)
                        if 'pool_urls' in fallback_data and fallback_data['pool_urls']:
                            miner_data['pool_urls'] = fallback_data['pool_urls']
                        
                        logger.info(f"  ✓ Fallback success for {miner['name']}: {fallback_method}")
            
            if fallback_attempts > 0:
                logger.info(f"Fallback drivers: {fallback_successes}/{fallback_attempts} successful")
            
            await push_metrics_to_backend(miners_data, pyasic_result)
            
            pool_result = await collect_pool_network_metrics(miners)
            
            # Update failure streaks and remove stale metrics
            for miner in miners:
                miner_data = next((m for m in miners_data if m['ip'] == miner['ip']), None)
                
                # Reset failure streak if any data was collected (scrape_status >= 0)
                # This includes fallback successes (0.4-0.6) and primary successes (1-2)
                if miner_data and miner_data.get('scrape_status', -2) >= 0:
                    service_state.reset_failure_streak(miner['ip'], miner['name'], miner['model'])
                else:
                    streak = service_state.increment_failure_streak(miner['ip'], miner['name'], miner['model'])
                    
                    if streak >= FAILURE_THRESHOLD:
                        model_normalized = miner['model'].replace(" ", "_")
                        try:
                            miner_scrape_status.remove(miner['ip'], miner['name'], model_normalized)
                            miner_state.remove(miner['ip'], miner['name'], model_normalized)
                        except KeyError:
                            pass
            
            # Update service state
            service_state.update_last_collection(
                success=True,
                message='All collections successful',
                details={
                    'pyasic': pyasic_result,
                    'pool_network': pool_result
                }
            )
            
            # Persist state to disk
            service_state.save()
            
            collection_duration_total = time.time() - collection_start
            
            log_event(logger, 'info', 'Collection complete',
                     duration_seconds=collection_duration_total,
                     miners_total=len(miners),
                     miners_successful=pyasic_result.get('miners_collected', 0),
                     fallback_attempts=fallback_attempts,
                     fallback_successes=fallback_successes)
            
            return service_state.get_last_collection()
            
        except Exception as e:
            import traceback
            tb_str = traceback.format_exc()
            logger.error(f"Collection failed with traceback:\n{tb_str}")
            log_event(logger, 'error', 'Collection failed',
                     error_type=type(e).__name__,
                     error_message=str(e))
            
            service_state.update_last_collection(
                success=False,
                message=f'Collection failed: {str(e)}',
                details={}
            )
            service_state.save()
            
            return service_state.get_last_collection()
        finally:
            # Clear lock timing
            health_checker.clear_lock_acquired_time()


# ============================================================================
# FASTAPI APP & ENDPOINTS
# ============================================================================

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    """Lifespan context manager for startup/shutdown"""
    global scheduler
    
    logger.info("=" * 60)
    logger.info("Mining Metrics Collector Service V3 Starting")
    logger.info("=" * 60)
    logger.info(f"Miners config: {MINERS_CONFIG}")
    logger.info(f"Pools config: {POOLS_CONFIG}")
    logger.info(f"Miner collection interval: {COLLECTION_INTERVAL} minutes")
    logger.info(f"Pool test interval: {POOL_TEST_INTERVAL} minutes")
    logger.info(f"ICMP ping enabled: {ENABLE_ICMP_PING}")
    logger.info(f"Architecture: APScheduler + Limited Parallel Gap-Fill")
    
    # Initialize and log profile library
    try:
        profile_library = get_library()
        stats = profile_library.get_stats()
        logger.info(f"ASIC Profile Library loaded: {stats['total_profiles']} profiles")
        logger.info(f"  - SHA-256 miners: {stats['algorithms']['sha256']}")
        logger.info(f"  - SCRYPT miners: {stats['algorithms']['scrypt']}")
        logger.info(f"  - Manufacturers: {', '.join(stats['manufacturers'])}")
    except Exception as e:
        logger.warning(f"Failed to load ASIC Profile Library: {e}")
        logger.warning("Will use legacy hard-coded logic as fallback")
    
    # Load persisted state
    logger.info("Loading persisted service state...")
    service_state.load()
    state_stats = service_state.get_stats()
    logger.info(f"  Last collection: {state_stats['last_collection_timestamp'] or 'Never'}")
    logger.info(f"  Tracked miners: {state_stats['tracked_miners']}")
    
    logger.info("=" * 60)
    
    # Initialize APScheduler
    scheduler = AsyncIOScheduler()
    
    # Add miner collection job (every COLLECTION_INTERVAL minutes)
    scheduler.add_job(
        collect_all_metrics,
        IntervalTrigger(minutes=COLLECTION_INTERVAL),
        id='miner_collection',
        name='Miner Metrics Collection',
        replace_existing=True,
        max_instances=1  # Prevent concurrent runs
    )
    
    # Add pool collection job (every POOL_TEST_INTERVAL minutes)
    scheduler.add_job(
        collect_pool_network_metrics_from_config,
        IntervalTrigger(minutes=POOL_TEST_INTERVAL),
        id='pool_collection',
        name='Pool Network Testing',
        replace_existing=True,
        max_instances=1
    )
    
    # Start scheduler
    scheduler.start()
    logger.info(f"✓ APScheduler started with {len(scheduler.get_jobs())} jobs")
    
    # Run initial collection immediately
    logger.info("Running initial metrics collection...")
    asyncio.create_task(collect_all_metrics())
    
    logger.info("Starting API server on port 8000...")
    logger.info("Prometheus metrics available at: http://0.0.0.0:8000/metrics")
    
    yield
    
    # Shutdown
    logger.info("Shutting down scheduler...")
    scheduler.shutdown(wait=False)
    logger.info("Scheduler stopped")


app = FastAPI(title="Mining Metrics Collector Service", version="2.0.0", lifespan=lifespan)


# ============================================================================
# GLOBAL EXCEPTION HANDLERS
# ============================================================================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions with structured logging"""
    logger.warning(
        f"HTTP {exc.status_code}: {exc.detail}",
        extra={
            'status_code': exc.status_code,
            'path': request.url.path,
            'method': request.method,
        }
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": "HTTPException",
            "message": exc.detail,
            "status_code": exc.status_code,
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors with structured logging"""
    logger.warning(
        f"Validation error on {request.url.path}",
        extra={
            'path': request.url.path,
            'method': request.method,
            'errors': exc.errors(),
        }
    )
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": "ValidationError",
            "message": "Invalid request data",
            "details": exc.errors(),
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions with structured logging"""
    logger.error(
        f"Unhandled exception: {str(exc)}",
        exc_info=exc,
        extra={
            'path': request.url.path,
            'method': request.method,
            'exception_type': type(exc).__name__,
        }
    )
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": type(exc).__name__,
            "message": "Internal server error",
            "detail": str(exc) if os.getenv('DEBUG') == 'true' else "An unexpected error occurred",
        }
    )


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Health check and service info"""
    last_collection = service_state.get_last_collection()
    return {
        "service": "Mining Metrics Collector Service",
        "version": "3.0.0",
        "status": "running",
        "architecture": "apscheduler_with_state_persistence",
        "collection_interval": f"{COLLECTION_INTERVAL} minutes",
        "pool_test_interval": f"{POOL_TEST_INTERVAL} minutes",
        "last_collection": last_collection.get('timestamp'),
        "endpoints": {
            "metrics": "/metrics (Prometheus scrape endpoint)",
            "health": "/health",
            "status": "/status",
            "jobs": "/jobs (scheduler status)",
            "collect": "/collect (manual trigger)",
            "reload": "/reload (force config reload)",
            "profiles": "/profiles (ASIC profile library info)"
        }
    }


@app.get("/health")
async def health():
    """
    Smart health check endpoint
    Returns 200 if healthy, 503 if unhealthy
    Checks:
    - Collection lock not stuck
    - Last collection is recent
    - Config file is readable
    - Profile library is loaded
    """
    health_result = health_checker.perform_full_check()
    status_code = health_checker.get_http_status_code(health_result)
    
    return Response(
        content=json.dumps(health_result, indent=2),
        status_code=status_code,
        media_type="application/json"
    )


@app.get("/status")
async def status():
    """Get collector status"""
    last_collection = service_state.get_last_collection()
    state_stats = service_state.get_stats()
    return {
        "last_collection": last_collection,
        "collection_in_progress": collection_lock.locked(),
        "collection_interval_minutes": COLLECTION_INTERVAL,
        "pool_test_interval_minutes": POOL_TEST_INTERVAL,
        "architecture": "v3_apscheduler_with_state_persistence",
        "miners_count": len(miners_config_cache) if miners_config_cache else 0,
        "state_stats": state_stats
    }


@app.get("/jobs")
async def jobs():
    """Scheduler status endpoint"""
    last_collection = service_state.get_last_collection()
    
    if scheduler:
        jobs_list = []
        for job in scheduler.get_jobs():
            next_run = job.next_run_time
            jobs_list.append({
                'id': job.id,
                'name': job.name,
                'next_run': next_run.isoformat() if next_run else None,
                'trigger': str(job.trigger)
            })
        
        return {
            "scheduler": "running",
            "jobs": jobs_list,
            "last_collection": last_collection.get('timestamp')
        }
    else:
        return {
            "scheduler": "not_initialized",
            "jobs": []
        }


@app.post("/reload")
async def reload_config(background_tasks: BackgroundTasks):
    """Force config reload and immediate collection"""
    invalidate_config_cache()
    logger.info("Config reload triggered via API")
    
    # Also reload profile library
    try:
        from asic_profile_loader import reload_library
        reload_library()
        logger.info("ASIC Profile Library reloaded")
    except Exception as e:
        logger.warning(f"Failed to reload profile library: {e}")
    
    if collection_lock.locked():
        return {
            "success": False,
            "message": "Collection already in progress, config will reload on next cycle"
        }
    
    background_tasks.add_task(collect_all_metrics)
    
    return {
        "success": True,
        "message": "Config and profiles reloaded, collection started in background"
    }


@app.post("/collect")
async def trigger_collection(background_tasks: BackgroundTasks):
    """Manually trigger metrics collection"""
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


@app.post("/collect-pools")
async def trigger_pool_collection(background_tasks: BackgroundTasks):
    """Manually trigger pool network metrics collection from pools.yaml"""
    logger.info("Manual pool collection triggered via API (background)")
    
    async def collect_pools_task():
        try:
            result = await collect_pool_network_metrics_from_config()
            logger.info(f"Pool collection completed: {result}")
        except Exception as e:
            logger.error(f"Pool collection failed: {e}")
    
    background_tasks.add_task(collect_pools_task)
    
    return {
        "success": True,
        "message": "Pool collection started in background",
        "timestamp": datetime.now().isoformat(),
        "note": "Check /status endpoint for completion"
    }


@app.get("/profiles")
async def profiles():
    """Get ASIC profile library information"""
    try:
        profile_library = get_library()
        stats = profile_library.get_stats()
        profile_list = []
        
        for profile_id in profile_library.list_profiles():
            profile = profile_library.get_profile_by_id(profile_id)
            if profile:
                profile_list.append({
                    'id': profile.id,
                    'name': profile.name,
                    'manufacturer': profile.manufacturer,
                    'algorithm': profile.algorithm,
                    'drivers': [d.get('type') for d in profile.drivers]
                })
        
        return {
            'stats': stats,
            'profiles': profile_list
        }
    except Exception as e:
        return {
            'error': str(e),
            'message': 'Profile library not available'
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

def main():
    """Main entry point"""
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
