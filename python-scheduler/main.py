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
import rated_hashrate
from config import (
    MINERS_CONFIG, COLLECTION_INTERVAL, MAX_CONCURRENT_REQUESTS,
    BACKEND_URL, PUSH_TO_BACKEND, INTERNAL_METRICS_TOKEN,
    CONFIG_SOURCES, DEGRADED_CONFIG_SOURCES, TRUSTED_CONFIG_SOURCES,
    load_miners_config, invalidate_config_cache,
    get_miners_config, get_miners_config_source
)
from state_manager import ServiceState
from asic_profile_loader import get_library
from metrics import (
    collection_duration,
    collection_success, collection_timestamp,
    miner_fallback_trigger_total, miner_fallback_total,
    remove_miner_series, remove_miner_pool_series, publish_config_source,
    remove_miner_board_series, remove_miner_fan_series, get_stale_value_metrics,
    remove_miner_expected_series,
    forget_unconfigured_miners
)
from collectors.pyasic_collector import collect_pyasic_metrics, _update_metrics, _safe_float
from collectors.antminer_cgi_collector import collect_antminer_cgi
from collectors.whatsminer_cgi_collector import collect_whatsminer_cgi
# whatsminer_cgminer_collector removed - redundant with PyASIC's native CGMiner support
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

# DMI-87: consecutive failures after which a fallback method is skipped for a
# miner. Measured on the Pi 2026-08-29: whatsminer_cgi had run 1300 attempts
# with zero successes -- two machines whose hashrate is genuinely 0 (`.117`
# with its pools deliberately cleared, `.58` at a flat 0) triggered a doomed
# CGI fetch every cycle, forever, at ~1440 requests a day.
#
# The breaker is per (miner, method) rather than per trigger reason: the first
# reading of this said to cut the board/fan-mismatch triggers, and the
# measurement inverted it -- those had never fired once, while zero_hashrate,
# the one that looked legitimate, was the entire cost.
FALLBACK_FAILURE_THRESHOLD = 3

# driver type in asic_profiles.yaml -> fallback method name.
# 'dg1_tcp' maps to the HTTP collector deliberately; that is what the branch it
# replaces did.
FALLBACK_METHOD_BY_DRIVER = {
    'whatsminer_cgi': 'whatsminer_cgi',
    'antminer_cgi': 'antminer_cgi',
    'dg1_tcp': 'dg1_http',
}

FALLBACK_COLLECTORS = {
    'whatsminer_cgi': collect_whatsminer_cgi,
    'antminer_cgi': collect_antminer_cgi,
    'dg1_http': collect_dg1_http,
}


def _record_fallback_skip(method: str, miner: Dict) -> None:
    """
    Count a fallback attempt that was suppressed by the breaker.

    Suppression is not silence (the DMI-58 rule): the skip is counted under its
    own result label, so a method that has been switched off is visible in the
    metric rather than simply absent from it.
    """
    miner_fallback_total.labels(method=method, result='skipped').inc()
    logger.info(
        f"  → Fallback {method} skipped for {miner['name']} ({miner['ip']}): "
        f"{FALLBACK_FAILURE_THRESHOLD} consecutive failures"
    )


# ============================================================================
# POOL HEALTH
# ============================================================================
#
# There is deliberately no pool probing here. Pool health is read from the
# miners themselves (`miner_pool_alive`, built from each machine's own reported
# pool list) -- see DMI-56.
#
# What used to live here was a bare TCP connect to every pool, every cycle,
# plus a second one on POOL_TEST_INTERVAL. That is the same measurement DMI-56
# banned in its blackbox form, and for the same reason: a pool drops repeated
# bare connects from an address that never speaks stratum, so the metric
# reports the pool's tolerance of us rather than our connectivity. Reading it
# as availability produced a phantom 25% outage rate and a wrong diagnosis
# (DMI-46).
#
# It also published four metrics that were not measurements at all. With
# ENABLE_ICMP_PING unset -- the default, and what production ran -- packet loss
# and all three ping gauges were written as a literal 0.0 every cycle, and
# three alert rules were evaluated against those constants. Measured on the Pi
# 2026-08-29: every one of them read exactly 0.0.
#
# Uplink availability is `sum(rate(miner_pool_accepted_total[5m]))`; pool
# reachability is `miner_pool_alive`. Both ride the production path.

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
        
        headers = {}
        if INTERNAL_METRICS_TOKEN:
            headers['X-Internal-Token'] = INTERNAL_METRICS_TOKEN

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{BACKEND_URL}/api/internal/metrics",
                json=payload,
                headers=headers,
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
            config_source = get_miners_config_source()
            publish_config_source(config_source, len(miners), CONFIG_SOURCES)
            log_event(logger, 'info', 'Loaded miner configuration',
                     miners_count=len(miners), config_source=config_source)
            if config_source in DEGRADED_CONFIG_SOURCES:
                # DMI-58: polling the wrong list still looks like a successful
                # collection, so the warning has to come from here.
                log_event(logger, 'warning', 'Polling a fallback miner configuration',
                         miners_count=len(miners), config_source=config_source)

            # DMI-80: a miner dropped from the inventory keeps publishing its
            # last readings for as long as this process lives. The DMI-54/55
            # cull is driven by *failed scrapes*, and a machine that is no
            # longer in the list is never scraped at all, so nothing ever
            # counts against it — the removal only took effect on the next
            # scheduler restart. Until then it stayed inside every fleet
            # aggregate and its `miner_scrape_status` kept MinerOffline firing
            # for hardware that had been deliberately decommissioned.
            #
            # Only ever done from a list we asked for and got. On a fallback
            # source the list is the bundled example miners, so purging against
            # it would delete the real fleet the moment the backend blinks, and
            # `none` is an empty list that would delete all of it — the DMI-58
            # rule applied to a destructive action.
            if config_source in TRUSTED_CONFIG_SOURCES:
                configured_ips = {m.get('ip') for m in miners if m.get('ip')}
                for ip in forget_unconfigured_miners(configured_ips):
                    service_state.forget_miner(ip)
                    log_event(logger, 'info', 'Miner left the configuration, dropping its series',
                             miner_ip=ip, config_source=config_source)
                rated_hashrate.forget_unconfigured(configured_ips)

            # DMI-81: refresh the nameplate hashrate read off the machines
            # themselves. Nearly always a no-op -- entries are cached for an
            # hour, because detect-hash-rate only changes if someone physically
            # swaps a hashboard.
            rated_summary = await rated_hashrate.refresh(miners, MAX_CONCURRENT_REQUESTS)
            if rated_summary['fetched']:
                log_event(logger, 'info', 'Refreshed rated hashrates from API v3',
                         **rated_summary)

            pyasic_result = await collect_pyasic_metrics(miners)
            miners_data = pyasic_result.get('miners_data', [])
            miners_data_by_ip = {
                m.get('ip'): m
                for m in miners_data
                if isinstance(m, dict) and m.get('ip')
            }
            
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
                    
                miner_data = miners_data_by_ip.get(miner['ip'])
                if miner_data is None:
                    miner_data = {
                        'ip': miner['ip'],
                        'name': miner['name'],
                        'model': miner.get('model') or 'Unknown',
                        'hashrate': 0,
                        'power': 0,
                        'temp_max': 0,
                        'is_mining': 0,
                        'uptime': 0,
                        'efficiency': 0,
                        'fault_light': 0,
                        'errors_count': 0,
                        'scrape_status': -2,
                        'state': 0,
                        'pool_accepted': 0,
                        'pool_rejected': 0,
                        'pools': [],
                        'hashboards': [],
                        'fans': [],
                    }
                    miners_data.append(miner_data)
                    miners_data_by_ip[miner['ip']] = miner_data
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
                
                if not needs_fallback:
                    # Primary collection is healthy, so re-arm every breaker for
                    # this machine: the next fault gets a fresh attempt instead
                    # of inheriting one opened by an older, unrelated one.
                    service_state.reset_fallback_failures(miner['ip'])

                if needs_fallback:
                    # Bucket reason to a bounded category (strip any parenthetical detail like "(2/3)")
                    _reason_category = fallback_reason.split()[0] if fallback_reason else 'unknown'
                    miner_fallback_trigger_total.labels(reason=_reason_category).inc()
                    logger.info(f"  → Fallback triggered for {miner['name']}: {fallback_reason}")
                    fallback_data = None
                    fallback_method = None
                    blocked_methods = service_state.blocked_fallback_methods(
                        miner['ip'], FALLBACK_FAILURE_THRESHOLD
                    )

                    # Get profile for this miner to determine fallback drivers
                    profile = profile_library.get_profile(miner['model'], miner.get('algorithm'))
                    
                    if profile:
                        # Use profile-defined fallback drivers (ordered by priority)
                        drivers = profile.get_ordered_drivers()
                        logger.debug(f"Profile '{profile.id}' has {len(drivers)} drivers for {miner['name']}")
                        
                        # Skip pyasic (priority 1) since it already failed, try next drivers.
                        # 'cgminer' is skipped too: pyasic already speaks the CGMiner API natively,
                        # so retrying it here would repeat the attempt that just failed.
                        for driver in drivers:
                            driver_type = driver.get('type')
                            if driver_type in ('pyasic', 'cgminer'):
                                continue  # Already tried

                            method = FALLBACK_METHOD_BY_DRIVER.get(driver_type)
                            if method is None:
                                continue  # No collector for this driver type

                            if method in blocked_methods:
                                _record_fallback_skip(method, miner)
                                continue

                            logger.info(f"  Trying {method} fallback for {miner['name']} ({miner['ip']}) [profile: {profile.id}]")
                            fallback_attempts += 1
                            fallback_data = await FALLBACK_COLLECTORS[method](miner)
                            fallback_method = method
                            if fallback_data:
                                break
                    else:
                        # No profile found, use legacy hard-coded fallback logic
                        model_lower = miner['model'].lower()
                        logger.debug(f"No profile found for {miner['model']}, using legacy fallback logic")

                        # Note: whatsminer_cgminer removed as it duplicates PyASIC's native CGMiner support
                        if 'whatsminer' in model_lower or 'm30' in model_lower or 'm50' in model_lower or 'm20' in model_lower:
                            method = 'whatsminer_cgi'
                        elif 'antminer' in model_lower or 's19' in model_lower or 's17' in model_lower:
                            method = 'antminer_cgi'
                        elif 'dg1' in model_lower:
                            method = 'dg1_http'
                        else:
                            method = None

                        if method is not None and method in blocked_methods:
                            _record_fallback_skip(method, miner)
                        elif method is not None:
                            logger.info(f"  Trying {method} fallback for {miner['name']} ({miner['ip']}) [legacy]")
                            fallback_attempts += 1
                            fallback_data = await FALLBACK_COLLECTORS[method](miner)
                            fallback_method = method


                    # Record the fallback attempt outcome (method is None only if no driver matched the model)
                    if fallback_method is not None:
                        miner_fallback_total.labels(
                            method=fallback_method,
                            result='success' if fallback_data else 'failure'
                        ).inc()
                        streak = service_state.record_fallback_result(
                            miner['ip'], fallback_method, bool(fallback_data)
                        )
                        if streak == FALLBACK_FAILURE_THRESHOLD:
                            logger.warning(
                                f"  ⚠ Fallback {fallback_method} disabled for {miner['name']} "
                                f"({miner['ip']}) after {streak} consecutive failures; "
                                f"re-armed when its primary collection is healthy again"
                            )

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
                        elif fallback_method == 'dg1_tcp':
                            new_scrape_status = 0.4  # DG1 TCP success
                        elif fallback_method == 'dg1_http':
                            new_scrape_status = 0.4  # DG1 HTTP success
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
                        
                        # Update miners_data with merged result (using standard field names)
                        hashrate_val = _safe_float(fallback_data.get('hashrate', 0))
                        is_mining = fallback_data.get('is_mining', True)
                        miner_data['hashrate'] = hashrate_val
                        miner_data['power'] = _safe_float(fallback_data.get('power', 0))
                        miner_data['temp_max'] = _safe_float(fallback_data.get('temperature', 0))  # Use standard 'temperature' field
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

            # Update failure streaks and remove stale metrics
            for miner in miners:
                miner_data = miners_data_by_ip.get(miner['ip'])
                
                # Reset failure streak if any data was collected (scrape_status >= 0)
                # This includes fallback successes (0.4-0.6) and primary successes (1-2)
                if miner_data and miner_data.get('scrape_status', -2) >= 0:
                    service_state.reset_failure_streak(miner['ip'], miner['name'], miner['model'])
                else:
                    streak = service_state.increment_failure_streak(miner['ip'], miner['name'], miner['model'])
                    
                    if streak >= FAILURE_THRESHOLD:
                        # Drop every reading this miner is no longer producing, and
                        # keep `miner_scrape_status` alone -- it carries the -2 that
                        # says we know this machine and it is not answering. The
                        # reverse of this used to be true, which both inflated the
                        # fleet aggregates with a dead miner's last hashrate and
                        # silenced MinerOffline entirely (DMI-55; get_stale_value_metrics
                        # explains why).
                        #
                        # Labels (incl. `algorithm`) come from the cache the collector
                        # fills for this miner; a hand-built subset would not match what
                        # was registered, and prometheus_client rejects a short one.
                        remove_miner_series(miner['ip'], get_stale_value_metrics())
                        # Board and fan series carry `slot`/`fan_id` instead of
                        # `algorithm`, so they need their own removal path and were
                        # missed by every earlier cleanup.
                        remove_miner_board_series(miner['ip'])
                        remove_miner_expected_series(miner['ip'])
                        remove_miner_fan_series(miner['ip'])
                        # A miner this far past the failure threshold is telling
                        # us nothing about its pools either; leaving the last
                        # `alive` reading behind would report a live pool from a
                        # machine that has not answered in hours (DMI-56).
                        remove_miner_pool_series(miner['ip'])
            
            # Update service state
            service_state.update_last_collection(
                success=True,
                message='All collections successful',
                details={
                    'pyasic': pyasic_result
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
    logger.info(f"Miner collection interval: {COLLECTION_INTERVAL} minutes")
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

    # Publish the config-source gauge before the first collection, so the
    # series exist from the first scrape rather than appearing only once a
    # collection has run (DMI-58).
    publish_config_source(get_miners_config_source(), len(get_miners_config()), CONFIG_SOURCES)

    # Initialize APScheduler
    scheduler = AsyncIOScheduler()
    
    # Add miner collection job (every COLLECTION_INTERVAL minutes)
    scheduler.add_job(
        collect_all_metrics,
        IntervalTrigger(minutes=COLLECTION_INTERVAL),
        id='miner_collection',
        name='Miner Metrics Collection',
        replace_existing=True,
        max_instances=1,  # Prevent concurrent runs
        coalesce=True,
        misfire_grace_time=60
    )
    
    # No pool-probing job: pool health comes from the miners (DMI-56), see the
    # POOL HEALTH note near the top of this file.

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
        "architecture": "v3_apscheduler_with_state_persistence",
        # Read through the accessor: importing the cache by value bound it to
        # None at import time, so this always reported 0 miners.
        "miners_count": len(get_miners_config()),
        "config_source": get_miners_config_source(),
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
