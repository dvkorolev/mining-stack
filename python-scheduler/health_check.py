"""
Health Check Module - Smart health verification for python-scheduler
Checks internal state and dependencies to provide meaningful health status
"""

import time
import logging
from typing import Dict, List, Tuple
from datetime import datetime, timedelta

from config import (
    MINERS_CONFIG, BACKEND_URL,
    CONFIG_SOURCE_DATABASE, CONFIG_SOURCE_YAML,
    CONFIG_SOURCE_STALE_CACHE, CONFIG_SOURCE_YAML_FALLBACK,
    get_miners_config, get_miners_config_source, has_loaded_miners_config,
)

logger = logging.getLogger(__name__)

# Health check thresholds
COLLECTION_LOCK_TIMEOUT = 300  # 5 minutes in seconds
STALE_COLLECTION_THRESHOLD = 600  # 10 minutes in seconds


class HealthStatus:
    """Health status levels"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class HealthCheck:
    """Comprehensive health check for the service"""
    
    def __init__(self, collection_lock, service_state=None):
        """
        Initialize health checker
        
        Args:
            collection_lock: asyncio.Lock for collection synchronization
            service_state: ServiceState instance (optional, for backward compatibility)
        """
        self.collection_lock = collection_lock
        self.service_state = service_state
        self._lock_acquired_time = None
    
    def set_lock_acquired_time(self, timestamp: float):
        """Record when collection lock was acquired"""
        self._lock_acquired_time = timestamp
    
    def clear_lock_acquired_time(self):
        """Clear lock acquired time when lock is released"""
        self._lock_acquired_time = None
    
    def check_collection_lock(self) -> Tuple[str, str, Dict]:
        """
        Check if collection lock is stuck
        
        Returns:
            (status, message, details)
        """
        if not self.collection_lock.locked():
            return HealthStatus.HEALTHY, "Collection lock is free", {}
        
        # Lock is held - check how long
        if self._lock_acquired_time:
            lock_duration = time.time() - self._lock_acquired_time
            
            if lock_duration > COLLECTION_LOCK_TIMEOUT:
                return (
                    HealthStatus.UNHEALTHY,
                    f"Collection lock held for {lock_duration:.0f}s (threshold: {COLLECTION_LOCK_TIMEOUT}s)",
                    {
                        "lock_duration_seconds": lock_duration,
                        "threshold_seconds": COLLECTION_LOCK_TIMEOUT,
                        "lock_acquired_at": datetime.fromtimestamp(self._lock_acquired_time).isoformat()
                    }
                )
            else:
                return (
                    HealthStatus.HEALTHY,
                    f"Collection in progress ({lock_duration:.0f}s)",
                    {"lock_duration_seconds": lock_duration}
                )
        else:
            # Lock is held but we don't know for how long (shouldn't happen)
            return (
                HealthStatus.DEGRADED,
                "Collection lock held (duration unknown)",
                {}
            )
    
    def check_last_collection(self) -> Tuple[str, str, Dict]:
        """
        Check if last collection is recent and successful
        
        Returns:
            (status, message, details)
        """
        # Get last collection from ServiceState if available, otherwise use legacy dict
        if self.service_state:
            last_collection = self.service_state.get_last_collection()
        else:
            # Backward compatibility: assume self has last_collection attribute
            last_collection = getattr(self, 'last_collection', {})
        
        if not last_collection or not last_collection.get('timestamp'):
            return (
                HealthStatus.DEGRADED,
                "No collection has run yet",
                {}
            )
        
        timestamp_str = last_collection.get('timestamp')
        try:
            last_run = datetime.fromisoformat(timestamp_str)
            age_seconds = (datetime.now() - last_run).total_seconds()
            
            # Check if collection is stale
            if age_seconds > STALE_COLLECTION_THRESHOLD:
                return (
                    HealthStatus.UNHEALTHY,
                    f"Last collection is stale ({age_seconds:.0f}s ago)",
                    {
                        "last_collection_age_seconds": age_seconds,
                        "threshold_seconds": STALE_COLLECTION_THRESHOLD,
                        "last_collection_at": timestamp_str
                    }
                )
            
            # Check if last collection was successful
            if not last_collection.get('success'):
                message = last_collection.get('message', 'Unknown error')
                return (
                    HealthStatus.DEGRADED,
                    f"Last collection failed: {message}",
                    {
                        "last_collection_age_seconds": age_seconds,
                        "last_collection_at": timestamp_str,
                        "error_message": message
                    }
                )
            
            return (
                HealthStatus.HEALTHY,
                f"Last collection successful ({age_seconds:.0f}s ago)",
                {
                    "last_collection_age_seconds": age_seconds,
                    "last_collection_at": timestamp_str
                }
            )
            
        except Exception as e:
            return (
                HealthStatus.DEGRADED,
                f"Failed to parse last collection timestamp: {e}",
                {"error": str(e)}
            )
    
    def check_config_file(self) -> Tuple[str, str, Dict]:
        """
        Report where the miner list actually in use came from.

        DMI-58: this check used to re-probe the backend and report "Config
        loaded from database API" whenever that probe succeeded — even while
        the service was polling YAML placeholders loaded minutes earlier, when
        the backend was still starting. It now reports the recorded provenance
        of the loaded config, so a fallback can never read as healthy.

        Returns:
            (status, message, details)
        """
        source = get_miners_config_source()
        miners = get_miners_config()
        details = {
            "source": source,
            "miners_count": len(miners),
            "backend_url": BACKEND_URL,
            "config_path": MINERS_CONFIG,
        }

        # "Nothing has loaded yet" (startup) vs "loaded and empty" (a fault):
        # both leave the list empty, and neither depends on the source.
        if not has_loaded_miners_config():
            return (
                HealthStatus.DEGRADED,
                "Miner configuration has not been loaded yet",
                details
            )

        if not miners:
            return (
                HealthStatus.UNHEALTHY,
                f"No miners in the configuration (source: {source}) — nothing is being polled",
                details
            )

        if source == CONFIG_SOURCE_DATABASE:
            return (
                HealthStatus.HEALTHY,
                f"Config loaded from database API ({len(miners)} miners)",
                details
            )

        if source == CONFIG_SOURCE_YAML:
            return (
                HealthStatus.HEALTHY,
                f"Config loaded from {MINERS_CONFIG} ({len(miners)} miners); "
                "database config is disabled",
                details
            )

        if source == CONFIG_SOURCE_STALE_CACHE:
            return (
                HealthStatus.DEGRADED,
                f"Database API unreachable; serving the last known good miner list "
                f"({len(miners)} miners)",
                details
            )

        if source == CONFIG_SOURCE_YAML_FALLBACK:
            return (
                HealthStatus.DEGRADED,
                f"Database API unreachable; running on the YAML fallback "
                f"({len(miners)} miners from {MINERS_CONFIG}) — these may be example "
                "miners rather than the real fleet",
                details
            )

        # Any source not handled above is unknown; a miner list of unknown
        # provenance is exactly what this check exists to surface.
        return (
            HealthStatus.DEGRADED,
            f"Miner configuration came from an unrecognised source: {source}",
            details
        )
    
    def check_profile_library(self) -> Tuple[str, str, Dict]:
        """
        Check if ASIC profile library is loaded
        
        Returns:
            (status, message, details)
        """
        try:
            from asic_profile_loader import get_library
            
            library = get_library()
            stats = library.get_stats()
            
            if stats['total_profiles'] == 0:
                return (
                    HealthStatus.DEGRADED,
                    "Profile library loaded but contains no profiles",
                    stats
                )
            
            return (
                HealthStatus.HEALTHY,
                f"Profile library loaded ({stats['total_profiles']} profiles)",
                stats
            )
            
        except Exception as e:
            return (
                HealthStatus.DEGRADED,
                f"Profile library not available: {e}",
                {"error": str(e), "note": "Will use legacy fallback logic"}
            )
    
    def perform_full_check(self) -> Dict:
        """
        Perform all health checks and return comprehensive status
        
        Returns:
            Dictionary with overall status and individual check results
        """
        checks = {
            'collection_lock': self.check_collection_lock(),
            'last_collection': self.check_last_collection(),
            'config_file': self.check_config_file(),
            'profile_library': self.check_profile_library(),
        }
        
        # Determine overall status (worst status wins)
        status_priority = {
            HealthStatus.HEALTHY: 0,
            HealthStatus.DEGRADED: 1,
            HealthStatus.UNHEALTHY: 2
        }
        
        overall_status = HealthStatus.HEALTHY
        for check_name, (status, message, details) in checks.items():
            if status_priority[status] > status_priority[overall_status]:
                overall_status = status
        
        # Build response
        result = {
            'status': overall_status,
            'timestamp': datetime.now().isoformat(),
            'checks': {}
        }
        
        for check_name, (status, message, details) in checks.items():
            result['checks'][check_name] = {
                'status': status,
                'message': message,
                'details': details
            }
        
        return result
    
    def get_http_status_code(self, health_result: Dict) -> int:
        """
        Convert health status to HTTP status code
        
        Args:
            health_result: Result from perform_full_check()
        
        Returns:
            HTTP status code (200, 503, etc.)
        """
        status = health_result.get('status', HealthStatus.UNHEALTHY)
        
        if status == HealthStatus.HEALTHY:
            return 200
        elif status == HealthStatus.DEGRADED:
            return 200  # Still operational, just degraded
        else:  # UNHEALTHY
            return 503  # Service Unavailable
