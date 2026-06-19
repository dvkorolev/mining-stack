"""
Health Check Module - Smart health verification for python-scheduler
Checks internal state and dependencies to provide meaningful health status
"""

import time
import logging
import requests
from pathlib import Path
from typing import Dict, List, Tuple
from datetime import datetime, timedelta

from config import MINERS_CONFIG, USE_DATABASE_CONFIG, SYSTEM_API_KEY, BACKEND_URL

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
        Check if miners.yaml config file is readable
        
        Returns:
            (status, message, details)
        """
        if USE_DATABASE_CONFIG and SYSTEM_API_KEY:
            try:
                response = requests.get(
                    f"{BACKEND_URL}/api/mining/miners",
                    headers={'X-API-Key': SYSTEM_API_KEY},
                    timeout=2
                )
                if response.status_code == 200:
                    return (
                        HealthStatus.HEALTHY,
                        "Config loaded from database API",
                        {
                            "source": "database_api",
                            "backend_url": BACKEND_URL,
                        }
                    )
            except Exception as e:
                pass

        config_path = Path(MINERS_CONFIG)
        
        if not config_path.exists():
            if USE_DATABASE_CONFIG and SYSTEM_API_KEY:
                return (
                    HealthStatus.DEGRADED,
                    f"Database config unavailable and YAML config not found: {MINERS_CONFIG}",
                    {"config_path": str(config_path), "source": "database_api"}
                )
            return (
                HealthStatus.UNHEALTHY,
                f"Config file not found: {MINERS_CONFIG}",
                {"config_path": str(config_path)}
            )
        
        if not config_path.is_file():
            return (
                HealthStatus.UNHEALTHY,
                f"Config path is not a file: {MINERS_CONFIG}",
                {"config_path": str(config_path)}
            )
        
        try:
            # Try to read the file
            with open(config_path, 'r') as f:
                content = f.read()
            
            if not content.strip():
                return (
                    HealthStatus.DEGRADED,
                    "Config file is empty",
                    {"config_path": str(config_path)}
                )
            
            return (
                HealthStatus.HEALTHY,
                "Config file is readable",
                {
                    "config_path": str(config_path),
                    "file_size_bytes": config_path.stat().st_size
                }
            )
            
        except PermissionError:
            return (
                HealthStatus.UNHEALTHY,
                f"Config file is not readable (permission denied): {MINERS_CONFIG}",
                {"config_path": str(config_path)}
            )
        except Exception as e:
            return (
                HealthStatus.UNHEALTHY,
                f"Failed to read config file: {e}",
                {"config_path": str(config_path), "error": str(e)}
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
