"""
Structured Logging Configuration
Provides JSON-formatted logging for better log aggregation and analysis
"""

import os
import sys
import logging
import json
from datetime import datetime
from typing import Any, Dict


class JSONFormatter(logging.Formatter):
    """
    Custom formatter that outputs logs as JSON for structured logging
    Compatible with Loki, Elasticsearch, and other log aggregation systems
    """
    
    def __init__(self, service_name: str = "python-scheduler"):
        super().__init__()
        self.service_name = service_name
        self.hostname = os.getenv('HOSTNAME', 'unknown')
    
    def format(self, record: logging.LogRecord) -> str:
        """
        Format log record as JSON
        
        Args:
            record: LogRecord to format
        
        Returns:
            JSON string
        """
        # Base log structure
        log_data = {
            'timestamp': datetime.utcfromtimestamp(record.created).isoformat() + 'Z',
            'level': record.levelname,
            'service': self.service_name,
            'logger': record.name,
            'message': record.getMessage(),
            'hostname': self.hostname,
        }
        
        # Add source location for warnings and errors
        if record.levelno >= logging.WARNING:
            log_data['source'] = {
                'file': record.pathname,
                'line': record.lineno,
                'function': record.funcName
            }
        
        # Add exception info if present
        if record.exc_info:
            log_data['exception'] = {
                'type': record.exc_info[0].__name__ if record.exc_info[0] else None,
                'message': str(record.exc_info[1]) if record.exc_info[1] else None,
                'traceback': self.formatException(record.exc_info)
            }
        
        # Add any extra fields from the log record
        # This allows contextual logging like: logger.info("msg", extra={'miner_ip': '192.168.1.1'})
        extra_fields = {}
        for key, value in record.__dict__.items():
            if key not in [
                'name', 'msg', 'args', 'created', 'filename', 'funcName',
                'levelname', 'levelno', 'lineno', 'module', 'msecs',
                'message', 'pathname', 'process', 'processName', 'relativeCreated',
                'thread', 'threadName', 'exc_info', 'exc_text', 'stack_info'
            ]:
                # Only include JSON-serializable values
                try:
                    json.dumps(value)
                    extra_fields[key] = value
                except (TypeError, ValueError):
                    extra_fields[key] = str(value)
        
        if extra_fields:
            log_data['extra'] = extra_fields
        
        return json.dumps(log_data)


class HumanReadableFormatter(logging.Formatter):
    """
    Human-readable formatter for local development
    Provides colored output and clear formatting
    """
    
    # ANSI color codes
    COLORS = {
        'DEBUG': '\033[36m',      # Cyan
        'INFO': '\033[32m',       # Green
        'WARNING': '\033[33m',    # Yellow
        'ERROR': '\033[31m',      # Red
        'CRITICAL': '\033[35m',   # Magenta
        'RESET': '\033[0m'
    }
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record with colors and clear structure"""
        # Add color if terminal supports it
        if sys.stderr.isatty():
            color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
            reset = self.COLORS['RESET']
            level = f"{color}{record.levelname:8}{reset}"
        else:
            level = f"{record.levelname:8}"
        
        # Format timestamp
        timestamp = datetime.fromtimestamp(record.created).strftime('%Y-%m-%d %H:%M:%S')
        
        # Build message
        message = record.getMessage()
        
        # Add source for warnings and errors
        if record.levelno >= logging.WARNING:
            source = f" [{record.filename}:{record.lineno}]"
        else:
            source = ""
        
        # Format exception if present
        if record.exc_info:
            exc_text = '\n' + self.formatException(record.exc_info)
        else:
            exc_text = ""
        
        return f"{timestamp} {level} {message}{source}{exc_text}"


def setup_logging(
    log_format: str = None,
    log_level: str = None,
    service_name: str = "python-scheduler"
) -> None:
    """
    Configure logging for the application
    
    Args:
        log_format: 'json' or 'human' (default: from LOG_FORMAT env var or 'human')
        log_level: Log level (default: from LOG_LEVEL env var or 'INFO')
        service_name: Service name for structured logs
    """
    # Get configuration from environment or use defaults
    if log_format is None:
        log_format = os.getenv('LOG_FORMAT', 'human').lower()
    
    if log_level is None:
        log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
    
    # Choose formatter
    if log_format == 'json':
        formatter = JSONFormatter(service_name=service_name)
    else:
        formatter = HumanReadableFormatter()
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level, logging.INFO))
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Log startup message
    logger = logging.getLogger(__name__)
    logger.info(
        f"Logging configured",
        extra={
            'log_format': log_format,
            'log_level': log_level,
            'service': service_name
        }
    )


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the given name
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Logger instance
    """
    return logging.getLogger(name)


# Context manager for adding context to logs
class LogContext:
    """
    Context manager for adding contextual information to all logs within a block
    
    Example:
        with LogContext(miner_ip='192.168.1.100', miner_name='Miner-01'):
            logger.info("Starting collection")  # Will include miner_ip and miner_name
    """
    
    def __init__(self, **context):
        self.context = context
        self.old_factory = None
    
    def __enter__(self):
        old_factory = logging.getLogRecordFactory()
        
        def record_factory(*args, **kwargs):
            record = old_factory(*args, **kwargs)
            for key, value in self.context.items():
                setattr(record, key, value)
            return record
        
        self.old_factory = old_factory
        logging.setLogRecordFactory(record_factory)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.old_factory:
            logging.setLogRecordFactory(self.old_factory)


# Convenience function for structured logging
def log_event(
    logger: logging.Logger,
    level: str,
    message: str,
    **context
) -> None:
    """
    Log an event with structured context
    
    Args:
        logger: Logger instance
        level: Log level ('debug', 'info', 'warning', 'error', 'critical')
        message: Log message
        **context: Additional context fields
    
    Example:
        log_event(logger, 'info', 'Collection complete',
                  duration_seconds=5.2, miners_collected=10)
    """
    log_method = getattr(logger, level.lower(), logger.info)
    log_method(message, extra=context)
