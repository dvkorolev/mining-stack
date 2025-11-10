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
        self.match = data.get('match', {})  # Embedded matching rules
        self.drivers = data.get('drivers', [])
        self.parser = data.get('parser', {})
        self.credentials = data.get('credentials', {})
        self.expected = data.get('expected', {})
        
        # Validate required fields
        self._validate()
    
    def _validate(self):
        """Validate profile data"""
        if not self.name:
            raise ValueError(f"Profile '{self.id}' missing required field: name")
        
        if self.algorithm not in ['sha256', 'scrypt']:
            logger.warning(f"Profile '{self.id}' has unusual algorithm: {self.algorithm}")
        
        if not self.drivers:
            raise ValueError(f"Profile '{self.id}' must have at least one driver")
        
        # Validate driver structure
        for driver in self.drivers:
            if 'type' not in driver:
                raise ValueError(f"Profile '{self.id}' has driver missing 'type' field")
            if 'priority' not in driver:
                logger.warning(f"Profile '{self.id}' driver '{driver.get('type')}' missing priority, using default")
        
        # Validate match rules exist
        if not self.match.get('exact') and not self.match.get('patterns'):
            logger.warning(f"Profile '{self.id}' has no matching rules (exact or patterns)")
    
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
    
    def get_expected_hashrate(self) -> Optional[float]:
        """
        Get expected hashrate for this profile
        
        Returns:
            Expected hashrate in TH/s, or None if not defined
        """
        hashrate_min = self.expected.get('hashrate_min')
        hashrate_max = self.expected.get('hashrate_max')
        
        if hashrate_min and hashrate_max:
            # Return average of min/max
            return (hashrate_min + hashrate_max) / 2
        elif hashrate_min:
            return hashrate_min
        elif hashrate_max:
            return hashrate_max
        
        return None
    
    def get_expected_board_count(self) -> Optional[int]:
        """
        Get expected number of hashboards for this profile
        
        Returns:
            Expected board count, or None if not defined
        """
        return self.expected.get('board_count')
    
    def get_expected_fan_count(self) -> Optional[int]:
        """
        Get expected number of fans for this profile
        
        Returns:
            Expected fan count, or None if not defined
        """
        return self.expected.get('fan_count')
    
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
            if not self.profiles_path.exists():
                raise FileNotFoundError(f"Profile file not found: {self.profiles_path}")
            
            with open(self.profiles_path, 'r') as f:
                data = yaml.safe_load(f)
            
            if not data:
                raise ValueError(f"Empty or invalid YAML file: {self.profiles_path}")
            
            # Clear existing data for reload
            self.profiles.clear()
            self.exact_matches.clear()
            self.pattern_matches.clear()
            
            # Load profiles
            profiles_data = data.get('profiles', {})
            if not profiles_data:
                logger.warning(f"No profiles found in {self.profiles_path}")
                return
            
            loaded_count = 0
            error_count = 0
            
            for profile_id, profile_data in profiles_data.items():
                try:
                    profile = ASICProfile(profile_id, profile_data)
                    self.profiles[profile_id] = profile
                    
                    # Build matching rules from embedded profile data
                    match_rules = profile_data.get('match', {})
                    
                    # Add exact matches
                    for exact_model in match_rules.get('exact', []):
                        if exact_model in self.exact_matches:
                            logger.warning(f"Duplicate exact match '{exact_model}' in profile '{profile_id}' (already in '{self.exact_matches[exact_model]}')")
                        self.exact_matches[exact_model] = profile_id
                    
                    # Add pattern matches
                    for pattern_str in match_rules.get('patterns', []):
                        try:
                            pattern = re.compile(pattern_str, re.IGNORECASE)
                            self.pattern_matches.append((pattern, profile_id))
                        except re.error as e:
                            logger.error(f"Invalid regex pattern '{pattern_str}' in profile '{profile_id}': {e}")
                            error_count += 1
                    
                    loaded_count += 1
                    
                except Exception as e:
                    logger.error(f"Failed to load profile '{profile_id}': {e}")
                    error_count += 1
            
            # Load defaults
            self.defaults = data.get('defaults', {})
            
            logger.info(f"Loaded {loaded_count} ASIC profiles from {self.profiles_path}")
            logger.debug(f"Built {len(self.exact_matches)} exact matches and {len(self.pattern_matches)} pattern matches")
            
            if error_count > 0:
                logger.warning(f"Encountered {error_count} errors while loading profiles")
            
        except Exception as e:
            logger.error(f"Failed to load ASIC profiles from {self.profiles_path}: {e}")
            raise
    
    def get_profile(self, model: str, algorithm: str = None) -> Optional[ASICProfile]:
        """
        Get profile for a miner model using intelligent matching.
        
        Args:
            model: Miner model string (e.g., "M30S++", "S19 Pro")
            algorithm: Optional algorithm override ('sha256' or 'scrypt')
        
        Returns:
            ASICProfile if found, None otherwise
        """
        if not model or not isinstance(model, str):
            return None
        
        # Ensure model is a string
        model = str(model)
        algorithm_override = algorithm
        
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
    
    def reload(self):
        """Reload profiles from file (hot-reload)"""
        logger.info("Reloading ASIC profiles...")
        try:
            self._load_profiles()
            logger.info("ASIC profiles reloaded successfully")
        except Exception as e:
            logger.error(f"Failed to reload profiles: {e}")
            raise
    
    def get_stats(self) -> Dict:
        """Get library statistics"""
        return {
            'total_profiles': len(self.profiles),
            'exact_matches': len(self.exact_matches),
            'pattern_matches': len(self.pattern_matches),
            'algorithms': {
                'sha256': len([p for p in self.profiles.values() if p.algorithm == 'sha256']),
                'scrypt': len([p for p in self.profiles.values() if p.algorithm == 'scrypt']),
            },
            'manufacturers': list(set(p.manufacturer for p in self.profiles.values())),
        }
    
    def validate_all(self) -> Dict:
        """Validate all profiles and return report"""
        report = {
            'valid': [],
            'warnings': [],
            'errors': [],
        }
        
        for profile_id, profile in self.profiles.items():
            try:
                profile._validate()
                report['valid'].append(profile_id)
            except ValueError as e:
                report['errors'].append({'profile': profile_id, 'error': str(e)})
        
        return report


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
