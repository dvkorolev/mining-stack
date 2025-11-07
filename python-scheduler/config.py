"""
Configuration loading and management for mining monitoring.
"""

import os
import time
import yaml
import requests
from pathlib import Path
from typing import List, Dict

# Configuration
MINERS_CONFIG = os.getenv('MINERS_CONFIG', '/app/etc/miners.yaml')
POOLS_CONFIG = os.getenv('POOLS_CONFIG', '/app/etc/pools.yaml')
COLLECTION_INTERVAL = int(os.getenv('COLLECTION_INTERVAL', '2'))  # minutes
POOL_TEST_INTERVAL = int(os.getenv('POOL_TEST_INTERVAL', '5'))  # minutes
ENABLE_ICMP_PING = os.getenv('ENABLE_ICMP_PING', 'false').lower() == 'true'
MAX_CONCURRENT_REQUESTS = 5
BACKEND_URL = os.getenv('BACKEND_URL', 'http://backend:5000')
PUSH_TO_BACKEND = os.getenv('PUSH_TO_BACKEND', 'true').lower() == 'true'
SYSTEM_API_KEY = os.getenv('SYSTEM_API_KEY', '')  # For authenticating with backend
USE_DATABASE_CONFIG = os.getenv('USE_DATABASE_CONFIG', 'true').lower() == 'true'  # Use database instead of YAML

# Cache miners config at startup
miners_config_cache = None
last_config_load = 0
CONFIG_CACHE_TTL = 300  # 5 minutes

# Cache pools config
pools_config_cache = None
last_pools_load = 0


def load_miners_config() -> List[Dict]:
    """Load miners configuration with caching"""
    global miners_config_cache, last_config_load
    
    current_time = time.time()
    if miners_config_cache and (current_time - last_config_load) < CONFIG_CACHE_TTL:
        return miners_config_cache
    
    # Try database API first if enabled
    if USE_DATABASE_CONFIG and SYSTEM_API_KEY:
        try:
            response = requests.get(
                f"{BACKEND_URL}/api/mining/miners",
                headers={'X-API-Key': SYSTEM_API_KEY},
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                miners = data.get('miners', [])
                
                # Ensure each miner has required fields
                for miner in miners:
                    if 'name' not in miner:
                        if 'alias' in miner:
                            miner['name'] = miner['alias']
                        else:
                            miner['name'] = f"miner-{miner['ip'].replace('.', '-')}"
                
                miners_config_cache = miners
                last_config_load = current_time
                return miners_config_cache
            else:
                print(f"Warning: Failed to load miners from database API: {response.status_code}")
        except Exception as e:
            print(f"Warning: Failed to load miners from database API: {e}")
            print("Falling back to YAML configuration...")
    
    # Fallback to YAML file
    config_path = Path(MINERS_CONFIG)
    if not config_path.exists():
        print(f"Warning: Miners config file not found: {config_path}")
        miners_config_cache = []
        last_config_load = current_time
        return miners_config_cache
    
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


def load_pools_config() -> List[Dict]:
    """Load pools configuration with caching"""
    global pools_config_cache, last_pools_load
    
    current_time = time.time()
    if pools_config_cache and (current_time - last_pools_load) < CONFIG_CACHE_TTL:
        return pools_config_cache
    
    config_path = Path(POOLS_CONFIG)
    
    # If pools config doesn't exist, return empty list
    if not config_path.exists():
        pools_config_cache = []
        last_pools_load = current_time
        return pools_config_cache
    
    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        pools = config.get('pools', [])
        
        # Parse pool URLs to extract hostname and port
        parsed_pools = []
        for pool in pools:
            url = pool.get('url', '')
            if ':' in url:
                hostname, port_str = url.rsplit(':', 1)
                try:
                    port = int(port_str)
                    parsed_pools.append({
                        'hostname': hostname,
                        'port': port,
                        'name': pool.get('name', hostname),
                        'algorithm': pool.get('algorithm', 'unknown'),
                        'priority': pool.get('priority', 'medium')
                    })
                except ValueError:
                    pass  # Skip invalid ports
        
        pools_config_cache = parsed_pools
        last_pools_load = current_time
        return pools_config_cache
    except Exception as e:
        # Return empty list on error
        pools_config_cache = []
        last_pools_load = current_time
        return pools_config_cache


def invalidate_config_cache():
    """Invalidate the configuration cache to force reload"""
    global miners_config_cache, last_config_load, pools_config_cache, last_pools_load
    miners_config_cache = None
    last_config_load = 0
    pools_config_cache = None
    last_pools_load = 0
