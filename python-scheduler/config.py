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
COLLECTION_INTERVAL = int(os.getenv('COLLECTION_INTERVAL', '2'))  # minutes
# Miners polled in parallel per cycle. Measured 2026-08-29: a full cycle over
# 21 machines takes 7-9 s of the 120 s interval at 5, with zero skipped runs,
# so the default is left alone -- this is env-driven only so it can be raised
# without a rebuild if enough machines start timing out (each timeout holds a
# slot for 15 s).
MAX_CONCURRENT_REQUESTS = int(os.getenv('MAX_CONCURRENT_REQUESTS', '5'))
BACKEND_URL = os.getenv('BACKEND_URL', 'http://backend:5000')
PUSH_TO_BACKEND = os.getenv('PUSH_TO_BACKEND', 'true').lower() == 'true'
SYSTEM_API_KEY = os.getenv('SYSTEM_API_KEY', '')  # For authenticating with backend
INTERNAL_METRICS_TOKEN = os.getenv('INTERNAL_METRICS_TOKEN', '')  # For authenticating metrics push to backend
USE_DATABASE_CONFIG = os.getenv('USE_DATABASE_CONFIG', 'true').lower() == 'true'  # Use database instead of YAML

# Cache miners config at startup
miners_config_cache = None
last_config_load = 0
CONFIG_CACHE_TTL = 300  # 5 minutes


# ----------------------------------------------------------------------------
# Miner-config provenance (DMI-58)
#
# The miner list normally comes from the backend's database API. When that call
# fails the loader used to silently read MINERS_CONFIG instead, and that file
# ships example miners (miner-01..04 at 192.168.1.100-103) — so a scheduler
# that started before the backend polled those placeholders while reporting a
# perfectly successful collection. Every load now records where the list
# actually came from, so the health check and Prometheus can tell a fallback
# apart from a success.
# ----------------------------------------------------------------------------
CONFIG_SOURCE_DATABASE = 'database_api'      # intended source, reachable
CONFIG_SOURCE_YAML = 'yaml'                  # intended source (DB config off)
CONFIG_SOURCE_STALE_CACHE = 'stale_cache'    # DB unreachable, serving last known good
CONFIG_SOURCE_YAML_FALLBACK = 'yaml_fallback'  # DB unreachable and no cache — placeholders likely
CONFIG_SOURCE_NONE = 'none'                  # no miners at all

# Every possible value, so callers can publish a complete gauge (one series per
# source, exactly one of them 1) instead of a label that only ever appears once.
CONFIG_SOURCES = (
    CONFIG_SOURCE_DATABASE,
    CONFIG_SOURCE_YAML,
    CONFIG_SOURCE_STALE_CACHE,
    CONFIG_SOURCE_YAML_FALLBACK,
    CONFIG_SOURCE_NONE,
)

# Sources that mean "not what was asked for" — health must not report healthy.
DEGRADED_CONFIG_SOURCES = (CONFIG_SOURCE_STALE_CACHE, CONFIG_SOURCE_YAML_FALLBACK)

# Sources that are the list we asked for, and are therefore safe to act on
# destructively. Deliberately a whitelist rather than "not degraded": `none`
# is neither degraded nor trustworthy — it is an empty list, and treating it
# as the inventory would drop every series the fleet has (DMI-80).
TRUSTED_CONFIG_SOURCES = (CONFIG_SOURCE_DATABASE, CONFIG_SOURCE_YAML)

miners_config_source = CONFIG_SOURCE_NONE


def _ensure_miner_names(miners: List[Dict]) -> List[Dict]:
    """Give every miner a 'name', falling back to its alias then its IP."""
    for miner in miners:
        if 'name' not in miner:
            if 'alias' in miner:
                miner['name'] = miner['alias']
            else:
                miner['name'] = f"miner-{miner['ip'].replace('.', '-')}"
    return miners


def _fetch_miners_from_api():
    """Miner list from the backend, or None when the API could not be read."""
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/mining/miners",
            headers={'X-API-Key': SYSTEM_API_KEY},
            timeout=5
        )
        if response.status_code == 200:
            return response.json().get('miners', [])
        print(f"Warning: Failed to load miners from database API: {response.status_code}")
    except Exception as e:
        print(f"Warning: Failed to load miners from database API: {e}")
    return None


def _load_miners_from_yaml() -> List[Dict]:
    """Miner list from MINERS_CONFIG; empty when the file is missing."""
    config_path = Path(MINERS_CONFIG)
    if not config_path.exists():
        print(f"Warning: Miners config file not found: {config_path}")
        return []

    with open(config_path, 'r') as f:
        config = yaml.safe_load(f) or {}

    return _ensure_miner_names(config.get('miners', []))


def load_miners_config() -> List[Dict]:
    """
    Load miners configuration with caching.

    Also records the provenance of the returned list in `miners_config_source`
    (see CONFIG_SOURCE_* above). The cache is only treated as fresh — i.e. worth
    skipping the API for — when it came from the intended source; while degraded
    the intended source is retried on every call so recovery is immediate.
    """
    global miners_config_cache, last_config_load, miners_config_source

    current_time = time.time()
    if miners_config_cache and (current_time - last_config_load) < CONFIG_CACHE_TTL:
        return miners_config_cache

    database_configured = bool(USE_DATABASE_CONFIG and SYSTEM_API_KEY)

    if database_configured:
        miners = _fetch_miners_from_api()
        if miners is not None:
            recovered = miners_config_source in DEGRADED_CONFIG_SOURCES
            miners_config_cache = _ensure_miner_names(miners)
            last_config_load = current_time
            miners_config_source = CONFIG_SOURCE_DATABASE
            if recovered:
                print(f"Recovered: miner config loaded from database API ({len(miners)} miners)")
            return miners_config_cache

        # DMI-58: the API is the intended source and it is unreachable. A list
        # we already fetched is strictly better than the YAML seed file, whose
        # example miners would replace the real fleet with placeholders — so a
        # transient backend outage must not lose the fleet.
        if miners_config_cache:
            if miners_config_source != CONFIG_SOURCE_STALE_CACHE:
                print(
                    "Warning: database API unavailable, serving last known good miner "
                    f"config ({len(miners_config_cache)} miners) — NOT falling back to YAML"
                )
            miners_config_source = CONFIG_SOURCE_STALE_CACHE
            # last_config_load is deliberately not advanced: retry on next call.
            return miners_config_cache

        print(f"Warning: database API unavailable and nothing cached, reading {MINERS_CONFIG}")

    miners = _load_miners_from_yaml()
    miners_config_cache = miners

    if not miners:
        miners_config_source = CONFIG_SOURCE_NONE
    elif database_configured:
        miners_config_source = CONFIG_SOURCE_YAML_FALLBACK
        print(
            f"Warning: running on YAML fallback config ({len(miners)} miners from "
            f"{MINERS_CONFIG}) — these may be example miners, not the real fleet"
        )
    else:
        miners_config_source = CONFIG_SOURCE_YAML

    if miners_config_source == CONFIG_SOURCE_YAML:
        last_config_load = current_time
    # Otherwise leave last_config_load alone so the intended source is retried.

    return miners_config_cache


def get_miners_config() -> List[Dict]:
    """Currently cached miner list (empty before the first load)."""
    return miners_config_cache or []


def get_miners_config_source() -> str:
    """Where the cached miner list came from; one of CONFIG_SOURCES."""
    return miners_config_source


def has_loaded_miners_config() -> bool:
    """
    Whether a load has been attempted at all.

    Distinguishes "still starting up" from "loaded and empty" — both leave the
    miner list empty, but only the second is a fault.
    """
    return miners_config_cache is not None




def invalidate_config_cache():
    """
    Invalidate the configuration cache to force reload.

    The miner list is expired rather than discarded: the next load refetches it
    from the intended source, but if that source is unreachable the last known
    good list still beats the YAML placeholders (DMI-58). Dropping it outright
    would turn a reload during a backend restart into exactly the fleet loss
    this guards against. `miners_config_source` is left as-is because it still
    describes the list currently held; the next load overwrites it.
    """
    global last_config_load
    last_config_load = 0
