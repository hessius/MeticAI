# MeticAI v2.0.0

> **A complete overhaul.** Version 2.0.0 is a ground-up rewrite — new architecture, new UI, new capabilities. If v1 was a clever hack, v2 is the real deal.

---

## ✨ Marquee Features

### ☕ Control Center — Full Machine Command
Take the reins. A new real-time dashboard puts every machine function at your fingertips — start, stop, preheat, tare, purge, adjust brightness, toggle sounds, and more. Live telemetry gauges display pressure, flow, weight, and temperature as they happen. Works beautifully on both desktop (as a sidebar) and mobile (full-screen).

### 📈 Live Shot View
Watch your extraction unfold in real time. Pressure, flow, weight, and temperature are plotted live alongside a profile overlay, so you can see exactly how your shot tracks against the plan. A profile breakdown highlights the current stage as it progresses, and when the shot finishes you get a summary card with one-tap AI analysis.

### 🏠 Home Assistant Integration
MeticAI now speaks MQTT natively. Enable the HA integration during install and your Meticulous machine appears in Home Assistant with **14+ sensors** (pressure, flow, weight, temperatures, shot timer, brewing state, and more) and **10 command topics** (start, stop, preheat, tare, purge, load profile…). Build automations like *"preheat at 6:30 AM on weekdays"* or *"notify me when the shot finishes"* — no custom YAML required, it's all auto-discovered.

### 🎨 Refreshed UI
A completely new React 19 + TypeScript frontend, built for both phones and desktops:
- **Light & dark themes** with system-preference detection
- **Desktop-optimised layout** — resizable panels, sidebar control center, QR code sharing
- **Mobile-first gestures** — swipe between views
- **Ambient animated background** (toggleable)
- **Accessibility** — skip navigation, keyboard support, semantic markup

### 🌐 Remote Access
Access MeticAI — and your Meticulous machine — from anywhere. The installer offers optional **Tailscale** integration: a free, zero-config VPN that gives you a secure connection to your home setup. Dial in a new recipe from the coffee shop. Analyse your morning shot on the train. Pore over your extractions from the office. *(Get it?)*

### 🌍 Internationalisation
The UI is fully translated into **six languages**:
🇬🇧 English · 🇸🇪 Svenska · 🇩🇪 Deutsch · 🇫🇷 Français · 🇪🇸 Español · 🇮🇹 Italiano

Auto-detects your browser language, with a manual override in Settings.

---

## 🧠 Smarter AI

- **Expert shot coaching** — after every extraction, get structured AI analysis: Shot Performance, Root Cause Analysis, Setup Recommendations, Quick Tips, and Next Steps
- **Embedded knowledge base** — the AI now draws on a comprehensive espresso profiling reference (extraction science, pre-infusion theory, stage-based profiling, roast guidelines, troubleshooting) without needing extra tool calls
- **Reduced token usage** — MCP knowledge is embedded directly into prompts for non-tool-use queries, cutting API costs
- **Advanced customisation** — specify basket size/type, water temp, max pressure/flow, shot volume, dose, and bottom filter when creating profiles
- **Profile import** — load profiles from JSON files directly in the UI

---

## 🏗️ Under the Hood

### Unified Container Architecture
The biggest technical change: MeticAI is now a **single Docker container** instead of a collection of orchestrated services. Inside, [s6-overlay](https://github.com/just-containers/s6-overlay) supervises five processes:

| Service | Role |
|---------|------|
| **nginx** | Reverse proxy — single entry point on port 3550 |
| **FastAPI** | Python 3.12 backend — AI analysis, profile management, settings |
| **FastMCP** | MCP server — Meticulous machine communication |
| **Mosquitto** | MQTT broker — real-time telemetry backbone |
| **Bridge** | Socket.IO ↔ MQTT — connects to the Meticulous machine |

One port. One container. One `docker compose up`.

### Published to GHCR
No more building from source. The image is published to `ghcr.io/hessius/meticai` with multi-arch support (amd64, arm64, arm). Just pull and run.

```bash
docker pull ghcr.io/hessius/meticai:latest
```

### Automatic Updates with Watchtower
The old custom update system is gone (and good riddance). The installer now optionally sets up [Watchtower](https://containrrr.dev/watchtower/) — a battle-tested container updater that checks for new images every 6 hours. Updates are reliable, seamless, and basically invisible. You can also trigger an update from the Settings page in the UI.

### Hot-Reload Settings
Change your Meticulous IP or Gemini API key from the Settings UI — relevant services restart automatically. No container restart needed.

### Frontend Stack
- React 19, TypeScript 5.7, Vite 7, Tailwind CSS 4
- shadcn/ui component library (46 primitives)
- Recharts + D3 for all charting
- Framer Motion animations
- TanStack React Query for data fetching
- Vitest + Playwright for testing
- Storybook for component development

### Test Coverage
556 Python backend tests, Vitest unit tests, Playwright E2E tests, BATS installer tests, and Storybook visual tests. CI runs everything on every push.

---

## 📦 Installation

### One-Line Install (Raspberry Pi / Linux / macOS)
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
```

The installer will:
- Auto-detect your Meticulous machine on the network (Bonjour / mDNS)
- Install Docker if needed
- Offer optional Tailscale, Watchtower, and Home Assistant integration
- Generate convenience scripts (`start.sh`, `stop.sh`, `update.sh`, `uninstall.sh`)
- Print a QR code for mobile access

### macOS App
Download **MeticAI Installer.app** from the [Releases page](https://github.com/hessius/MeticAI/releases/tag/v2.0.0) — a native macOS wrapper with Bonjour auto-discovery of your machine.

### Docker Compose (Manual)
```yaml
services:
  meticai:
    image: ghcr.io/hessius/meticai:latest
    ports:
      - "3550:3550"
    environment:
      - GEMINI_API_KEY=your_key
      - METICULOUS_IP=your_machine_ip
    volumes:
      - meticai-data:/data
    restart: unless-stopped

volumes:
  meticai-data:
```

---

## 🔄 Migrating from v1.x

The installer attempts automatic migration when it detects an existing v1 installation — your settings, profiles, and history should carry over. However, the architecture is fundamentally different, so if anything feels off after migration, a **fresh install** is the safest path:

```bash
# Remove the old setup
docker compose down -v
# Run the new installer
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
```

---

## 🐛 Bug Fixes & Improvements

This release includes too many fixes to list exhaustively. Highlights:

- **Graph rendering** — fixed scaling, axis labelling, and profile overlay alignment
- **AI analysis** — more reliable output parsing, better structured responses
- **Profile generation** — improved extraction plans, stricter schema validation
- **Profile breakdown** — colour-coded stages with variable highlighting
- **Image handling** — added in-app cropping, better caching
- **Settings persistence** — reliable save/load cycle with hot-reload
- **Shot history** — side-by-side comparison, animated replay, full metadata display
- **Scheduling** — orphaned scheduled shot cleanup
- **Installer** — robust error handling, v1→v2 migration, branch testing support

---

## 🙏 Acknowledgements

MeticAI builds on top of excellent open-source work:

- [meticulous-mcp](https://github.com/twchad/meticulous-mcp) by twchad — the MCP server that talks to the Meticulous machine
- [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) by nickwilsonr — the Socket.IO bridge
- [espresso-profile-schema](https://github.com/nicholasgasior/espresso-profile-schema) — profile validation

---

**Full Changelog**: https://github.com/hessius/MeticAI/compare/v1.2.0...v2.0.0
