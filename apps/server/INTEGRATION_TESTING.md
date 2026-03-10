# Integration Testing Guide

This guide explains how to run integration tests that validate MeticAI functionality against a real Meticulous machine.

## Overview

Integration tests complement the unit test suite (which runs in CI with mocks) by testing actual hardware interactions. These tests require a real Meticulous machine on your network.

## Prerequisites

1. **Meticulous Machine**: A working Meticulous espresso machine accessible on your network
2. **Network Access**: Your development machine must be on the same network as the Meticulous
3. **Python Environment**: Python 3.12+ with test dependencies installed

## Setup

### 1. Install Test Dependencies

```bash
cd apps/server
pip install -r requirements-test.txt
```

### 2. Configure Environment

Set the required environment variables:

```bash
# Required: IP address of your Meticulous machine
export METICULOUS_IP=192.168.x.x

# Required: Enable integration test mode
export TEST_INTEGRATION=true

# Optional: MQTT broker settings (if testing MQTT locally)
export MQTT_HOST=127.0.0.1
export MQTT_PORT=1883
```

### 3. Verify Machine Connectivity

Before running tests, verify your machine is reachable:

```bash
curl http://$METICULOUS_IP/api/v1/machine/state
```

You should see JSON output with machine state data.

## Running Integration Tests

### Run All Integration Tests

```bash
cd apps/server
TEST_INTEGRATION=true METICULOUS_IP=192.168.x.x pytest test_integration*.py -v
```

### Run Specific Test Categories

```bash
# Connection tests only
pytest test_integration_machine.py -v -k "TestMachineConnection"

# Telemetry tests only
pytest test_integration_machine.py -v -k "TestTelemetry"

# Profile API tests only
pytest test_integration_machine.py -v -k "TestProfileAPI"

# Command tests only
pytest test_integration_machine.py -v -k "TestMachineCommands"
```

### Run with Markers

```bash
# Run only tests marked as integration
pytest -m integration -v

# Run everything except integration tests
pytest -m "not integration" -v
```

## Test Categories

### Connection Tests (`TestMachineConnection`)

- Verifies HTTP connectivity to machine
- Tests WebSocket/Socket.IO handshake
- Validates API client initialization
- Tests connection recovery

### MQTT Tests (`TestMQTTConnection`)

- Tests MQTT broker connectivity
- Validates topic subscription
- Requires local MQTT broker running (optional)

### Profile API Tests (`TestProfileAPI`)

- Lists profiles from machine
- Validates profile schema
- Tests shot history retrieval

### Telemetry Tests (`TestTelemetry`)

- Validates weight sensor data
- Tests temperature readings
- Tests pressure sensor data
- Measures polling latency

### Command Tests (`TestMachineCommands`)

- Tests tare (scale zero) command
- Tests brightness settings
- Preheat test is skipped by default (safety)

### Pour-Over Tests (`TestPourOverMode`)

- Tests continuous weight polling
- Validates flow rate calculation

## Safety Considerations

⚠️ **These tests interact with real hardware!**

- **Preheat tests are disabled by default** to prevent unintended heating
- **No destructive commands** (start shot, stop) are included
- **Tare is safe** as it only zeros the scale
- **Profile creation is not tested** to avoid cluttering the machine

To enable potentially unsafe tests:

```bash
# NOT RECOMMENDED unless you're sure
pytest test_integration_machine.py -v --runxfail
```

## Troubleshooting

### Machine Not Reachable

```text
Machine not reachable: Connection refused
```

**Solutions:**

- Verify the machine is powered on
- Check `METICULOUS_IP` is correct
- Ensure you're on the same network
- Try pinging the machine: `ping $METICULOUS_IP`

### Tests Skipped

```text
SKIPPED: Integration tests require TEST_INTEGRATION=true
```

**Solution:** Set the environment variable:

```bash
export TEST_INTEGRATION=true
```

### MQTT Tests Fail

```text
MQTT broker not reachable
```

**Solutions:**

- Start the local MQTT broker (mosquitto)
- Or skip MQTT tests: `pytest ... -k "not MQTT"`

### Import Errors

```text
ModuleNotFoundError: paho.mqtt.client
```

**Solution:**

```bash
pip install paho-mqtt>=2.0.0
```

## CI Considerations

Integration tests are **excluded from CI** by default:

- The `TEST_INTEGRATION` variable is not set in GitHub Actions
- Tests marked `@pytest.mark.integration` are automatically skipped

This ensures CI remains fast and doesn't require hardware access.

## Extending Integration Tests

To add new integration tests:

1. Create tests in `test_integration_*.py` files
2. Mark tests with `@pytest.mark.integration`
3. Use fixtures from `conftest_integration.py`
4. Follow safety guidelines (no destructive operations)

Example:

```python
@pytest.mark.integration
class TestNewFeature:
    async def test_something(self, wait_for_machine, meticulous_base_url):
        """Test description."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{meticulous_base_url}/api/v1/...")
            assert response.status_code == 200
```

## Test Output

Integration tests produce verbose output showing:

- Machine state fields available
- Latency measurements
- Calculated flow rates

This information is useful for debugging and documentation.
