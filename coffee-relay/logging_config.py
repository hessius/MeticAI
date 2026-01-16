"""
Logging configuration for the Coffee Relay application.

Provides structured logging with:
- Rotating file handlers (size and count limits)
- JSON-formatted logs for easy parsing
- Context information (timestamp, level, user info, etc.)
- Separate handlers for different log levels
"""

import logging
import logging.handlers
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any
import traceback


class JSONFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging."""
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON with all relevant context."""
        log_data = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": traceback.format_exception(*record.exc_info)
            }
        
        # Add extra context from record
        if hasattr(record, 'request_id'):
            log_data["request_id"] = record.request_id
        if hasattr(record, 'endpoint'):
            log_data["endpoint"] = record.endpoint
        if hasattr(record, 'user_agent'):
            log_data["user_agent"] = record.user_agent
        if hasattr(record, 'client_ip'):
            log_data["client_ip"] = record.client_ip
        if hasattr(record, 'duration_ms'):
            log_data["duration_ms"] = record.duration_ms
        if hasattr(record, 'status_code'):
            log_data["status_code"] = record.status_code
        
        # Add any custom extra fields
        for key, value in record.__dict__.items():
            if key not in ['name', 'msg', 'args', 'created', 'filename', 'funcName', 
                          'levelname', 'levelno', 'lineno', 'module', 'msecs', 
                          'message', 'pathname', 'process', 'processName', 
                          'relativeCreated', 'thread', 'threadName', 'exc_info',
                          'exc_text', 'stack_info', 'request_id', 'endpoint',
                          'user_agent', 'client_ip', 'duration_ms', 'status_code']:
                log_data[key] = value
        
        return json.dumps(log_data)


class HumanReadableFormatter(logging.Formatter):
    """Human-readable formatter for console output."""
    
    def __init__(self):
        super().__init__(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )


def setup_logging(
    log_dir: str = "/app/logs",
    max_bytes: int = 10 * 1024 * 1024,  # 10 MB per file
    backup_count: int = 5,  # Keep 5 backup files (total 60 MB max)
    log_level: str = "INFO"
) -> logging.Logger:
    """
    Set up logging configuration with rotating file handlers.
    
    Args:
        log_dir: Directory to store log files
        max_bytes: Maximum size of each log file before rotation
        backup_count: Number of backup files to keep
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    
    Returns:
        Configured logger instance
    """
    # Create logs directory if it doesn't exist
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    
    # Get root logger
    logger = logging.getLogger("coffee-relay")
    logger.setLevel(getattr(logging, log_level.upper()))
    
    # Clear any existing handlers
    logger.handlers = []
    
    # Console handler with human-readable format
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(HumanReadableFormatter())
    logger.addHandler(console_handler)
    
    # All logs file (JSON format) - rotating
    all_logs_file = log_path / "coffee-relay.log"
    all_logs_handler = logging.handlers.RotatingFileHandler(
        all_logs_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding='utf-8'
    )
    all_logs_handler.setLevel(logging.DEBUG)
    all_logs_handler.setFormatter(JSONFormatter())
    logger.addHandler(all_logs_handler)
    
    # Error logs file (JSON format) - rotating, errors only
    error_logs_file = log_path / "coffee-relay-errors.log"
    error_logs_handler = logging.handlers.RotatingFileHandler(
        error_logs_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding='utf-8'
    )
    error_logs_handler.setLevel(logging.ERROR)
    error_logs_handler.setFormatter(JSONFormatter())
    logger.addHandler(error_logs_handler)
    
    logger.info(
        "Logging system initialized",
        extra={
            "log_dir": str(log_dir),
            "max_bytes": max_bytes,
            "backup_count": backup_count,
            "log_level": log_level
        }
    )
    
    return logger


def get_logger() -> logging.Logger:
    """Get the configured logger instance."""
    return logging.getLogger("coffee-relay")
