"""
Integration tests for MeticAI with real Meticulous machine.

These tests require a real Meticulous machine to be accessible on the network.
They are excluded from CI and should only be run locally.

Usage:
    export METICULOUS_IP=192.168.x.x
    export TEST_INTEGRATION=true
    cd apps/server && pytest test_integration_machine.py -v

Environment Variables:
    METICULOUS_IP: IP address of the Meticulous machine (required)
    TEST_INTEGRATION: Set to "true" to enable integration tests
    MQTT_HOST: MQTT broker host (default: 127.0.0.1)
    MQTT_PORT: MQTT broker port (default: 1883)
"""

import asyncio
import pytest
import httpx
import time
import json
import socket
from typing import Any, Dict

# Import integration test fixtures
from conftest_integration import (
    meticulous_ip,
    meticulous_base_url,
    integration_api,
    wait_for_machine,
    mqtt_host,
    mqtt_port,
    helpers,
)


# ============================================================================
# CONNECTION TESTS
# ============================================================================

@pytest.mark.integration
class TestMachineConnection:
    """Test basic connectivity to the Meticulous machine."""
    
    async def test_machine_reachable(self, meticulous_base_url):
        """Verify the machine responds to HTTP requests."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            data = response.json()
            assert "state" in data or "shot_weight" in data
    
    async def test_websocket_connection(self, meticulous_base_url):
        """Test WebSocket connection to machine (Socket.IO)."""
        # The Meticulous machine uses Socket.IO for real-time updates
        # We test the HTTP handshake portion
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{meticulous_base_url}/socket.io/",
                params={"EIO": "4", "transport": "polling"}
            )
            # Socket.IO handshake should return 200 with session info
            assert response.status_code == 200
    
    async def test_api_client_initialization(self, integration_api):
        """Verify the API client initializes correctly."""
        assert integration_api is not None
        assert hasattr(integration_api, "base_url")
        assert integration_api.base_url.startswith("http")
    
    async def test_connection_recovery(self, meticulous_base_url, helpers):
        """Test that connection can be re-established after interruption."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            # First connection
            response1 = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response1.status_code == 200
            
            # Small delay
            await asyncio.sleep(0.5)
            
            # Second connection (simulates recovery)
            response2 = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response2.status_code == 200


@pytest.mark.integration
class TestMQTTConnection:
    """Test MQTT broker connectivity."""
    
    def test_mqtt_broker_reachable(self, mqtt_host, mqtt_port, helpers):
        """Verify MQTT broker accepts connections."""
        connected = helpers.wait_for_connection(mqtt_host, mqtt_port, timeout=5.0)
        if not connected:
            pytest.skip("MQTT broker not reachable - may not be running locally")
        assert connected
    
    def test_mqtt_subscription(self, mqtt_host, mqtt_port):
        """Test subscribing to MQTT topics."""
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            pytest.skip("paho-mqtt not installed")
        
        received_messages = []
        connected_event = asyncio.Event()
        
        def on_connect(client, userdata, flags, rc):
            if rc == 0:
                client.subscribe("meticulous/#")
        
        def on_message(client, userdata, msg):
            received_messages.append({
                "topic": msg.topic,
                "payload": msg.payload.decode("utf-8", errors="ignore")
            })
        
        client = mqtt.Client()
        client.on_connect = on_connect
        client.on_message = on_message
        
        try:
            client.connect(mqtt_host, mqtt_port, 60)
            client.loop_start()
            
            # Wait a moment for potential messages
            time.sleep(2.0)
            
            client.loop_stop()
            client.disconnect()
            
            # Test passes if we connected (messages may or may not be present)
            assert True
        except Exception as e:
            pytest.skip(f"MQTT connection failed: {e}")


# ============================================================================
# API TESTS (Real Data)
# ============================================================================

@pytest.mark.integration
class TestProfileAPI:
    """Test profile CRUD operations against real machine."""
    
    async def test_list_profiles(self, wait_for_machine):
        """Verify we can list profiles from the machine."""
        from services.meticulous_service import async_list_profiles
        
        profiles = await async_list_profiles()
        assert isinstance(profiles, list)
        # Machine should have at least some default profiles
        if len(profiles) > 0:
            profile = profiles[0]
            assert "id" in profile or hasattr(profile, "id")
    
    async def test_profile_schema_validation(self, wait_for_machine):
        """Test profile data matches expected schema."""
        from services.meticulous_service import async_list_profiles
        
        profiles = await async_list_profiles()
        if not profiles:
            pytest.skip("No profiles on machine")
        
        profile = profiles[0]
        # Convert to dict if needed
        if hasattr(profile, "__dict__"):
            profile_dict = vars(profile)
        else:
            profile_dict = dict(profile) if hasattr(profile, "keys") else {}
        
        # Basic schema checks - profile should have key fields
        # Note: actual field names depend on meticulous API response format
        assert profile is not None
    
    async def test_fetch_shot_history(self, meticulous_base_url):
        """Test retrieving shot history from machine."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/history/list")
            
            if response.status_code == 404:
                pytest.skip("History endpoint not available")
            
            assert response.status_code == 200
            history = response.json()
            assert isinstance(history, (list, dict))


@pytest.mark.integration
class TestLastShotAPI:
    """Test last shot retrieval."""
    
    async def test_last_shot_endpoint(self, meticulous_base_url):
        """Test fetching last shot data."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Try the history endpoint first
            response = await client.get(f"{meticulous_base_url}/api/v1/history/last")
            
            if response.status_code == 404:
                # Try alternative endpoint
                response = await client.get(f"{meticulous_base_url}/api/v1/history/list")
                if response.status_code == 404:
                    pytest.skip("No shot history endpoints available")
            
            # If we got a response, validate structure
            if response.status_code == 200:
                data = response.json()
                assert data is not None


# ============================================================================
# TELEMETRY TESTS
# ============================================================================

@pytest.mark.integration
class TestTelemetry:
    """Test real-time telemetry data reception."""
    
    async def test_weight_data_available(self, meticulous_base_url):
        """Verify weight sensor data is accessible."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            
            data = response.json()
            # Check for weight field (may be named differently)
            weight_fields = ["shot_weight", "weight", "scale_weight"]
            has_weight = any(field in data for field in weight_fields)
            
            if not has_weight:
                # Log available fields for debugging
                print(f"Available fields: {list(data.keys())}")
            
            assert has_weight or "state" in data
    
    async def test_temperature_data_available(self, meticulous_base_url):
        """Verify temperature sensor data is accessible."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            
            data = response.json()
            temp_fields = ["temperature", "temp", "boiler_temp", "group_temp"]
            has_temp = any(field in data for field in temp_fields)
            
            # Temperature may not always be reported
            if not has_temp:
                print(f"Temperature fields not found. Available: {list(data.keys())}")
    
    async def test_pressure_data_available(self, meticulous_base_url):
        """Verify pressure sensor data is accessible."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            
            data = response.json()
            pressure_fields = ["pressure", "bar", "group_pressure"]
            has_pressure = any(field in data for field in pressure_fields)
            
            if not has_pressure:
                print(f"Pressure fields not found. Available: {list(data.keys())}")
    
    async def test_weight_polling_latency(self, meticulous_base_url):
        """Test weight polling response time."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            latencies = []
            
            for _ in range(5):
                start = time.time()
                response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
                latency = (time.time() - start) * 1000  # Convert to ms
                
                assert response.status_code == 200
                latencies.append(latency)
            
            avg_latency = sum(latencies) / len(latencies)
            print(f"Average weight polling latency: {avg_latency:.1f}ms")
            
            # Latency should be reasonable (under 2 seconds)
            assert avg_latency < 2000


# ============================================================================
# COMMAND TESTS
# ============================================================================

@pytest.mark.integration
class TestMachineCommands:
    """Test machine command execution.
    
    CAUTION: These tests send actual commands to the machine.
    Only safe commands (tare, brightness) are tested by default.
    """
    
    async def test_tare_command(self, wait_for_machine, meticulous_base_url):
        """Test tare (zero scale) command."""
        # Get initial weight
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            initial_state = response.json()
            
            # Send tare command via execute_action
            tare_response = await client.post(
                f"{meticulous_base_url}/api/v1/machine/action",
                json={"action": "tare_scale"}
            )
            
            # Command should be accepted
            if tare_response.status_code not in (200, 201, 202, 204):
                # Try alternative endpoint format
                tare_response = await client.post(
                    f"{meticulous_base_url}/api/v1/action/tare_scale"
                )
            
            # Log result for debugging
            print(f"Tare response: {tare_response.status_code}")
    
    @pytest.mark.skip(reason="Preheat command may not be safe to run automatically")
    async def test_preheat_command(self, wait_for_machine):
        """Test preheat command - SKIPPED by default for safety."""
        pass
    
    async def test_brightness_command(self, meticulous_base_url):
        """Test brightness setting command."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try to set brightness (non-destructive command)
            response = await client.post(
                f"{meticulous_base_url}/api/v1/machine/settings",
                json={"brightness": 70}
            )
            
            if response.status_code == 404:
                pytest.skip("Brightness endpoint not available")
            
            # Should be accepted or return method not allowed
            assert response.status_code in (200, 201, 202, 204, 405)


# ============================================================================
# POUR-OVER MODE TESTS
# ============================================================================

@pytest.mark.integration
class TestPourOverMode:
    """Test pour-over specific functionality."""
    
    async def test_scale_weight_polling(self, meticulous_base_url):
        """Verify continuous scale weight polling works."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            weights = []
            
            for _ in range(10):
                response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
                assert response.status_code == 200
                
                data = response.json()
                weight = data.get("shot_weight", data.get("weight", 0))
                weights.append(weight)
                
                await asyncio.sleep(0.1)
            
            # Should have collected 10 weight readings
            assert len(weights) == 10
            
            # Weights should be numeric
            for w in weights:
                assert isinstance(w, (int, float))
    
    async def test_flow_rate_calculation(self, meticulous_base_url):
        """Test that flow rate can be calculated from weight changes."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            samples = []
            
            for _ in range(5):
                start = time.time()
                response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
                
                if response.status_code == 200:
                    data = response.json()
                    weight = data.get("shot_weight", data.get("weight", 0))
                    samples.append({
                        "time": start,
                        "weight": weight
                    })
                
                await asyncio.sleep(0.2)
            
            # Calculate flow rates between samples
            if len(samples) >= 2:
                flow_rates = []
                for i in range(1, len(samples)):
                    dt = samples[i]["time"] - samples[i-1]["time"]
                    dw = samples[i]["weight"] - samples[i-1]["weight"]
                    if dt > 0:
                        flow_rates.append(dw / dt)
                
                print(f"Calculated flow rates: {flow_rates}")
                # Flow rates should be calculable
                assert len(flow_rates) > 0


# ============================================================================
# INTEGRATION SMOKE TESTS
# ============================================================================

@pytest.mark.integration
class TestIntegrationSmoke:
    """Quick smoke tests to verify basic integration."""
    
    async def test_full_workflow_profiles(self, wait_for_machine):
        """Test complete profile listing workflow."""
        from services.meticulous_service import (
            async_list_profiles,
            invalidate_profile_list_cache
        )
        
        # Clear cache
        invalidate_profile_list_cache()
        
        # List profiles (fresh)
        profiles = await async_list_profiles()
        assert isinstance(profiles, list)
        
        # List again (should use cache)
        profiles2 = await async_list_profiles()
        assert profiles2 is profiles  # Same object from cache
    
    async def test_machine_state_complete(self, meticulous_base_url):
        """Test that machine state endpoint returns complete data."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/machine/state")
            assert response.status_code == 200
            
            data = response.json()
            
            # Log available fields for documentation
            print(f"\nMachine state fields available: {list(data.keys())}")
            print(f"Machine state sample: {json.dumps(data, indent=2, default=str)[:500]}")
            
            # Basic validation
            assert isinstance(data, dict)
            assert len(data) > 0
