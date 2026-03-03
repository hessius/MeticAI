<div align="center">

<img src="resources/logo.png" alt="MeticAI Logo" width="200" />

# MeticAI

### Your AI Barista Coach for the Meticulous Espresso Machine

*Create, profile and understand your espresso.*
*1. Take a photo or describe your coffee. Get a perfect espresso profile. Automatically.*
*2. Understand your profiles, shot graphs by enabling shot comparison, analysis and AI-coaching*

[Get Started](#-quick-start) • [Features](#-what-it-does) • [Web Interface](#-using-meticai) • [API](API.md)

</div>

---

## 🎯 What is MeticAI?

When I got my Meticulous, after a loooong wait, I was overwhelmed with the options — dialing in was no longer just adjusting grind size, the potential was (and is) basically limitless — my knowledge and time not so.

**MeticAI** is a growing set of AI tools to help you get the most out of your Meticulous Espresso machine. Among other things it lets you:

- 🧠 **Automatically create espresso profiles** tailored to your preferences and coffee at hand
- 📊 **Understand your espresso profiles and shot data** like never before
- 🔬 **Get AI coaching** to improve your technique
- ☕️ **Unleash your Meticulous** — no more guesswork, just great espresso

## ✨ What It Does

### For Everyone
- 🌐 **Beautiful Web Interface** - Upload photos or describe preferences from any device
- 📱 **Mobile Friendly** - Works perfectly on your phone's browser
- 🎨 **Creative Recipe Names** - Like "Slow-Mo Blossom" and "Choco-Lot Going On"
- 💬 **Natural Language** - Just describe what you want in plain English
- 🤖 **Fully Automatic** - From input to machine, no steps in between

### For Coffee Enthusiasts
- 🎯 **Advanced Profiling** - Multi-stage extraction, blooming, pressure ramping
- 📊 **Detailed Guidance** - Dose, grind, temperature recommendations
- 🔬 **Expert Knowledge** - Explanations of why each profile works
- ⚡️ **Modern Techniques** - Turbo shots, flow profiling, and more

### For Power Users
- 🔌 **REST API** - Integrate with any automation system
- 🏠 **Home Assistant** - MQTT bridge for HA automations and entities
- 🐳 **Single Docker Container** - Simple deployment and updates
- 🔓 **Open Source** - Customize and extend as you like
- 🔄 **Auto Updates** - Optional Watchtower integration

### Additional Features
- 📱 **iOS Shortcuts** - One-tap brewing from your iPhone
- 🌍 **Remote Access** - Optional Tailscale integration
- 🔐 **Secure** - Self-hosted means your data stays private
- 🎨 **Modern UI** - Built with React and shadcn/ui for a polished experience

## 🚀 Quick Start

### What You Need
- ☑️ A **Meticulous Espresso Machine** (connected to your network)
- ☑️ A server to run MeticAI (Raspberry Pi, Mac, Linux, or Windows with Docker)
- ☑️ A **free Google Gemini API key** → [Get yours here](https://aistudio.google.com/app/apikey) (takes 30 seconds)

### Installation (5 minutes)

**Prerequisites:** Docker and Docker Compose ([Get Docker](https://docs.docker.com/get-docker/))

**Linux / macOS:**

**Quick Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
```

**Docker:**
```bash
docker pull ghcr.io/hessius/meticai:v2.0.6
```

**Upgrading from v1.x:**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/migrate-to-unified.sh | bash
```


**Windows:** See the [Windows Installation Guide](WINDOWS.md) for PowerShell installer and Windows-specific notes.

**macOS App Installer:** Download from [Releases](https://github.com/hessius/MeticAI/releases/latest) — no terminal required.

### After Installation

Open `http://YOUR_SERVER_IP:3550` in any browser to access the web interface!

### Need Help?
- 📖 [API Reference](API.md)
- 🪟 [Windows Installation](WINDOWS.md)
- 🔄 [Updating & Migration](UPDATING.md)
- 🌐 [Remote Access (Tailscale)](TAILSCALE.md)
- 🏠 [Home Assistant Integration](HOME_ASSISTANT.md)
- 📱 [iOS Shortcuts](IOS_SHORTCUTS.md)
- 🔧 [Troubleshooting](#-troubleshooting)

## 📱 Using MeticAI

### Web Interface (Recommended)

The web interface is the easiest and most powerful way to use MeticAI. Simply open `http://YOUR_SERVER_IP:3550` in any browser.

**Create a profile in 3 steps:**
1. **Upload a photo** of your coffee bag, or **describe what you want** - like "bold and chocolatey" or "light and fruity"
2. **Click Create Profile**
3. ✨ Done! The recipe is now on your machine

The web interface shows real-time status, analysis results, and generated profiles with full details. It works perfectly on mobile browsers too!

### API Examples

For automation and integration:

**With a photo:**
```bash
curl -X POST http://YOUR_IP:3550/api/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**With text preferences:**
```bash
curl -X POST http://YOUR_IP:3550/api/analyze_and_profile \
  -F "user_prefs=Bold and chocolatey"
```

**With both:**
```bash
curl -X POST http://YOUR_IP:3550/api/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Traditional extraction"
```

[→ Full API documentation](API.md)

### iOS Shortcuts

For power users who want one-tap brewing from their iPhone, you can create custom shortcuts.

[→ iOS Shortcuts setup guide](IOS_SHORTCUTS.md)

## 🎛️ Control Center

MeticAI includes a real-time Control Center powered by the [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) MQTT bridge:

- **Live telemetry** — Real-time pressure, flow, weight, and temperature gauges
- **Machine control** — Preheat, tare, purge, abort, brightness, sounds, and more
- **Live Shot View** — Watch your extraction in real-time with live charts
- **Auto-detection** — Automatically detects when a shot starts and prompts you to watch
- **Last Shot Banner** — After a shot, offers one-tap analysis with AI coaching
- **Home Assistant** — MQTT bridge enables auto-discovery of 24 sensors + 11 commands in HA

The Control Center appears as a side panel on desktop and a full page on mobile. Enable it in Settings → Control Center → MQTT Bridge.

### Home Assistant Integration

When the MQTT bridge is enabled, your Meticulous machine is automatically discoverable in Home Assistant.

1. Start MeticAI with the Home Assistant overlay:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.homeassistant.yml up -d
   ```
2. In HA, add the **MQTT** integration and point it to your MeticAI server's IP on port 1883
3. This enables automations like "notify me when my shot is done" or "preheat at 7am on weekdays"

[→ Full Home Assistant integration guide](HOME_ASSISTANT.md)

## 🔄 Updating MeticAI

```bash
cd ~/MeticAI
docker compose pull
docker compose up -d
```

With Watchtower enabled, updates happen automatically every 6 hours.

[→ Full update guide, migration from v1.x, and troubleshooting](UPDATING.md)

## 🗑️ Uninstalling MeticAI

```bash
cd ~/MeticAI
docker compose down -v  # -v removes all volumes and data
rm -rf ~/MeticAI
```

**Note:** To verify volume names before removal, use `docker volume ls`

## 🌐 Optional: Remote Access with Tailscale

Access MeticAI from anywhere using Tailscale:

1. Get an auth key from [Tailscale Admin](https://login.tailscale.com/admin/settings/keys)
2. Enable during installation, or add manually:

```bash
cd ~/MeticAI
echo "TAILSCALE_AUTHKEY=your_key_here" >> .env
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

> **Important:** Both your MeticAI server and the device you're accessing it from must have Tailscale installed and connected to the same account. See the [full Tailscale setup guide](TAILSCALE.md) for HTTPS setup, troubleshooting, and more.

## 🏗️ Architecture

MeticAI v2.0 runs as a single unified container with five internal services managed by s6-overlay:

```
┌──────────────────────────────────────────────────────────────┐
│                      MeticAI Container                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    nginx (:3550)                       │  │
│  │             Web UI + API Reverse Proxy                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│       ┌───────────────────┼───────────────┐                  │
│       ▼                   ▼               ▼                  │
│  ┌──────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Server  │  │ MCP Server  │  │ Gemini CLI  │             │
│  │ (FastAPI) │  │(Meticulous) │  │    (AI)     │             │
│  │  :8000   │  │   :8080     │  │             │             │
│  └──────────┘  └─────────────┘  └─────────────┘             │
│       │                                                      │
│       │ MQTT                                                 │
│       ▼                                                      │
│  ┌──────────┐  ┌─────────────────┐                           │
│  │Mosquitto │◄─│Meticulous Bridge│◄── Machine (Socket.IO)    │
│  │  :1883   │  │  (MQTT Bridge)  │                           │
│  └──────────┘  └─────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

**Real-time telemetry**: The [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) bridge connects to your machine via Socket.IO and publishes live sensor data (pressure, flow, weight, temperature) to the internal MQTT broker. The FastAPI server subscribes and pushes updates to the web UI via WebSocket.

**Optional sidecars:**
- **Tailscale** - Secure remote access
- **Watchtower** - Automatic container updates

## 🛠️ Troubleshooting

### Viewing Logs

```bash
# Container logs (stdout)
docker logs meticai -f

# Structured logs via API (last 100 entries, filterable by level)
curl http://<SERVER_IP>:3550/api/logs
curl "http://<SERVER_IP>:3550/api/logs?level=ERROR&lines=200"

# Restart a single service
docker exec meticai s6-svc -r /run/service/server
```

### Container won't start

```bash
# Check logs
cd ~/MeticAI && docker compose logs -f

# Check container status
docker compose ps
```

### Can't connect to Meticulous machine

1. Verify the machine is on and connected to your network
2. Check the IP address in your `.env` file
3. Try using the IP address instead of `meticulous.local`

### API returns errors

```bash
# Check relay logs specifically
docker compose logs meticai | grep -i error
```

### Reset everything

```bash
cd ~/MeticAI
docker compose down -v  # -v removes volumes
docker compose pull
docker compose up -d
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Meticulous](https://meticulous.coffee/) for creating an amazing machine
- [Google Gemini](https://ai.google.dev/) for AI capabilities
- [pyMeticulous](https://github.com/MeticulousHome/pyMeticulous) by Meticulous — official Python client for the Meticulous API
- [meticulous-mcp](https://github.com/twchad/meticulous-mcp) by @twchad — MCP server for machine profile management
- [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) by @nickwilsonr — MQTT bridge for real-time telemetry and Home Assistant integration

---

<div align="center">

Runs on [pyMeticulous](https://github.com/MeticulousHome/pyMeticulous), [meticulous-mcp](https://github.com/twchad/meticulous-mcp), [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon), and caffeine ☕

Made with ❤️ by <a href="https://github.com/hessius">@hessius</a>
</div>
