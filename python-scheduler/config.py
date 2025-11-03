"""
Configuration loading and management for mining monitoring.
"""

import os
import time
import yaml
from pathlib import Path
from typing import List, Dict

# Configuration
MINERS_CONFIG = os.getenv('MINERS_CONFIG', '/app/etc/miners.yaml')
COLLECTION_INTERVAL = int(os.getenv('COLLECTION_INTERVAL', '2'))  # minutes
ENABLE_ICMP_PING = os.getenv('ENABLE_ICMP_PING', 'false').lower() == 'true'
MAX_CONCURRENT_REQUESTS = 5
BACKEND_URL = os.getenv('BACKEND_URL', 'http://backend:5000')
PUSH_TO_BACKEND = os.getenv('PUSH_TO_BACKEND', 'true').lower() == 'true'

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


def invalidate_config_cache():
    """Invalidate the configuration cache to force reload"""
    global miners_config_cache, last_config_load
    miners_config_cache = None
    last_config_load = 0
