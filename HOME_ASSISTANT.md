# 🏠 Home Assistant Integration

Connect MeticAI to Home Assistant to get real-time espresso machine telemetry, create automations, and control your Meticulous from HA dashboards.

## How It Works

MeticAI includes an MQTT bridge (based on the excellent [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) by @nickwilsonr) that publishes live sensor data from your Meticulous machine to an internal Mosquitto MQTT broker. By enabling the Home Assistant overlay, port 1883 is exposed so Home Assistant can connect and subscribe to all telemetry topics.

```text
Meticulous Machine ←── Socket.IO ──→ MQTT Bridge ──→ Mosquitto (:1883)
                                                          │
                                                          ▼
                                                    Home Assistant
                                                   (MQTT Integration)
```

## Prerequisites

- MeticAI running with the MQTT bridge enabled (Settings → Control Center → MQTT Bridge: On)
- Home Assistant instance on the same network as MeticAI
- The MQTT integration available in Home Assistant (built-in)

## Setup

### Step 1: Enable the Home Assistant Overlay

The Home Assistant overlay exposes the MQTT broker (port 1883) so external clients can connect.

**During installation** (install script will ask):

```text
Enable Home Assistant MQTT integration? (y/N): y
```

**On an existing installation:**

```bash
cd ~/.meticai   # or wherever MeticAI is installed

# Start with the Home Assistant overlay
docker compose -f docker-compose.yml -f docker-compose.homeassistant.yml up -d
```

**Verify the port is open:**

```bash
nc -zv <meticai-host-ip> 1883
# Should output: Connection to <ip> port 1883 succeeded!
```

> **Note:** `ping <ip>:1883` will not work — `ping` uses ICMP and doesn't understand TCP ports. Use `nc` (netcat) to test TCP port connectivity.

### Step 2: Add MQTT Integration in Home Assistant

1. In Home Assistant, go to **Settings → Devices & Services → Add Integration**
2. Search for **MQTT**
3. Configure:
   - **Broker**: The IP address of the machine running MeticAI (e.g., `192.168.50.22`)
   - **Port**: `1883`
   - **Username**: *(leave empty)*
   - **Password**: *(leave empty)*
4. Click **Submit**

> **Tip:** If MeticAI and Home Assistant are running on the same machine (e.g., both on a Raspberry Pi), use `localhost` or `127.0.0.1` as the broker address. If they are in separate Docker networks, use the host machine's LAN IP instead.

### Step 3: Enable the MQTT Bridge in MeticAI

The MQTT bridge must be enabled for sensor data to flow:

1. Open MeticAI web UI → **Settings**
2. Under **Control Center**, toggle **MQTT Bridge** to **On**
3. Verify: the bridge status should show "Connected"

## Available MQTT Topics

The meticulous-addon bridge publishes data using Home Assistant MQTT discovery conventions.

### Sensor Topics

All sensor data is published under the `meticulous_espresso/sensor/` prefix:

| Topic | Type | Description |
|-------|------|-------------|
| `meticulous_espresso/sensor/boiler_temperature` | float | Boiler temperature (°C) |
| `meticulous_espresso/sensor/brew_head_temperature` | float | Brew head temperature (°C) |
| `meticulous_espresso/sensor/pressure` | float | Brew pressure (bar) |
| `meticulous_espresso/sensor/flow_rate` | float | Water flow rate (mL/s) |
| `meticulous_espresso/sensor/shot_weight` | float | Current shot weight (g) |
| `meticulous_espresso/sensor/shot_timer` | float | Shot elapsed time (s) |
| `meticulous_espresso/sensor/power` | float | Heater power (W) |
| `meticulous_espresso/sensor/voltage` | int | Supply voltage (V) |
| `meticulous_espresso/sensor/target_temperature` | float | Target temperature (°C) |
| `meticulous_espresso/sensor/target_weight` | float | Target weight (g) |
| `meticulous_espresso/sensor/preheat_countdown` | float | Preheat time remaining (s) |
| `meticulous_espresso/sensor/brewing` | bool | Whether a shot is in progress |
| `meticulous_espresso/sensor/connected` | bool | Machine connection state |
| `meticulous_espresso/sensor/total_shots` | int | Lifetime shot count |

### Status Topics

| Topic | Description |
|-------|-------------|
| `meticulous_espresso/availability` | Bridge availability (`online` / `offline`) |
| `meticulous_espresso/health` | Bridge health status |

### Command Topics

Commands can be published to control the machine:

| Topic | Payload | Description |
|-------|---------|-------------|
| `meticulous_espresso/command/start_shot` | — | Start brewing |
| `meticulous_espresso/command/stop_shot` | — | Stop current shot |
| `meticulous_espresso/command/abort_shot` | — | Abort current shot |
| `meticulous_espresso/command/preheat` | — | Start preheat |
| `meticulous_espresso/command/tare_scale` | — | Tare the scale |
| `meticulous_espresso/command/home_plunger` | — | Home the plunger |
| `meticulous_espresso/command/purge` | — | Purge the group head |
| `meticulous_espresso/command/load_profile` | `{"name": "..."}` | Load a profile by name |
| `meticulous_espresso/command/set_brightness` | `{"value": 75}` | Set LED brightness (0–100) |
| `meticulous_espresso/command/enable_sounds` | `{"enabled": true}` | Enable/disable sounds |

## Automation Examples

### Notify When Shot Is Done

```yaml
automation:
  - alias: "Espresso Shot Done"
    trigger:
      - platform: mqtt
        topic: "meticulous_espresso/sensor/brewing"
        payload: "false"
    condition:
      - condition: template
        value_template: "{{ trigger.payload == 'false' }}"
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "☕ Espresso Ready"
          message: "Your shot is done!"
```

### Preheat on Weekday Mornings

```yaml
automation:
  - alias: "Morning Preheat"
    trigger:
      - platform: time
        at: "07:00:00"
    condition:
      - condition: time
        weekday:
          - mon
          - tue
          - wed
          - thu
          - fri
    action:
      - service: mqtt.publish
        data:
          topic: "meticulous_espresso/command/preheat"
          payload: ""
```

### Dashboard Card (Temperature)

Add an Entities card or a custom gauge to your HA dashboard:

```yaml
type: sensor
entity: sensor.meticulous_espresso_boiler_temperature
name: Boiler Temperature
unit_of_measurement: "°C"
icon: mdi:thermometer
```

## Troubleshooting

### "Can't connect to MQTT broker"

1. **Is the overlay running?** Check that you started with `-f docker-compose.homeassistant.yml`
2. **Is the port open?** Run `nc -zv <meticai-ip> 1883` from the HA host
3. **Firewall?** Ensure port 1883 is not blocked between the HA and MeticAI hosts
4. **Same machine?** If both are on the same host, use `localhost` as the broker address. If HA is in Docker too, you may need the host's LAN IP or Docker bridge IP.

### Sensors show "Unavailable"

- Make sure the **MQTT Bridge** is enabled in MeticAI Settings
- Check that MeticAI can reach your Meticulous machine: Settings → Machine Status should show "Connected"
- Check bridge logs: `docker logs meticai 2>&1 | grep bridge`

### No sensor data flowing

- Verify the bridge is running: `curl http://<meticai-ip>:3550/api/bridge/status`
- Make sure the machine is powered on and connected to the network
- Try restarting the bridge: `curl -X POST http://<meticai-ip>:3550/api/bridge/restart`

## Security Notes

- The MQTT broker has **no authentication** enabled by default (suitable for local networks)
- Only expose port 1883 on trusted networks
- If you need MQTT authentication, you can create a custom mosquitto config with username/password
- The overlay only exposes MQTT — the MeticAI web UI remains on port 3550

## Combining with Other Overlays

You can stack all compose overlays:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.homeassistant.yml \
  -f docker-compose.tailscale.yml \
  -f docker-compose.watchtower.yml \
  up -d
```
