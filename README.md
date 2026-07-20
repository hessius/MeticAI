<div align="center">

<img src="resources/logo.png" alt="Metic Logo" width="200" />

# Metic

### All-in-one toolkit for the Meticulous Espresso Machine

*Create, profile and understand your espresso.*
*1. Take a photo or describe your coffee. Get a perfect espresso profile. Automatically.*
*2. Understand your profiles, shot graphs by enabling shot comparison, analysis and AI-coaching*

[Get Started](#-quick-start) • [Features](#-what-it-does) • [Web Interface](#-using-metic) • [API](API.md) • [☕ Buy Me a Coffee](https://buymeacoffee.com/HSUS)

</div>

---

## 🎯 What is Metic?

When I got my Meticulous, after a loooong wait, I was overwhelmed with the options — dialing in was no longer just adjusting grind size, the potential was (and is) basically limitless — my knowledge and time not so.

**Metic** is a growing set of AI tools to help you get the most out of your Meticulous Espresso machine. Among other things it lets you:

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
- 🐳 **Single Docker Container** - Simple, distroless single-binary deployment
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
- ☑️ A server to run Metic (Raspberry Pi, Mac, Linux, or Windows with Docker)
- ☑️ A **free Google Gemini API key** → [Get yours here](https://aistudio.google.com/app/apikey) (takes 30 seconds)

### Installation (5 minutes)

**Prerequisites:** Docker and Docker Compose ([Get Docker](https://docs.docker.com/get-docker/))

**Linux / macOS:**

**Quick Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/refs/heads/main/scripts/install.sh | bash
```

**Docker:**
```bash
docker pull ghcr.io/hessius/meticai:latest
```

**Upgrading from v1.x:**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/refs/heads/main/scripts/migrate-to-unified.sh | bash
```


**macOS / Windows:** Docker Desktop is required. See [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/) or [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/).

> **Note:** The macOS .app installer and Windows PowerShell installer were deprecated in v2.4.0. Use the Docker-based installation above for all platforms.

### After Installation

Open `http://YOUR_SERVER_IP:3550` in any browser to access the web interface!

### Need Help?
- 📖 [API Reference](API.md)
- 🔄 [Updating & Migration](UPDATING.md)
- 🌐 [Remote Access (Tailscale)](TAILSCALE.md)
- 🏠 [Home Assistant Integration](HOME_ASSISTANT.md)
- 📱 [iOS Shortcuts](IOS_SHORTCUTS.md)
- 🔧 [Troubleshooting](#-troubleshooting)

## 📱 Using Metic

### Web Interface (Recommended)

The web interface is the easiest and most powerful way to use Metic. Simply open `http://YOUR_SERVER_IP:3550` in any browser.

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

### Android App

A native Android app (Capacitor) is available as a signed APK on the
[Releases page](https://github.com/hessius/MeticAI/releases) — download
`Metic-<version>.apk` and install it (you may need to allow installs from
unknown sources). It talks directly to your machine on the local network, so no
server is required.

[→ Android development & build guide](apps/web/android/README.md)

## 🎛️ Control Center

Metic includes a real-time Control Center with live machine telemetry streamed
straight from your Meticulous over the built-in `/api/ws/live` WebSocket:

- **Live telemetry** — Real-time pressure, flow, weight, and temperature gauges
- **Machine control** — Preheat, tare, purge, abort, brightness, sounds, and more
- **Live Shot View** — Watch your extraction in real-time with live charts
- **Auto-detection** — Automatically detects when a shot starts and prompts you to watch
- **Last Shot Banner** — After a shot, offers one-tap analysis with AI coaching

The Control Center appears as a side panel on desktop and a full page on mobile,
and works out of the box with no extra services.

> **Changed in 3.0.0:** Home Assistant MQTT auto-discovery was removed, but live
> telemetry and machine control are unaffected (served over the built-in
> `/api/ws/live` WebSocket). See [Removed in 3.0.0](#-removed-in-300-server-version)
> below for the full list.

## 🗑️ Removed in 3.0.0 (server version)

Metic 3.0.0 replaces the Python backend with a single unified image. As part of
that cutover, a few **server-side** features were removed. On-device / native app
functionality is unaffected.

- **Home Assistant MQTT bridge**: the Mosquitto broker and
  [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) MQTT
  auto-discovery are gone, along with the in-app MQTT Bridge settings. Live
  telemetry and machine control still work over the built-in `/api/ws/live`
  WebSocket. See [HOME_ASSISTANT.md](HOME_ASSISTANT.md) for details.
- **MCP server**: the bundled
  [meticulous-mcp](https://github.com/twchad/meticulous-mcp) server and its
  in-app settings were removed.
- **In-app self-updater**: the in-UI update action (`/api/trigger-update`) was
  removed. Update by pulling the new image (see below) or enable the optional
  Watchtower addon for automatic updates.

## 🔄 Updating Metic

```bash
cd ~/Metic
docker compose pull
docker compose up -d
```

With Watchtower enabled, updates happen automatically every 6 hours.

### Manage Addons After Install

You can enable or disable optional addons at any time (Watchtower, Tailscale)
without re-running the full installer.

Linux/macOS:

```bash
cd ~/Metic
bash scripts/addons.sh
```

Windows PowerShell:

```powershell
cd $HOME/Metic
powershell -ExecutionPolicy Bypass -File .\scripts\addons.ps1
```

Remote one-liner (Linux/macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/refs/heads/main/scripts/addons.sh | bash
```

[→ Full update guide, migration from v1.x, and troubleshooting](UPDATING.md)

## 🗑️ Uninstalling Metic

```bash
cd ~/Metic
docker compose down -v  # -v removes all volumes and data
rm -rf ~/Metic
```

**Note:** To verify volume names before removal, use `docker volume ls`

## 🌐 Optional: Remote Access with Tailscale

Access Metic from anywhere using Tailscale:

1. Get an auth key from [Tailscale Admin](https://login.tailscale.com/admin/settings/keys)
2. Enable during installation, or add manually:

```bash
cd ~/Metic
echo "TAILSCALE_AUTHKEY=your_key_here" >> .env
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

> **Important:** Both your Metic server and the device you're accessing it from must have Tailscale installed and connected to the same account. See the [full Tailscale setup guide](TAILSCALE.md) for HTTPS setup, troubleshooting, and more.

## 🏗️ Architecture

Metic 3.0.0 runs as a single unified container: one distroless Bun process that
serves the web UI, the API, the machine proxy, and live telemetry. (Earlier 2.x
releases ran five internal services under s6-overlay: nginx, a FastAPI server, an
MCP server, a Mosquitto broker, and an MQTT bridge; these were removed in 3.0.0.
See [Removed in 3.0.0](#-removed-in-300-server-version).)

```
┌──────────────────────────────────────────────────────────────┐
│                       Metic Container                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │            Bun server, single binary (:3550)            │  │
│  │                                                         │  │
│  │   • Web UI (static SPA)                                 │  │
│  │   • REST API (/api) → @metic/core                       │  │
│  │       (AI, profiles, analysis, recommendations,         │  │
│  │        dial-in) with a Gemini AI provider seam          │  │
│  │   • Machine proxy (/api/v1/* → Meticulous)              │  │
│  │   • Live telemetry (/api/ws/live WebSocket)             │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│                Machine (Socket.IO / HTTP)                     │
└──────────────────────────────────────────────────────────────┘
```

**Real-time telemetry**: The Bun server connects to your machine and pushes live
sensor data (pressure, flow, weight, temperature) to the web UI over the built-in
`/api/ws/live` WebSocket. No separate MQTT broker or bridge is required.

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
cd ~/Metic && docker compose logs -f

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
cd ~/Metic
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

Runs on [Bun](https://bun.sh), TypeScript, [Google Gemini](https://ai.google.dev/), and caffeine ☕

Made with ❤️ by <a href="https://github.com/hessius">@hessius</a>

[☕ Buy Me a Coffee](https://buymeacoffee.com/HSUS)

</div>
