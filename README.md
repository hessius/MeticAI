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
- 🔬 **Science-Based** - Explanations of why each profile works
- ⚡️ **Modern Techniques** - Turbo shots, flow profiling, and more

### For Power Users
- 🔌 **REST API** - Integrate with any automation system
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

### Installation (2 minutes)

**One-Line Install:**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
```

That's it! The installer will:
- ✅ Check for and install Docker if needed
- ✅ Guide you through setup (just paste your API key and machine IP)
- ✅ Optionally enable Tailscale (remote access) and Watchtower (auto-updates)
- ✅ Pull and start the unified container

**Upgrading from v1.x?**
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/migrate-to-unified.sh | bash
```

The migration script will:
- ✅ Back up your existing configuration
- ✅ Stop and remove old containers
- ✅ Migrate your data to the new volume
- ✅ Start the new unified container

### Manual Installation

For those who prefer manual setup:

```bash
# Create configuration directory
mkdir -p ~/.meticai && cd ~/.meticai

# Create .env file
cat > .env << EOF
GEMINI_API_KEY=your_key_here
METICULOUS_IP=meticulous.local
EOF

# Download compose file
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/docker-compose.unified.yml -o docker-compose.yml

# Start MeticAI
docker compose pull
docker compose up -d
```

### After Installation

Open `http://YOUR_SERVER_IP:3550` in any browser to access the web interface!

### Need Help?
- 📖 [Technical documentation](TECHNICAL.md)
- 🔧 [Troubleshooting](#troubleshooting)

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
curl -X POST http://YOUR_IP:3550/api/v1/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**With text preferences:**
```bash
curl -X POST http://YOUR_IP:3550/api/v1/analyze_and_profile \
  -F "user_prefs=Bold and chocolatey"
```

**With both:**
```bash
curl -X POST http://YOUR_IP:3550/api/v1/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Traditional extraction"
```

[→ Full API documentation](API.md)

### iOS Shortcuts

For power users who want one-tap brewing from their iPhone, you can create custom shortcuts.

[→ iOS Shortcuts setup guide](IOS_SHORTCUTS.md)

## 🔄 Updating MeticAI

MeticAI v2.0 uses Docker for simple updates:

**Quick update:**
```bash
cd ~/.meticai
docker compose pull
docker compose up -d
```

**With Watchtower (automatic updates):**

If you enabled Watchtower during installation, MeticAI will automatically check for updates every 6 hours and update seamlessly.

**Manual trigger via API:**
```bash
curl -X POST http://localhost:8080/v1/update \
  -H "Authorization: Bearer YOUR_WATCHTOWER_TOKEN"
```

## 🗑️ Uninstalling MeticAI

```bash
cd ~/.meticai
docker compose down -v  # -v removes all volumes and data
rm -rf ~/.meticai
```

**Note:** To verify volume names before removal, use `docker volume ls`

## 🌐 Optional: Remote Access with Tailscale

Access MeticAI from anywhere using Tailscale:

1. Get an auth key from [Tailscale Admin](https://login.tailscale.com/admin/settings/keys)
2. Enable during installation, or add manually:

```bash
cd ~/.meticai
echo "TAILSCALE_AUTHKEY=your_key_here" >> .env
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

## 🏗️ Architecture

MeticAI v2.0 runs as a single unified container:

```
┌─────────────────────────────────────────────────────────┐
│                    MeticAI Container                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                    nginx (:3550)                    │ │
│  │            Web UI + API Reverse Proxy               │ │
│  └─────────────────────────────────────────────────────┘ │
│                          │                               │
│          ┌───────────────┼───────────────┐               │
│          ▼               ▼               ▼               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │   Relay     │ │ MCP Server  │ │ Gemini CLI  │        │
│  │  (FastAPI)  │ │ (Meticulous)│ │    (AI)     │        │
│  │   :8000     │ │   :8080     │ │             │        │
│  └─────────────┘ └─────────────┘ └─────────────┘        │
└─────────────────────────────────────────────────────────┘
```

**Optional sidecars:**
- **Tailscale** - Secure remote access
- **Watchtower** - Automatic container updates

## 🛠️ Troubleshooting

### Container won't start

```bash
# Check logs
cd ~/.meticai && docker compose logs -f

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
cd ~/.meticai
docker compose down -v  # -v removes volumes
docker compose pull
docker compose up -d
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Meticulous](https://meticulous.coffee/) for creating an amazing machine
- [Google Gemini](https://ai.google.dev/) for AI capabilities
- [meticulous-mcp](https://github.com/meticulous/meticulous-mcp) for machine communication

---

<div align="center">
Made with ☕ by <a href="https://github.com/hessius">@hessius</a>
</div>
