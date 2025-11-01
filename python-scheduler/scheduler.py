#!/usr/bin/env python3
"""
Python Scheduler Service
Runs metric collection scripts on schedule and provides API for manual triggers
"""

import os
import sys
import time
import logging
import subprocess
import threading
from datetime import datetime
from typing import Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
import schedule

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Configuration
METRICS_DIR = os.getenv('METRICS_DIR', '/metrics')
MINERS_CONFIG = os.getenv('MINERS_CONFIG', '/app/etc/miners.yaml')
COLLECTION_INTERVAL = int(os.getenv('COLLECTION_INTERVAL', '2'))  # minutes

# FastAPI app
app = FastAPI(title="Mining Metrics Scheduler", version="1.0.0")

# Track last collection
last_collection = {
    'timestamp': None,
    'success': False,
    'message': ''
}


def run_script(script_path: str, script_name: str) -> Dict[str, Any]:
    """Run a Python script and return result"""
    try:
        logger.info(f"Running {script_name}...")
        start_time = time.time()
        
        result = subprocess.run(
            ['python3', script_path],
            capture_output=True,
            text=True,
            timeout=120,  # 2 minute timeout
            cwd='/app'
        )
        
        duration = time.time() - start_time
        
        if result.returncode == 0:
            logger.info(f"✓ {script_name} completed in {duration:.1f}s")
            return {
                'success': True,
                'script': script_name,
                'duration': duration,
                'output': result.stdout[:500]  # First 500 chars
            }
        else:
            logger.error(f"✗ {script_name} failed: {result.stderr}")
            return {
                'success': False,
                'script': script_name,
                'duration': duration,
                'error': result.stderr[:500]
            }
    except subprocess.TimeoutExpired:
        logger.error(f"✗ {script_name} timed out")
        return {
            'success': False,
            'script': script_name,
            'error': 'Script execution timed out'
        }
    except Exception as e:
        logger.error(f"✗ {script_name} error: {e}")
        return {
            'success': False,
            'script': script_name,
            'error': str(e)
        }


def collect_metrics():
    """Run all metric collection scripts"""
    global last_collection
    
    logger.info("=" * 60)
    logger.info(f"Starting metrics collection at {datetime.now()}")
    logger.info("=" * 60)
    
    results = []
    
    # Run pyasic collector
    pyasic_result = run_script('/app/bin/pyasic_textfile.py', 'pyasic_collector')
    results.append(pyasic_result)
    
    # Run universal collector
    universal_result = run_script('/app/bin/universal_miner_collector.py', 'universal_collector')
    results.append(universal_result)
    
    # Summary
    success_count = sum(1 for r in results if r['success'])
    total_count = len(results)
    
    logger.info("=" * 60)
    logger.info(f"Collection complete: {success_count}/{total_count} successful")
    logger.info("=" * 60)
    
    # Update last collection status
    last_collection = {
        'timestamp': datetime.now().isoformat(),
        'success': success_count == total_count,
        'message': f"{success_count}/{total_count} collectors successful",
        'results': results
    }
    
    return last_collection


def discover_miners():
    """Run miner discovery script"""
    logger.info("Starting miner discovery...")
    return run_script('/app/bin/farm_init.py', 'miner_discovery')


def schedule_loop():
    """Run the schedule loop in a separate thread"""
    logger.info(f"Starting scheduler loop (interval: {COLLECTION_INTERVAL} minutes)")
    
    while True:
        schedule.run_pending()
        time.sleep(1)


# API Endpoints

@app.get("/")
async def root():
    """Health check"""
    return {
        "service": "Mining Metrics Scheduler",
        "status": "running",
        "metrics_dir": METRICS_DIR,
        "collection_interval": f"{COLLECTION_INTERVAL} minutes",
        "last_collection": last_collection.get('timestamp')
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.get("/status")
async def status():
    """Get scheduler status"""
    return {
        "last_collection": last_collection,
        "next_run": schedule.next_run().isoformat() if schedule.next_run() else None,
        "metrics_dir": METRICS_DIR,
        "collection_interval": COLLECTION_INTERVAL
    }


@app.post("/collect")
async def trigger_collection():
    """Manually trigger metrics collection"""
    try:
        logger.info("Manual collection triggered via API")
        result = collect_metrics()
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Collection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/discover")
async def trigger_discovery():
    """Manually trigger miner discovery"""
    try:
        logger.info("Manual discovery triggered via API")
        result = discover_miners()
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def main():
    """Main entry point"""
    logger.info("=" * 60)
    logger.info("Mining Metrics Scheduler Service Starting")
    logger.info("=" * 60)
    logger.info(f"Metrics directory: {METRICS_DIR}")
    logger.info(f"Miners config: {MINERS_CONFIG}")
    logger.info(f"Collection interval: {COLLECTION_INTERVAL} minutes")
    logger.info("=" * 60)
    
    # Ensure metrics directory exists
    os.makedirs(METRICS_DIR, exist_ok=True)
    
    # Schedule metrics collection
    schedule.every(COLLECTION_INTERVAL).minutes.do(collect_metrics)
    
    # Run initial collection
    logger.info("Running initial metrics collection...")
    collect_metrics()
    
    # Start scheduler in background thread
    scheduler_thread = threading.Thread(target=schedule_loop, daemon=True)
    scheduler_thread.start()
    
    # Start FastAPI server
    logger.info("Starting API server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
