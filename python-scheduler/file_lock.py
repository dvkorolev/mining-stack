"""
File Locking Utility for Config Files

Provides a robust file-based locking mechanism to prevent race conditions
when multiple processes attempt to write to shared configuration files.

This prevents catastrophic config corruption that could bring down the entire stack.
"""

import os
import time
import logging
from contextlib import contextmanager
from typing import Generator, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class FileLockError(Exception):
    """Raised when a file lock cannot be acquired"""
    pass


class FileLockTimeout(FileLockError):
    """Raised when lock acquisition times out"""
    pass


@contextmanager
def with_config_lock(
    filename: str,
    timeout: float = 10.0,
    poll_interval: float = 0.1
) -> Generator[None, None, None]:
    """
    Context manager that acquires an exclusive lock on a config file.
    
    Creates a .lock file to prevent concurrent writes. Uses a try...finally
    block to guarantee the lock is released even if an exception occurs.
    
    Args:
        filename: Path to the config file to lock
        timeout: Maximum time to wait for lock acquisition (seconds)
        poll_interval: Time between lock acquisition attempts (seconds)
    
    Raises:
        FileLockTimeout: If lock cannot be acquired within timeout period
        
    Example:
        with with_config_lock('/app/etc/pools.yaml'):
            # Write to file safely
            with open('/app/etc/pools.yaml', 'w') as f:
                yaml.dump(config, f)
    """
    lock_file = f"{filename}.lock"
    lock_acquired = False
    start_time = time.time()
    
    try:
        # Try to acquire lock
        while True:
            try:
                # Create lock file exclusively (fails if exists)
                # Using os.O_CREAT | os.O_EXCL ensures atomic creation
                fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                
                # Write process info to lock file for debugging
                lock_info = f"PID: {os.getpid()}\nTime: {time.time()}\n"
                os.write(fd, lock_info.encode())
                os.close(fd)
                
                lock_acquired = True
                logger.debug(f"Acquired lock on {filename}")
                break
                
            except FileExistsError:
                # Lock file exists, check if it's stale
                elapsed = time.time() - start_time
                
                if elapsed >= timeout:
                    # Try to read lock file to see who has it
                    lock_holder = "unknown"
                    try:
                        with open(lock_file, 'r') as f:
                            lock_holder = f.read().strip()
                    except Exception:
                        pass
                    
                    raise FileLockTimeout(
                        f"Failed to acquire lock on {filename} after {timeout}s. "
                        f"Lock held by: {lock_holder}"
                    )
                
                # Wait and retry
                logger.debug(f"Waiting for lock on {filename} ({elapsed:.1f}s elapsed)")
                time.sleep(poll_interval)
        
        # Lock acquired, yield control to caller
        yield
        
    finally:
        # Always release lock, even if exception occurred
        if lock_acquired:
            try:
                os.remove(lock_file)
                logger.debug(f"Released lock on {filename}")
            except FileNotFoundError:
                # Lock file already removed (shouldn't happen, but not critical)
                logger.warning(f"Lock file {lock_file} was already removed")
            except Exception as e:
                # Log but don't raise - we don't want to mask the original exception
                logger.error(f"Error releasing lock on {filename}: {e}")


def check_lock_status(filename: str) -> Optional[dict]:
    """
    Check if a file is currently locked.
    
    Args:
        filename: Path to the config file
        
    Returns:
        Dict with lock info if locked, None if not locked
    """
    lock_file = f"{filename}.lock"
    
    if not os.path.exists(lock_file):
        return None
    
    try:
        with open(lock_file, 'r') as f:
            content = f.read()
        
        # Parse lock info
        info = {}
        for line in content.strip().split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                info[key.strip()] = value.strip()
        
        # Add lock file age
        lock_age = time.time() - os.path.getmtime(lock_file)
        info['age_seconds'] = lock_age
        
        return info
        
    except Exception as e:
        logger.error(f"Error reading lock file {lock_file}: {e}")
        return {'error': str(e)}


def force_release_lock(filename: str) -> bool:
    """
    Force release a lock (use with caution!).
    
    This should only be used in emergency situations where a lock
    is stuck due to a crashed process.
    
    Args:
        filename: Path to the config file
        
    Returns:
        True if lock was released, False if no lock existed
    """
    lock_file = f"{filename}.lock"
    
    try:
        os.remove(lock_file)
        logger.warning(f"Force released lock on {filename}")
        return True
    except FileNotFoundError:
        return False
    except Exception as e:
        logger.error(f"Error force releasing lock on {filename}: {e}")
        raise


# Convenience function for common use case
@contextmanager
def safe_write_yaml(filename: str, timeout: float = 10.0) -> Generator[None, None, None]:
    """
    Context manager for safely writing YAML config files with locking.
    
    Example:
        with safe_write_yaml('/app/etc/pools.yaml'):
            with open('/app/etc/pools.yaml', 'w') as f:
                yaml.dump(config, f)
    """
    with with_config_lock(filename, timeout=timeout):
        yield


@contextmanager
def safe_write_json(filename: str, timeout: float = 10.0) -> Generator[None, None, None]:
    """
    Context manager for safely writing JSON config files with locking.
    
    Example:
        with safe_write_json('/app/etc/config.json'):
            with open('/app/etc/config.json', 'w') as f:
                json.dump(config, f)
    """
    with with_config_lock(filename, timeout=timeout):
        yield
