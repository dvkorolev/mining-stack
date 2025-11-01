#!/usr/bin/env python3
"""
Job Runner Service
Generalized service for executing predefined Python scripts via API
Implements the "Job Runner" pattern with security allowlist
"""

import os
import sys
import time
import logging
import subprocess
import threading
from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel

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
app = FastAPI(title="Job Runner Service", version="1.0.0")

# SECURITY: Allowlist of permitted jobs
# Only scripts in this dict can be executed
JOB_ALLOWLIST = {
    'collect_metrics': {
        'scripts': [
            '/app/bin/pyasic_textfile.py',
            '/app/bin/universal_miner_collector.py'
        ],
        'description': 'Collect metrics from all miners',
        'timeout': 120
    },
    'discover_miners': {
        'scripts': ['/app/bin/farm_init.py'],
        'description': 'Discover miners on network',
        'timeout': 180
    },
    'reboot_miner': {
        'scripts': ['/app/bin/reboot_miner.py'],
        'description': 'Reboot a specific miner',
        'timeout': 60,
        'requires_args': True
    },
    'update_pools': {
        'scripts': ['/app/bin/update_pools.py'],
        'description': 'Update miner pool configuration',
        'timeout': 60,
        'requires_args': True
    }
}

# Request/Response models
class JobRequest(BaseModel):
    job: str
    args: Optional[Dict[str, Any]] = None

class JobResponse(BaseModel):
    success: bool
    job: str
    message: str
    duration: float
    output: Optional[str] = None
    error: Optional[str] = None

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


@app.get("/jobs")
async def list_jobs():
    """List all available jobs"""
    return {
        "jobs": {
            job_name: {
                "description": job_config["description"],
                "timeout": job_config["timeout"],
                "requires_args": job_config.get("requires_args", False)
            }
            for job_name, job_config in JOB_ALLOWLIST.items()
        }
    }


@app.post("/run", response_model=JobResponse)
async def run_job(request: JobRequest):
    """
    Generalized Job Runner Endpoint
    
    Execute any job from the allowlist by name.
    This is the core of the Job Runner pattern.
    
    Example:
        POST /run
        {"job": "discover_miners"}
        
        POST /run
        {"job": "reboot_miner", "args": {"miner_name": "miner-1"}}
    """
    job_name = request.job
    job_args = request.args or {}
    
    # SECURITY: Check if job is in allowlist
    if job_name not in JOB_ALLOWLIST:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_name}' not found. Available jobs: {list(JOB_ALLOWLIST.keys())}"
        )
    
    job_config = JOB_ALLOWLIST[job_name]
    
    # Check if job requires arguments
    if job_config.get('requires_args', False) and not job_args:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_name}' requires arguments"
        )
    
    logger.info(f"Executing job: {job_name}")
    start_time = time.time()
    
    try:
        results = []
        
        # Execute all scripts for this job
        for script_path in job_config['scripts']:
            # Build command with args if provided
            cmd = ['python3', script_path]
            if job_args:
                # Pass args as JSON string
                import json
                cmd.extend(['--args', json.dumps(job_args)])
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=job_config['timeout'],
                cwd='/app'
            )
            
            results.append({
                'script': os.path.basename(script_path),
                'returncode': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            })
        
        duration = time.time() - start_time
        
        # Check if all scripts succeeded
        all_success = all(r['returncode'] == 0 for r in results)
        
        if all_success:
            logger.info(f"✓ Job '{job_name}' completed successfully in {duration:.1f}s")
            return JobResponse(
                success=True,
                job=job_name,
                message=f"Job completed successfully",
                duration=duration,
                output=results[0]['stdout'][:500] if results else None
            )
        else:
            failed = [r for r in results if r['returncode'] != 0]
            error_msg = failed[0]['stderr'][:500] if failed else "Unknown error"
            logger.error(f"✗ Job '{job_name}' failed: {error_msg}")
            return JobResponse(
                success=False,
                job=job_name,
                message=f"Job failed",
                duration=duration,
                error=error_msg
            )
            
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        logger.error(f"✗ Job '{job_name}' timed out after {duration:.1f}s")
        return JobResponse(
            success=False,
            job=job_name,
            message=f"Job timed out",
            duration=duration,
            error=f"Execution exceeded {job_config['timeout']}s timeout"
        )
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"✗ Job '{job_name}' error: {e}")
        return JobResponse(
            success=False,
            job=job_name,
            message=f"Job failed with error",
            duration=duration,
            error=str(e)
        )


# Backward compatibility endpoints (delegate to /run)
@app.post("/collect")
async def trigger_collection():
    """Manually trigger metrics collection (delegates to /run)"""
    return await run_job(JobRequest(job="collect_metrics"))


@app.post("/discover")
async def trigger_discovery():
    """Manually trigger miner discovery (delegates to /run)"""
    return await run_job(JobRequest(job="discover_miners"))


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
