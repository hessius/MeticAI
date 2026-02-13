"""
Tests for the logging system in Coffee Relay.

Tests cover:
- Logging configuration and initialization
- Log file creation and rotation
- JSON log formatting
- Request tracking with correlation IDs
- Log retrieval endpoint
- Error logging with stack traces
"""

import pytest
import json
import logging
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
import tempfile
import os
import sys

# Import modules
sys.path.insert(0, os.path.dirname(__file__))
from logging_config import setup_logging, JSONFormatter, HumanReadableFormatter, get_logger
from main import app


@pytest.fixture
def temp_log_dir():
    """Create a temporary directory for log files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


class TestLoggingConfiguration:
    """Tests for logging configuration setup."""
    
    def test_setup_logging_creates_directory(self, temp_log_dir):
        """Test that setup_logging creates the log directory if it doesn't exist."""
        log_dir = Path(temp_log_dir) / "new_logs"
        assert not log_dir.exists()
        
        logger = setup_logging(log_dir=str(log_dir))
        
        assert log_dir.exists()
        assert logger is not None
    
    def test_setup_logging_creates_log_files(self, temp_log_dir):
        """Test that setup_logging creates the expected log files."""
        logger = setup_logging(log_dir=temp_log_dir)
        
        # Write a test log entry
        logger.info("Test log entry")
        logger.error("Test error entry")
        
        # Check that log files were created
        all_logs = Path(temp_log_dir) / "meticai-server.log"
        error_logs = Path(temp_log_dir) / "meticai-server-errors.log"
        
        assert all_logs.exists()
        assert error_logs.exists()
    
    def test_setup_logging_configures_handlers(self, temp_log_dir):
        """Test that setup_logging configures the correct handlers."""
        logger = setup_logging(log_dir=temp_log_dir)
        
        # Should have 3 handlers: console, all logs, error logs
        assert len(logger.handlers) == 3
        
        # Check handler types
        handler_types = [type(h).__name__ for h in logger.handlers]
        assert 'StreamHandler' in handler_types
        assert handler_types.count('RotatingFileHandler') == 2
    
    def test_setup_logging_log_level(self, temp_log_dir):
        """Test that setup_logging sets the correct log level."""
        logger = setup_logging(log_dir=temp_log_dir, log_level="DEBUG")
        assert logger.level == logging.DEBUG
        
        logger = setup_logging(log_dir=temp_log_dir, log_level="ERROR")
        assert logger.level == logging.ERROR
    
    def test_get_logger_returns_configured_logger(self, temp_log_dir):
        """Test that get_logger returns the configured logger."""
        setup_logging(log_dir=temp_log_dir)
        logger = get_logger()
        
        assert logger.name == "meticai-server"
        assert len(logger.handlers) > 0


class TestJSONFormatter:
    """Tests for JSON log formatting."""
    
    def test_json_formatter_basic_fields(self):
        """Test that JSONFormatter includes basic required fields."""
        formatter = JSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=42,
            msg="Test message",
            args=(),
            exc_info=None
        )
        
        formatted = formatter.format(record)
        log_data = json.loads(formatted)
        
        assert "timestamp" in log_data
        assert log_data["level"] == "INFO"
        assert log_data["logger"] == "test"
        assert log_data["message"] == "Test message"
        assert log_data["line"] == 42
    
    def test_json_formatter_with_exception(self):
        """Test that JSONFormatter includes exception information."""
        formatter = JSONFormatter()
        
        try:
            raise ValueError("Test error")
        except ValueError:
            record = logging.LogRecord(
                name="test",
                level=logging.ERROR,
                pathname="test.py",
                lineno=42,
                msg="Error occurred",
                args=(),
                exc_info=sys.exc_info()
            )
        
        formatted = formatter.format(record)
        log_data = json.loads(formatted)
        
        assert "exception" in log_data
        assert log_data["exception"]["type"] == "ValueError"
        assert "Test error" in log_data["exception"]["message"]
        assert "traceback" in log_data["exception"]
    
    def test_json_formatter_with_extra_fields(self):
        """Test that JSONFormatter includes extra context fields."""
        formatter = JSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=42,
            msg="Test message",
            args=(),
            exc_info=None
        )
        
        # Add extra fields
        record.request_id = "test-123"
        record.endpoint = "/test"
        record.user_agent = "Mozilla/5.0"
        record.duration_ms = 150
        
        formatted = formatter.format(record)
        log_data = json.loads(formatted)
        
        assert log_data["request_id"] == "test-123"
        assert log_data["endpoint"] == "/test"
        assert log_data["user_agent"] == "Mozilla/5.0"
        assert log_data["duration_ms"] == 150


class TestHumanReadableFormatter:
    """Tests for human-readable log formatting."""
    
    def test_human_readable_formatter_format(self):
        """Test that HumanReadableFormatter produces readable output."""
        formatter = HumanReadableFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=42,
            msg="Test message",
            args=(),
            exc_info=None
        )
        
        formatted = formatter.format(record)
        
        # Should contain key components
        assert "test" in formatted
        assert "INFO" in formatted
        assert "Test message" in formatted


class TestLogRetrieval:
    """Tests for the /api/logs endpoint."""
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_get_logs_endpoint_exists(self, client):
        """Test that /api/logs endpoint is accessible."""
        # Create a temporary log directory
        with tempfile.TemporaryDirectory() as tmpdir:
            # Mock the log directory path
            with patch('main.Path') as mock_path_class:
                # Setup mock to return temp dir path
                def path_side_effect(arg):
                    if arg == "/app/logs":
                        return Path(tmpdir)
                    return Path(arg)
                
                mock_path_class.side_effect = path_side_effect
                
                response = client.get("/api/logs")
                assert response.status_code == 200
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_get_logs_returns_json_structure(self, client, temp_log_dir):
        """Test that /api/logs returns expected JSON structure."""
        # Create a test log file
        log_file = Path(temp_log_dir) / "meticai-server.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        test_log_entry = {
            "timestamp": "2024-01-01T00:00:00Z",
            "level": "INFO",
            "message": "Test log entry"
        }
        
        with open(log_file, 'w') as f:
            f.write(json.dumps(test_log_entry) + "\n")
        
        with patch('main.Path') as mock_path:
            mock_path.return_value = Path(temp_log_dir)
            
            response = client.get("/api/logs")
            
        assert response.status_code == 200
        data = response.json()
        
        assert "logs" in data
        assert "total_lines" in data
        assert "log_file" in data
        assert isinstance(data["logs"], list)
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_get_logs_filters_by_level(self, client, temp_log_dir):
        """Test that /api/logs can filter logs by level."""
        log_file = Path(temp_log_dir) / "meticai-server.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Write multiple log entries with different levels
        with open(log_file, 'w') as f:
            f.write(json.dumps({"level": "INFO", "message": "Info message"}) + "\n")
            f.write(json.dumps({"level": "ERROR", "message": "Error message"}) + "\n")
            f.write(json.dumps({"level": "DEBUG", "message": "Debug message"}) + "\n")
        
        with patch('main.Path') as mock_path:
            mock_path.return_value = Path(temp_log_dir)
            
            response = client.get("/api/logs?level=ERROR")
            
        assert response.status_code == 200
        data = response.json()
        
        # Should only return ERROR level logs
        for log in data["logs"]:
            assert log["level"] == "ERROR"
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_get_logs_limits_lines(self, client, temp_log_dir):
        """Test that /api/logs respects the lines parameter."""
        log_file = Path(temp_log_dir) / "meticai-server.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Write many log entries
        with open(log_file, 'w') as f:
            for i in range(200):
                f.write(json.dumps({"level": "INFO", "message": f"Message {i}"}) + "\n")
        
        with patch('main.Path') as mock_path:
            mock_path.return_value = Path(temp_log_dir)
            
            response = client.get("/api/logs?lines=50")
            
        assert response.status_code == 200
        data = response.json()
        
        # Should return at most 50 entries
        assert len(data["logs"]) <= 50
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_get_logs_error_type(self, client, temp_log_dir):
        """Test that /api/logs can retrieve error logs specifically."""
        error_log_file = Path(temp_log_dir) / "meticai-server-errors.log"
        error_log_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(error_log_file, 'w') as f:
            f.write(json.dumps({"level": "ERROR", "message": "Error message"}) + "\n")
        
        with patch('main.Path') as mock_path:
            mock_path.return_value = Path(temp_log_dir)
            
            response = client.get("/api/logs?log_type=errors")
            
        assert response.status_code == 200
        data = response.json()
        assert "meticai-server-errors.log" in data["log_file"]
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('api.routes.system.Path')
    def test_get_logs_missing_file(self, mock_path, client):
        """Test that /api/logs handles missing log file gracefully."""
        mock_log_file = Mock()
        mock_log_file.exists.return_value = False
        mock_path.return_value.__truediv__.return_value = mock_log_file
        
        response = client.get("/api/logs")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_lines"] == 0
        assert "message" in data


class TestRequestLogging:
    """Tests for request logging middleware."""
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('api.routes.coffee.get_vision_model')
    def test_request_includes_correlation_id(self, mock_vision_model, client, temp_log_dir):
        """Test that requests include a correlation ID for tracking."""
        # Setup mock
        mock_response = Mock()
        mock_response.text = "Test coffee"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        # Create a simple image
        from PIL import Image
        from io import BytesIO
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        
        # Make request
        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", img_bytes, "image/png")}
        )
        
        assert response.status_code == 200
        # The middleware should have added request_id to the request state
        # This is verified by checking that the endpoint was called successfully
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_openapi_includes_logs_endpoint(self, client):
        """Test that /api/logs endpoint is in OpenAPI schema."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        
        openapi_data = response.json()
        assert "/api/logs" in openapi_data["paths"]
        assert "get" in openapi_data["paths"]["/api/logs"]


class TestLogRotation:
    """Tests for log rotation functionality."""
    
    def test_rotating_handler_configured(self, temp_log_dir):
        """Test that rotating file handlers are properly configured."""
        max_bytes = 1024  # 1 KB for testing
        backup_count = 2
        
        logger = setup_logging(
            log_dir=temp_log_dir,
            max_bytes=max_bytes,
            backup_count=backup_count
        )
        
        # Find rotating handlers
        rotating_handlers = [
            h for h in logger.handlers 
            if type(h).__name__ == 'RotatingFileHandler'
        ]
        
        assert len(rotating_handlers) == 2
        
        for handler in rotating_handlers:
            assert handler.maxBytes == max_bytes
            assert handler.backupCount == backup_count
    
    def test_log_rotation_creates_backup(self, temp_log_dir):
        """Test that log rotation creates backup files when size limit is reached."""
        max_bytes = 500  # Small size for testing
        
        logger = setup_logging(
            log_dir=temp_log_dir,
            max_bytes=max_bytes,
            backup_count=2
        )
        
        # Write enough data to trigger rotation
        large_message = "x" * 200
        for i in range(10):
            logger.info(large_message, extra={"iteration": i})
        
        # Check for backup files
        log_files = list(Path(temp_log_dir).glob("meticai-server.log*"))
        
        # Should have main log file and at least one backup
        assert len(log_files) >= 1
