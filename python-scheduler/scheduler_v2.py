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

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
import uvicorn
import schedule

# Prometheus client
from prometheus_client import Gauge, Counter, Info, generate_latest, REGISTRY, CollectorRegistry

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
MAX_CONCURRENT_REQUESTS = 5

# FastAPI app
app = FastAPI(title="Mining Metrics Collector Service", version="2.0.0")

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
miner_scrape_success = Gauge('miner_scrape_success', 'Scrape success (1=success, 0=failure)', ['ip', 'name', 'model'])

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

# ============================================================================
# DATA COLLECTION FUNCTIONS
# ============================================================================

async def collect_pyasic_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Collect metrics using pyasic library"""
    logger.info("Starting pyasic collection...")
    start_time = time.time()
    
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    async def get_miner_data(miner_config: Dict):
        async with sem:
            ip = miner_config['ip']
            name = miner_config['name']
            model = miner_config['model'].replace(" ", "_")
            
            try:
                miner = await asyncio.wait_for(get_miner(ip), timeout=15)
                if not miner:
                    miner_scrape_success.labels(ip=ip, name=name, model=model).set(0)
                    return None
                
                data = await asyncio.wait_for(miner.get_data(), timeout=15)
                if not data:
                    miner_scrape_success.labels(ip=ip, name=name, model=model).set(0)
                    return None
                
                # Update general metrics
                miner_hashrate.labels(ip=ip, name=name, model=model).set(data.hashrate or 0)
                miner_power.labels(ip=ip, name=name, model=model).set(data.wattage or 0)
                miner_is_mining.labels(ip=ip, name=name, model=model).set(1 if data.is_mining else 0)
                miner_uptime.labels(ip=ip, name=name, model=model).set(data.uptime or 0)
                miner_efficiency.labels(ip=ip, name=name, model=model).set(data.efficiency or 0)
                miner_fault_light.labels(ip=ip, name=name, model=model).set(1 if data.fault_light else 0)
                miner_errors_count.labels(ip=ip, name=name, model=model).set(len(data.errors) if data.errors else 0)
                
                # Calculate max temperature
                temp_max_val = 0
                if data.hashboards:
                    all_temps = [b.chip_temp for b in data.hashboards if b.chip_temp is not None] + \
                               [b.temp for b in data.hashboards if b.temp is not None]
                    if all_temps:
                        temp_max_val = max(all_temps)
                miner_temp_max.labels(ip=ip, name=name, model=model).set(temp_max_val)
                
                # Update board metrics
                if data.hashboards:
                    for board in data.hashboards:
                        slot = str(board.slot)
                        miner_board_hashrate.labels(ip=ip, name=name, model=model, slot=slot).set(board.hashrate or 0)
                        
                        board_temp = 0
                        if board.chip_temp is not None:
                            board_temp = board.chip_temp
                        elif board.temp is not None:
                            board_temp = board.temp
                        miner_board_temp.labels(ip=ip, name=name, model=model, slot=slot).set(board_temp)
                        
                        miner_board_chips_count.labels(ip=ip, name=name, model=model, slot=slot).set(board.chips or 0)
                        miner_board_chips_expected.labels(ip=ip, name=name, model=model, slot=slot).set(board.expected_chips or 0)
                
                # Update fan metrics
                if data.fans:
                    for i, fan in enumerate(data.fans):
                        miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id=str(i)).set(fan.speed or 0)
                
                if data.fan_psu:
                    miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id='psu').set(data.fan_psu[0].speed or 0)
                
                # Update pool metrics
                if data.pools:
                    accepted = sum(p.accepted for p in data.pools if p.accepted is not None)
                    rejected = sum(p.rejected for p in data.pools if p.rejected is not None)
                    miner_pool_accepted.labels(ip=ip, name=name, model=model).set(accepted)
                    miner_pool_rejected.labels(ip=ip, name=name, model=model).set(rejected)
                
                miner_scrape_success.labels(ip=ip, name=name, model=model).set(1)
                return {'ip': ip, 'success': True}
                
            except Exception as e:
                logger.warning(f"Failed to collect from {ip}: {e}")
                miner_scrape_success.labels(ip=ip, name=name, model=model).set(0)
                return {'ip': ip, 'success': False, 'error': str(e)}
    
    tasks = [get_miner_data(miner) for miner in miners]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    duration = time.time() - start_time
    success_count = sum(1 for r in results if r and r.get('success'))
    
    collection_duration.labels(collector='pyasic').set(duration)
    collection_success.labels(collector='pyasic').set(1 if success_count > 0 else 0)
    collection_timestamp.labels(collector='pyasic').set(time.time())
    
    logger.info(f"✓ PyASIC collection complete: {success_count}/{len(miners)} miners in {duration:.1f}s")
    return {'success': True, 'miners_collected': success_count, 'duration': duration}


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


async def collect_all_metrics():
    """Collect all metrics and update in-memory gauges"""
    global last_collection
    
    logger.info("=" * 60)
    logger.info(f"Starting metrics collection at {datetime.now()}")
    logger.info("=" * 60)
    
    try:
        # Load miners configuration
        config_path = Path(MINERS_CONFIG)
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        miners = config.get('miners', [])
        logger.info(f"Found {len(miners)} miners in configuration")
        
        # Collect pyasic metrics
        pyasic_result = await collect_pyasic_metrics(miners)
        
        # Collect pool network metrics
        pool_result = await collect_pool_network_metrics(miners)
        
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
        
    except Exception as e:
        logger.error(f"Collection error: {e}")
        last_collection = {
            'timestamp': datetime.now().isoformat(),
            'success': False,
            'message': f'Collection failed: {str(e)}',
            'details': {}
        }


def collect_metrics_sync():
    """Synchronous wrapper for scheduled collection"""
    asyncio.run(collect_all_metrics())


def schedule_loop():
    """Run the schedule loop in a separate thread"""
    logger.info(f"Starting scheduler loop (interval: {COLLECTION_INTERVAL} minutes)")
    
    while True:
        schedule.run_pending()
        time.sleep(1)


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
            "collect": "/collect (manual trigger)"
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
        "next_run": schedule.next_run().isoformat() if schedule.next_run() else None,
        "collection_interval": COLLECTION_INTERVAL,
        "architecture": "v2_in_memory_metrics"
    }


@app.post("/collect")
async def trigger_collection():
    """Manually trigger metrics collection"""
    logger.info("Manual collection triggered via API")
    await collect_all_metrics()
    return {
        "success": True,
        "message": "Collection completed",
        "timestamp": last_collection.get('timestamp'),
        "details": last_collection.get('details')
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
    logger.info("=" * 60)
    logger.info("Mining Metrics Collector Service V2 Starting")
    logger.info("=" * 60)
    logger.info(f"Miners config: {MINERS_CONFIG}")
    logger.info(f"Collection interval: {COLLECTION_INTERVAL} minutes")
    logger.info(f"Architecture: Direct Prometheus scraping (no Node Exporter)")
    logger.info("=" * 60)
    
    # Schedule metrics collection
    schedule.every(COLLECTION_INTERVAL).minutes.do(collect_metrics_sync)
    
    # Run initial collection
    logger.info("Running initial metrics collection...")
    asyncio.run(collect_all_metrics())
    
    # Start scheduler in background thread
    scheduler_thread = threading.Thread(target=schedule_loop, daemon=True)
    scheduler_thread.start()
    
    # Start FastAPI server
    logger.info("Starting API server on port 8000...")
    logger.info("Prometheus metrics available at: http://0.0.0.0:8000/metrics")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
