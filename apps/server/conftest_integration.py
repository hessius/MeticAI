"""
Pytest configuration for integration tests with real Meticulous machine.

This module provides fixtures for integration tests that require a real
Meticulous machine connection. Integration tests are opt-in and require
the TEST_INTEGRATION environment variable to be set.

Note: Pytest does not auto-load this file because it is not named
      ``conftest.py``. You must explicitly load it as a plugin.

Usage:
    export METICULOUS_IP=192.168.x.x
    export TEST_INTEGRATION=true
    # From apps/server/, explicitly load this module as a Pytest plugin
    pytest -p conftest_integration test_integration*.py -v

    # Alternatively, set the environment variable:
    export PYTEST_PLUGINS=conftest_integration
    pytest test_integration*.py -v
"""

import os
import pytest
import time


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as integration test requiring real machine"
    )


def pytest_collection_modifyitems(config, items):
    """Skip integration tests unless TEST_INTEGRATION is set."""
    skip_integration = pytest.mark.skip(
        reason="Integration tests require TEST_INTEGRATION=true environment variable"
    )
    
    integration_enabled = os.environ.get("TEST_INTEGRATION", "").lower() in ("true", "1", "yes")
    
    for item in items:
        if "integration" in item.keywords and not integration_enabled:
            item.add_marker(skip_integration)


@pytest.fixture(scope="session")
def meticulous_ip():
    """Get the Meticulous machine IP from environment."""
    ip = os.environ.get("METICULOUS_IP", "").strip()
    if not ip:
        pytest.skip("METICULOUS_IP environment variable not set")
    return ip


@pytest.fixture(scope="session")
def meticulous_base_url(meticulous_ip):
    """Get the base URL for the Meticulous machine."""
    return f"http://{meticulous_ip}"


@pytest.fixture(scope="session")
def integration_api(meticulous_ip):
    """Get a Meticulous API client for integration tests."""
    # Set the IP in environment for the service to pick up
    os.environ["METICULOUS_IP"] = meticulous_ip
    
    # Import after setting env var
    from services.meticulous_service import get_meticulous_api, reset_meticulous_api
    
    # Reset to pick up the new IP
    reset_meticulous_api()
    
    api = get_meticulous_api()
    yield api
    
    # Cleanup - reset the API client
    reset_meticulous_api()


@pytest.fixture(scope="function")
def wait_for_machine(integration_api):
    """Wait for machine to be in a stable state before running test."""
    import httpx
    
    base_url = integration_api.base_url
    
    # Use /api/v1/settings as liveness check (machine has no /api/v1/machine/state)
    try:
        response = httpx.get(f"{base_url}/api/v1/settings", timeout=5.0)
        response.raise_for_status()
    except Exception as e:
        pytest.skip(f"Machine not reachable: {e}")
    
    return integration_api


@pytest.fixture(scope="session")
def mqtt_host():
    """Get MQTT broker host for integration tests."""
    return os.environ.get("MQTT_HOST", "127.0.0.1")


@pytest.fixture(scope="session")
def mqtt_port():
    """Get MQTT broker port for integration tests."""
    return int(os.environ.get("MQTT_PORT", "1883"))


class IntegrationTestHelpers:
    """Helper utilities for integration tests."""
    
    @staticmethod
    def wait_for_weight_stable(api, timeout: float = 5.0, tolerance: float = 0.1) -> float:
        """Wait for scale weight to stabilize using Socket.IO status events."""
        import threading
        
        start_time = time.time()
        last_weight = None
        stable_count = 0
        result = {"weight": None, "error": None}
        
        def on_status(data):
            nonlocal last_weight, stable_count
            try:
                weight = data.get("sensors", {}).get("w", 0) if isinstance(data, dict) else getattr(getattr(data, "sensors", None), "w", 0)
                
                if last_weight is not None and abs(weight - last_weight) < tolerance:
                    stable_count += 1
                    if stable_count >= 3:
                        result["weight"] = weight
                else:
                    stable_count = 0
                last_weight = weight
            except Exception:
                pass
        
        api.sio.on("status", on_status)
        try:
            if not api.sio.connected:
                api.connect_to_socket(retries=2)
            
            while time.time() - start_time < timeout:
                if result["weight"] is not None:
                    return result["weight"]
                time.sleep(0.2)
            
            raise TimeoutError("Weight did not stabilize within timeout")
        finally:
            api.sio.on("status", None)
    
    @staticmethod
    def wait_for_connection(host: str, port: int, timeout: float = 10.0) -> bool:
        """Wait for a TCP connection to become available."""
        import socket
        
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                with socket.create_connection((host, port), timeout=1.0):
                    return True
            except (socket.error, socket.timeout):
                time.sleep(0.5)
        
        return False


@pytest.fixture
def helpers():
    """Provide integration test helper utilities."""
    return IntegrationTestHelpers()
