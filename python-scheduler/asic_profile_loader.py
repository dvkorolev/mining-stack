"""
ASIC Profile Loader
Loads and manages ASIC profiles from asic_profiles.yaml
"""

import re
import yaml
from pathlib import Path
from typing import Dict, Optional, List
import logging

logger = logging.getLogger(__name__)


class ASICProfile:
    """Represents a single ASIC profile"""
    
    def __init__(self, profile_id: str, data: Dict):
        self.id = profile_id
        self.name = data.get('name', profile_id)
        self.manufacturer = data.get('manufacturer', 'Unknown')
        self.algorithm = data.get('algorithm', 'sha256')
        self.models = data.get('models', [])
        self.drivers = data.get('drivers', [])
        self.parser = data.get('parser', {})
        self.credentials = data.get('credentials', {})
        self.expected = data.get('expected', {})
    
    def get_driver_config(self, driver_type: str) -> Optional[Dict]:
        """Get configuration for a specific driver type"""
        for driver in self.drivers:
            if driver.get('type') == driver_type:
                return driver.get('config', {})
        return None
    
    def get_parser_quirks(self) -> Dict:
        """Get parser quirks for this profile"""
        return self.parser.get('quirks', {})
    
    def get_parser_type(self) -> str:
        """Get parser type"""
        return self.parser.get('type', 'generic')
    
    def get_ordered_drivers(self) -> List[Dict]:
        """Get drivers ordered by priority"""
        return sorted(self.drivers, key=lambda d: d.get('priority', 999))
    
    def __repr__(self):
        return f"ASICProfile({self.id}, {self.name}, {self.algorithm})"


class ASICProfileLibrary:
    """Manages the ASIC profile library"""
    
    def __init__(self, profiles_path: str = None):
        if profiles_path is None:
            profiles_path = Path(__file__).parent / "asic_profiles.yaml"
        
        self.profiles_path = Path(profiles_path)
        self.profiles: Dict[str, ASICProfile] = {}
        self.exact_matches: Dict[str, str] = {}
        self.pattern_matches: List[tuple] = []
        self.defaults: Dict = {}
        
        self._load_profiles()
    
    def _load_profiles(self):
        """Load profiles from YAML file"""
        try:
            with open(self.profiles_path, 'r') as f:
                data = yaml.safe_load(f)
            
            # Load profiles
            profiles_data = data.get('profiles', {})
            for profile_id, profile_data in profiles_data.items():
                self.profiles[profile_id] = ASICProfile(profile_id, profile_data)
            
            # Load matching rules
            matching = data.get('matching', {})
            self.exact_matches = matching.get('exact', {})
            
            pattern_list = matching.get('patterns', [])
            for pattern_entry in pattern_list:
                pattern = pattern_entry.get('pattern')
                profile_id = pattern_entry.get('profile')
                if pattern and profile_id:
                    self.pattern_matches.append((re.compile(pattern, re.IGNORECASE), profile_id))
            
            # Load defaults
            self.defaults = data.get('defaults', {})
            
            logger.info(f"Loaded {len(self.profiles)} ASIC profiles from {self.profiles_path}")
            
        except Exception as e:
            logger.error(f"Failed to load ASIC profiles: {e}")
            raise
    
    def get_profile(self, model: str, algorithm_override: str = None) -> Optional[ASICProfile]:
        """
        Get profile for a miner model.
        
        Args:
            model: Miner model string
            algorithm_override: Explicit algorithm override from config
        
        Returns:
            ASICProfile or None
        """
        # Try exact match first
        if model in self.exact_matches:
            profile_id = self.exact_matches[model]
            profile = self.profiles.get(profile_id)
            if profile:
                logger.debug(f"Matched '{model}' to profile '{profile_id}' (exact)")
                return profile
        
        # Try pattern matching
        for pattern, profile_id in self.pattern_matches:
            if pattern.search(model):
                profile = self.profiles.get(profile_id)
                if profile:
                    logger.debug(f"Matched '{model}' to profile '{profile_id}' (pattern)")
                    return profile
        
        # If algorithm override is provided, try to find any profile with that algorithm
        if algorithm_override:
            for profile in self.profiles.values():
                if profile.algorithm == algorithm_override.lower():
                    logger.warning(f"No exact match for '{model}', using algorithm-based profile '{profile.id}'")
                    return profile
        
        logger.warning(f"No profile found for model '{model}'")
        return None
    
    def get_profile_by_id(self, profile_id: str) -> Optional[ASICProfile]:
        """Get profile by ID"""
        return self.profiles.get(profile_id)
    
    def list_profiles(self) -> List[str]:
        """List all profile IDs"""
        return list(self.profiles.keys())
    
    def get_default(self, key: str, default=None):
        """Get a default value"""
        return self.defaults.get(key, default)


# Global instance
_library = None


def get_library() -> ASICProfileLibrary:
    """Get the global ASIC profile library instance"""
    global _library
    if _library is None:
        _library = ASICProfileLibrary()
    return _library


def reload_library():
    """Reload the profile library (useful for hot-reloading)"""
    global _library
    _library = ASICProfileLibrary()
    return _library
