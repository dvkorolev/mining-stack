"""
Pydantic Models for API Request/Response Validation

These models ensure all API endpoints receive valid, well-formed data.
FastAPI automatically validates requests against these models and returns
422 Unprocessable Entity for invalid data.
"""

from pydantic import BaseModel, Field, validator, constr, conint
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime


# ============================================================================
# Miner Models
# ============================================================================

class MinerConfig(BaseModel):
    """Miner configuration model with strict validation"""
    
    name: constr(min_length=1, max_length=100) = Field(
        ...,
        description="Miner name (1-100 characters)",
        example="miner-1"
    )
    ip: constr(pattern=r'^(\d{1,3}\.){3}\d{1,3}$') = Field(
        ...,
        description="IPv4 address",
        example="192.168.1.100"
    )
    model: constr(min_length=1, max_length=100) = Field(
        ...,
        description="Miner model",
        example="Antminer S19j Pro"
    )
    alias: Optional[constr(max_length=100)] = Field(
        None,
        description="Miner alias/nickname",
        example="Miner 1"
    )
    owner: Optional[constr(max_length=100)] = Field(
        None,
        description="Miner owner",
        example="Farm Owner"
    )
    
    @validator('ip')
    def validate_ip(cls, v):
        """Validate IP address octets are in valid range"""
        octets = v.split('.')
        for octet in octets:
            if not 0 <= int(octet) <= 255:
                raise ValueError(f'Invalid IP address: {v}')
        return v
    
    class Config:
        schema_extra = {
            "example": {
                "name": "miner-1",
                "ip": "192.168.1.100",
                "model": "Antminer S19j Pro",
                "alias": "Miner 1",
                "owner": "Farm Owner"
            }
        }


class MinersConfigFile(BaseModel):
    """Complete miners.yaml configuration"""
    
    miners: List[MinerConfig] = Field(
        ...,
        min_items=0,
        max_items=1000,
        description="List of miner configurations"
    )


# ============================================================================
# Pool Models
# ============================================================================

class PoolConfig(BaseModel):
    """Pool configuration model with strict validation"""
    
    url: constr(pattern=r'^[a-zA-Z0-9.-]+:\d{1,5}$') = Field(
        ...,
        description="Pool URL in format hostname:port",
        example="stratum.slushpool.com:3333"
    )
    name: constr(min_length=1, max_length=100) = Field(
        ...,
        description="Pool name",
        example="SlushPool"
    )
    algorithm: Literal['sha256', 'scrypt', 'multi'] = Field(
        ...,
        description="Mining algorithm",
        example="sha256"
    )
    priority: Literal['high', 'medium', 'low'] = Field(
        ...,
        description="Pool priority",
        example="high"
    )
    
    @validator('url')
    def validate_url(cls, v):
        """Validate port number is in valid range"""
        try:
            hostname, port_str = v.rsplit(':', 1)
            port = int(port_str)
            if not 1 <= port <= 65535:
                raise ValueError(f'Port must be between 1 and 65535, got {port}')
            if not hostname:
                raise ValueError('Hostname cannot be empty')
            return v
        except ValueError as e:
            raise ValueError(f'Invalid pool URL format: {e}')
    
    class Config:
        schema_extra = {
            "example": {
                "url": "stratum.slushpool.com:3333",
                "name": "SlushPool",
                "algorithm": "sha256",
                "priority": "high"
            }
        }


class PoolsConfigSettings(BaseModel):
    """Pool monitoring settings"""
    
    test_interval: conint(ge=1, le=60) = Field(
        5,
        description="Test interval in minutes (1-60)",
        example=5
    )
    enable_ping: bool = Field(
        False,
        description="Enable ICMP ping tests",
        example=False
    )
    connection_timeout: conint(ge=1, le=30) = Field(
        5,
        description="Connection timeout in seconds (1-30)",
        example=5
    )
    dns_timeout: conint(ge=1, le=10) = Field(
        3,
        description="DNS timeout in seconds (1-10)",
        example=3
    )


class PoolsConfigFile(BaseModel):
    """Complete pools.yaml configuration"""
    
    pools: List[PoolConfig] = Field(
        ...,
        min_items=0,
        max_items=100,
        description="List of pool configurations"
    )
    config: PoolsConfigSettings = Field(
        ...,
        description="Pool monitoring settings"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "pools": [
                    {
                        "url": "stratum.slushpool.com:3333",
                        "name": "SlushPool",
                        "algorithm": "sha256",
                        "priority": "high"
                    }
                ],
                "config": {
                    "test_interval": 5,
                    "enable_ping": False,
                    "connection_timeout": 5,
                    "dns_timeout": 3
                }
            }
        }


# ============================================================================
# Collection Models
# ============================================================================

class CollectionTrigger(BaseModel):
    """Manual collection trigger request"""
    
    force: bool = Field(
        False,
        description="Force collection even if one is in progress",
        example=False
    )
    collectors: Optional[List[Literal['miners', 'pools', 'all']]] = Field(
        None,
        description="Specific collectors to run (default: all)",
        example=["miners", "pools"]
    )


class CollectionResponse(BaseModel):
    """Collection operation response"""
    
    success: bool = Field(..., description="Operation success status")
    message: str = Field(..., description="Human-readable message")
    timestamp: datetime = Field(..., description="Operation timestamp")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional details")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "Collection started in background",
                "timestamp": "2025-11-04T15:00:00Z",
                "details": {
                    "collectors": ["miners", "pools"],
                    "estimated_duration": "30s"
                }
            }
        }


# ============================================================================
# Job Models
# ============================================================================

class JobStatus(BaseModel):
    """Job status information"""
    
    id: str = Field(..., description="Job ID")
    name: str = Field(..., description="Job name")
    next_run_time: Optional[datetime] = Field(None, description="Next scheduled run")
    trigger: str = Field(..., description="Trigger type")
    
    class Config:
        schema_extra = {
            "example": {
                "id": "collect_miners",
                "name": "Collect Miner Metrics",
                "next_run_time": "2025-11-04T15:02:00Z",
                "trigger": "interval[0:02:00]"
            }
        }


class JobsResponse(BaseModel):
    """Jobs list response"""
    
    jobs: Dict[str, JobStatus] = Field(..., description="Active jobs")
    total: int = Field(..., description="Total number of jobs")
    
    class Config:
        schema_extra = {
            "example": {
                "jobs": {
                    "collect_miners": {
                        "id": "collect_miners",
                        "name": "Collect Miner Metrics",
                        "next_run_time": "2025-11-04T15:02:00Z",
                        "trigger": "interval[0:02:00]"
                    }
                },
                "total": 1
            }
        }


# ============================================================================
# Health Check Models
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response"""
    
    status: Literal['healthy', 'unhealthy', 'degraded'] = Field(
        ...,
        description="Service health status"
    )
    timestamp: datetime = Field(..., description="Check timestamp")
    uptime: float = Field(..., description="Service uptime in seconds")
    version: Optional[str] = Field(None, description="Service version")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional health details")
    
    class Config:
        schema_extra = {
            "example": {
                "status": "healthy",
                "timestamp": "2025-11-04T15:00:00Z",
                "uptime": 3600.5,
                "version": "3.0.0",
                "details": {
                    "scheduler": "running",
                    "jobs": 3,
                    "last_collection": "2025-11-04T14:58:00Z"
                }
            }
        }


# ============================================================================
# Error Models
# ============================================================================

class ErrorResponse(BaseModel):
    """Standard error response"""
    
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(None, description="Error details")
    timestamp: datetime = Field(..., description="Error timestamp")
    
    class Config:
        schema_extra = {
            "example": {
                "error": "ValidationError",
                "message": "Invalid input data",
                "details": {
                    "field": "port",
                    "issue": "Port must be between 1 and 65535"
                },
                "timestamp": "2025-11-04T15:00:00Z"
            }
        }


# ============================================================================
# Validation Utilities
# ============================================================================

def validate_port(port: Any) -> int:
    """
    Validate and convert port number
    
    Args:
        port: Port number (int or str)
        
    Returns:
        Validated port number as int
        
    Raises:
        ValueError: If port is invalid
    """
    try:
        port_int = int(port)
        if not 1 <= port_int <= 65535:
            raise ValueError(f'Port must be between 1 and 65535, got {port_int}')
        return port_int
    except (TypeError, ValueError) as e:
        raise ValueError(f'Invalid port number: {e}')


def validate_ip_address(ip: str) -> str:
    """
    Validate IPv4 address
    
    Args:
        ip: IP address string
        
    Returns:
        Validated IP address
        
    Raises:
        ValueError: If IP is invalid
    """
    try:
        octets = ip.split('.')
        if len(octets) != 4:
            raise ValueError('IP must have 4 octets')
        
        for octet in octets:
            num = int(octet)
            if not 0 <= num <= 255:
                raise ValueError(f'Octet {num} out of range (0-255)')
        
        return ip
    except (ValueError, AttributeError) as e:
        raise ValueError(f'Invalid IP address: {e}')


def validate_hostname(hostname: str) -> str:
    """
    Validate hostname
    
    Args:
        hostname: Hostname string
        
    Returns:
        Validated hostname
        
    Raises:
        ValueError: If hostname is invalid
    """
    if not hostname or len(hostname) > 253:
        raise ValueError('Hostname must be 1-253 characters')
    
    # Basic hostname validation (simplified)
    if not all(c.isalnum() or c in '.-' for c in hostname):
        raise ValueError('Hostname contains invalid characters')
    
    return hostname
