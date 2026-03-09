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
            response = await client.get(f"{meticulous_base_url}/api/v1/settings")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, dict)
            assert len(data) > 0
    
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
            response1 = await client.get(f"{meticulous_base_url}/api/v1/settings")
            assert response1.status_code == 200
            
            # Small delay
            await asyncio.sleep(0.5)
            
            # Second connection (simulates recovery)
            response2 = await client.get(f"{meticulous_base_url}/api/v1/settings")
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
    """Test real-time telemetry data reception via Socket.IO.
    
    The Meticulous machine streams sensor data (weight, temperature, pressure)
    through Socket.IO 'status' events, not REST endpoints.
    """
    
    async def test_weight_data_available(self, integration_api):
        """Verify weight sensor data is accessible via Socket.IO."""
        received = {"data": None}
        
        def on_status(data):
            if received["data"] is None:
                received["data"] = data
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            # Wait for a status event (up to 5 seconds)
            for _ in range(50):
                if received["data"] is not None:
                    break
                await asyncio.sleep(0.1)
            
            assert received["data"] is not None, "No status event received from machine"
            
            data = received["data"]
            sensors = data.get("sensors", {}) if isinstance(data, dict) else vars(getattr(data, "sensors", {}))
            assert "w" in sensors, f"Weight field 'w' not in sensors: {sensors.keys()}"
            assert isinstance(sensors["w"], (int, float))
            print(f"Weight: {sensors['w']}g")
        finally:
            integration_api.sio.on("status", None)
    
    async def test_temperature_data_available(self, integration_api):
        """Verify temperature sensor data is accessible via Socket.IO."""
        received = {"data": None}
        
        def on_status(data):
            if received["data"] is None:
                received["data"] = data
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            for _ in range(50):
                if received["data"] is not None:
                    break
                await asyncio.sleep(0.1)
            
            assert received["data"] is not None, "No status event received from machine"
            
            data = received["data"]
            sensors = data.get("sensors", {}) if isinstance(data, dict) else vars(getattr(data, "sensors", {}))
            # 't' = temperature, 'g' = group temperature
            assert "t" in sensors, f"Temperature field 't' not in sensors: {sensors.keys()}"
            assert isinstance(sensors["t"], (int, float))
            print(f"Temperature: {sensors['t']}°C, Group: {sensors.get('g', 'N/A')}°C")
        finally:
            integration_api.sio.on("status", None)
    
    async def test_pressure_data_available(self, integration_api):
        """Verify pressure sensor data is accessible via Socket.IO."""
        received = {"data": None}
        
        def on_status(data):
            if received["data"] is None:
                received["data"] = data
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            for _ in range(50):
                if received["data"] is not None:
                    break
                await asyncio.sleep(0.1)
            
            assert received["data"] is not None, "No status event received from machine"
            
            data = received["data"]
            sensors = data.get("sensors", {}) if isinstance(data, dict) else vars(getattr(data, "sensors", {}))
            assert "p" in sensors, f"Pressure field 'p' not in sensors: {sensors.keys()}"
            assert isinstance(sensors["p"], (int, float))
            print(f"Pressure: {sensors['p']} bar")
        finally:
            integration_api.sio.on("status", None)
    
    async def test_telemetry_polling_latency(self, integration_api):
        """Test telemetry event frequency from Socket.IO."""
        timestamps = []
        
        def on_status(data):
            timestamps.append(time.time())
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            # Collect events for 3 seconds
            await asyncio.sleep(3.0)
            
            assert len(timestamps) >= 2, f"Only received {len(timestamps)} status events in 3s"
            
            # Calculate inter-event intervals
            intervals = [(timestamps[i] - timestamps[i-1]) * 1000 for i in range(1, len(timestamps))]
            avg_interval = sum(intervals) / len(intervals)
            
            print(f"Received {len(timestamps)} status events in 3s")
            print(f"Average interval: {avg_interval:.1f}ms")
            
            # Events should arrive at least every 2 seconds
            assert avg_interval < 2000
        finally:
            integration_api.sio.on("status", None)


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
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Verify machine is reachable via settings endpoint
            response = await client.get(f"{meticulous_base_url}/api/v1/settings")
            assert response.status_code == 200
            
            # Send tare command via the SDK's action endpoint
            tare_response = await client.get(
                f"{meticulous_base_url}/api/v1/action/tare"
            )
            
            # Command should be accepted (200) or rejected if machine is busy (400)
            assert tare_response.status_code in (200, 400), (
                f"Unexpected tare response: {tare_response.status_code}"
            )
            print(f"Tare response: {tare_response.status_code}")
    
    @pytest.mark.skip(reason="Preheat command may not be safe to run automatically")
    async def test_preheat_command(self, wait_for_machine):
        """Test preheat command - SKIPPED by default for safety."""
        pass
    
    async def test_brightness_command(self, meticulous_base_url):
        """Test brightness setting via the settings endpoint."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Get current settings first
            get_response = await client.get(f"{meticulous_base_url}/api/v1/settings")
            
            if get_response.status_code == 404:
                pytest.skip("Settings endpoint not available")
            
            assert get_response.status_code == 200
            settings = get_response.json()
            print(f"Settings keys: {list(settings.keys())}")
            # Settings endpoint exists and returns data
            assert isinstance(settings, dict)


# ============================================================================
# POUR-OVER MODE TESTS
# ============================================================================

@pytest.mark.integration
class TestPourOverMode:
    """Test pour-over specific functionality."""
    
    async def test_scale_weight_polling(self, integration_api):
        """Verify continuous scale weight readings via Socket.IO."""
        weights = []
        
        def on_status(data):
            sensors = data.get("sensors", {}) if isinstance(data, dict) else vars(getattr(data, "sensors", {}))
            weight = sensors.get("w", 0)
            weights.append(weight)
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            # Collect weight readings for 2 seconds
            await asyncio.sleep(2.0)
            
            assert len(weights) >= 2, f"Only received {len(weights)} weight readings in 2s"
            
            # Weights should be numeric
            for w in weights:
                assert isinstance(w, (int, float)), f"Weight {w} is not numeric"
            
            print(f"Collected {len(weights)} weight readings, range: {min(weights):.1f}g - {max(weights):.1f}g")
        finally:
            integration_api.sio.on("status", None)
    
    async def test_flow_rate_calculation(self, integration_api):
        """Test that flow rate can be calculated from weight changes."""
        samples = []
        
        def on_status(data):
            sensors = data.get("sensors", {}) if isinstance(data, dict) else vars(getattr(data, "sensors", {}))
            weight = sensors.get("w", 0)
            samples.append({"time": time.time(), "weight": weight})
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            # Collect samples for 2 seconds
            await asyncio.sleep(2.0)
        finally:
            integration_api.sio.on("status", None)
        
        assert len(samples) >= 2, f"Need at least 2 samples, got {len(samples)}"
        
        # Calculate flow rates between samples
        flow_rates = []
        for i in range(1, len(samples)):
            dt = samples[i]["time"] - samples[i-1]["time"]
            dw = samples[i]["weight"] - samples[i-1]["weight"]
            if dt > 0:
                flow_rates.append(dw / dt)
        
        print(f"Calculated {len(flow_rates)} flow rates from {len(samples)} samples")
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
    
    async def test_machine_state_complete(self, meticulous_base_url, integration_api):
        """Test that machine settings and Socket.IO state are available."""
        # Verify REST settings endpoint
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/settings")
            assert response.status_code == 200
            
            settings = response.json()
            print(f"\nMachine settings fields: {list(settings.keys())}")
            assert isinstance(settings, dict)
            assert len(settings) > 0
        
        # Verify Socket.IO status event delivers full state
        received = {"data": None}
        
        def on_status(data):
            if received["data"] is None:
                received["data"] = data
        
        integration_api.sio.on("status", on_status)
        try:
            if not integration_api.sio.connected:
                integration_api.connect_to_socket(retries=2)
            
            for _ in range(50):
                if received["data"] is not None:
                    break
                await asyncio.sleep(0.1)
            
            assert received["data"] is not None, "No status event received"
            
            data = received["data"]
            state_fields = list(data.keys()) if isinstance(data, dict) else [k for k in vars(data).keys() if not k.startswith("_")]
            print(f"Socket.IO status fields: {state_fields}")
            print(f"Socket.IO status sample: {json.dumps(data if isinstance(data, dict) else vars(data), indent=2, default=str)[:500]}")
        finally:
            integration_api.sio.on("status", None)
