"""
Service State Manager - Centralized state management with persistence
Replaces global variables with a managed, persistent state object
"""

import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Tuple
from threading import Lock

logger = logging.getLogger(__name__)


class ServiceState:
    """
    Centralized state management for the python-scheduler service.
    Handles persistence of collection state and failure tracking.
    """
    
    def __init__(self, storage_path: str = '/app/data/service_state.json'):
        """
        Initialize service state with optional persistence
        
        Args:
            storage_path: Path to JSON file for state persistence
        """
        self.storage_path = Path(storage_path)
        self._lock = Lock()  # Thread-safe access
        
        # Collection state
        self.last_collection: Dict[str, Any] = {
            'timestamp': None,
            'success': False,
            'message': '',
            'details': {}
        }
        
        # Failure streak tracking (per miner)
        # Key: (ip, name, model), Value: consecutive failure count
        self.failure_streaks: Dict[Tuple[str, str, str], int] = {}
        
        # Load persisted state if available
        self.load()
    
    def load(self) -> bool:
        """
        Load state from disk
        
        Returns:
            True if state was loaded successfully, False otherwise
        """
        try:
            if not self.storage_path.exists():
                logger.info(f"No persisted state found at {self.storage_path}")
                return False
            
            with self._lock:
                with open(self.storage_path, 'r') as f:
                    data = json.load(f)
                
                self.last_collection = data.get('last_collection', self.last_collection)
                
                # Convert failure_streaks keys from strings back to tuples
                raw_streaks = data.get('failure_streaks', {})
                self.failure_streaks = {}
                for key_str, value in raw_streaks.items():
                    # Parse "(ip, name, model)" string back to tuple
                    try:
                        key_tuple = eval(key_str)  # Safe here as we control the format
                        if isinstance(key_tuple, tuple) and len(key_tuple) == 3:
                            self.failure_streaks[key_tuple] = value
                    except Exception as e:
                        logger.warning(f"Failed to parse failure streak key: {key_str} - {e}")
                
                logger.info(f"Loaded state from {self.storage_path}")
                logger.info(f"  Last collection: {self.last_collection.get('timestamp', 'Never')}")
                logger.info(f"  Failure streaks: {len(self.failure_streaks)} miners tracked")
                return True
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse state file: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to load state: {e}")
            return False
    
    def save(self) -> bool:
        """
        Save state to disk
        
        Returns:
            True if state was saved successfully, False otherwise
        """
        try:
            with self._lock:
                # Ensure directory exists
                self.storage_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Convert failure_streaks keys from tuples to strings for JSON serialization
                serializable_streaks = {
                    str(key): value 
                    for key, value in self.failure_streaks.items()
                }
                
                data = {
                    'last_collection': self.last_collection,
                    'failure_streaks': serializable_streaks,
                    'saved_at': datetime.now().isoformat()
                }
                
                # Write atomically using a temp file
                temp_path = self.storage_path.with_suffix('.tmp')
                with open(temp_path, 'w') as f:
                    json.dump(data, f, indent=2)
                
                # Atomic rename
                temp_path.replace(self.storage_path)
                
                logger.debug(f"Saved state to {self.storage_path}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to save state: {e}")
            return False
    
    def update_last_collection(
        self, 
        success: bool, 
        message: str, 
        details: Dict[str, Any] = None
    ) -> None:
        """
        Update last collection state
        
        Args:
            success: Whether the collection was successful
            message: Status message
            details: Additional details about the collection
        """
        with self._lock:
            self.last_collection = {
                'timestamp': datetime.now().isoformat(),
                'success': success,
                'message': message,
                'details': details or {}
            }
    
    def increment_failure_streak(self, ip: str, name: str, model: str) -> int:
        """
        Increment failure streak for a miner
        
        Args:
            ip: Miner IP address
            name: Miner name
            model: Miner model
        
        Returns:
            New failure streak count
        """
        key = (ip, name, model)
        with self._lock:
            self.failure_streaks[key] = self.failure_streaks.get(key, 0) + 1
            return self.failure_streaks[key]
    
    def reset_failure_streak(self, ip: str, name: str, model: str) -> None:
        """
        Reset failure streak for a miner (called on successful collection)
        
        Args:
            ip: Miner IP address
            name: Miner name
            model: Miner model
        """
        key = (ip, name, model)
        with self._lock:
            self.failure_streaks[key] = 0
    
    def get_failure_streak(self, ip: str, name: str, model: str) -> int:
        """
        Get current failure streak for a miner
        
        Args:
            ip: Miner IP address
            name: Miner name
            model: Miner model
        
        Returns:
            Current failure streak count
        """
        key = (ip, name, model)
        with self._lock:
            return self.failure_streaks.get(key, 0)
    
    def get_last_collection(self) -> Dict[str, Any]:
        """
        Get last collection state (thread-safe)
        
        Returns:
            Copy of last collection state
        """
        with self._lock:
            return self.last_collection.copy()
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about current state
        
        Returns:
            Dictionary with state statistics
        """
        with self._lock:
            return {
                'last_collection_timestamp': self.last_collection.get('timestamp'),
                'last_collection_success': self.last_collection.get('success'),
                'tracked_miners': len(self.failure_streaks),
                'miners_with_failures': sum(1 for count in self.failure_streaks.values() if count > 0),
                'total_failure_count': sum(self.failure_streaks.values())
            }
