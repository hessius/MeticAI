<div align="center">

<img src="resources/logo.png" alt="MeticAI Logo" width="200" />

# MeticAI

### Your AI Barista Coach for the Meticulous Espresso Machine

*Create, profile and understand your espresso. Take a photo or describe your coffee. Get a perfect espresso recipe. Automatically.*

[Get Started](#-quick-start) • [Features](#-what-it-does) • [Web Interface](#-using-meticai) • [Updates](UPDATE_GUIDE.md)

</div>

---

## 🎯 What is MeticAI?

MeticAI transforms your Meticulous Espresso Machine into an AI-powered coffee expert. Take a photo of your coffee bag or describe what you want, and MeticAI uses Google's Gemini AI to:

1. 🧠 **Create a custom recipe** - Tailored extraction profile for your beans
2. 📸 **Analyze your coffee** - Identify roaster, origin, and roast level
3. ☕️ **Upload it to your machine** - Ready to brew in seconds

No manual recipe tweaking. No guesswork. Just consistently great espresso.

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
- 🐳 **Self-Hosted** - Runs on Raspberry Pi or any Unix server
- 🔓 **Open Source** - Customize and extend as you like
- 📡 **Update System** - One-command updates for all components

### Additional Features
- 🍎 **macOS Dock Integration** - Optional dock shortcut for quick access
- 📱 **QR Code Setup** - Easy mobile access during installation  
- 🔄 **Automatic Updates** - Built-in update system with web UI support
- 🌍 **URL Integration** - Control via curl from any HTTP-capable device
- 🔐 **Secure** - Self-hosted means your data stays private
- 🎨 **Modern UI** - Built with React and shadcn/ui for a polished experience

## 🚀 Quick Start

### What You Need
- ☑️ A **Meticulous Espresso Machine** (connected to your network)
- ☑️ A server to run MeticAI (Raspberry Pi, Mac, or Linux computer)
- ☑️ A **free Google Gemini API key** → [Get yours here](https://aistudio.google.com/app/apikey) (takes 30 seconds)

### Installation (5 minutes)

**Option 1: One-Line Install** (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash
```

That's it! The installer will:
- ✅ Check for and install prerequisites (git, docker, docker-compose)
- ✅ Detect and handle any existing MeticAI installations
- ✅ Stop and remove running MeticAI containers if found
- ✅ Guide you through setup (just paste your API key and machine IP)
- ✅ Download and start all services
- ✅ Show a QR code to access the web interface from your phone
- ✅ *[macOS only]* Optionally create a Dock icon for quick access

**Option 2: Manual Install**
```bash
git clone https://github.com/hessius/MeticAI.git
cd MeticAI
./local-install.sh
```

After installation completes, scan the QR code with your phone or visit `http://YOUR_SERVER_IP:3550` in a browser!

**Reinstalling or Upgrading?**

If you already have MeticAI installed, the installer will:
- Detect existing containers and installation artifacts
- Offer to run the uninstall script first for a clean installation
- Allow you to continue anyway if you prefer to reuse existing configuration

For a clean reinstall, it's recommended to run `./uninstall.sh` first.

### Need Help?
- 📖 [Detailed installation guide](TECHNICAL.md#manual-setup-alternative)
- 🔧 [Troubleshooting common issues](#troubleshooting)

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
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**With text preferences:**
```bash
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "user_prefs=Bold and chocolatey"
```

**With both:**
```bash
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Traditional extraction"
```

[→ Full API documentation](API.md)

### Advanced: iOS Shortcuts

For power users who want one-tap brewing from their iPhone, you can create custom shortcuts.

[→ iOS Shortcuts setup guide](IOS_SHORTCUTS.md)

## 🔄 Keeping MeticAI Updated

MeticAI has automatic updates built in!

**Quick update:**
```bash
./update.sh
```

**Check without updating:**
```bash
./update.sh --check-only
```

The system automatically:
- ✅ Checks all components for updates
- ✅ Shows what's new
- ✅ Updates and rebuilds containers
- ✅ Can even update from the web interface!

[→ Full update system documentation](UPDATE_GUIDE.md)

## 🗑️ Uninstalling MeticAI

Need to remove MeticAI? We've got you covered with a clean uninstallation process.

**Run the uninstaller:**
```bash
./uninstall.sh
```

The uninstaller will:
- ✅ Stop and remove all Docker containers
- ✅ Remove Docker images built by MeticAI
- ✅ Remove cloned repositories (meticulous-source, meticai-web)
- ✅ Remove configuration files (.env, settings)
- ✅ Remove macOS integrations (Dock shortcut, rebuild watcher)
- ✅ Ask about external dependencies (Docker, git, qrencode)

**Safe by default:**
- External dependencies are **NOT** automatically removed
- You'll be asked to confirm before removing anything
- Summary shows what was removed and what was kept

**Note:** The uninstaller doesn't remove Docker, git, or other tools unless you explicitly choose to do so. This is safe if you use these tools for other projects.

---

## 🎨 What Makes MeticAI Special

### The AI Barista Persona

MeticAI doesn't just create recipes—it creates *experiences* with:

**🎯 Witty Profile Names**
- "Slow-Mo Blossom" for gentle light roasts
- "Choco-Lot Going On" for bold chocolatey extractions  
- "Warp Speed Espresso" for turbo shots

**📊 Complete Guidance**
Every profile includes:
- ☕️ Recommended dose and grind settings
- 🌡️ Temperature recommendations
- 🔬 Scientific explanation of why it works
- ⚙️ Any special equipment notes

**🚀 Modern Techniques**
Supports advanced espresso methods:
- Multi-stage extractions
- Pre-infusion and blooming
- Pressure profiling and flow control
- Turbo shots and more

[→ See example profiles and dialogues](TECHNICAL.md#enhanced-barista-experience)

---

## 📚 Additional Resources

### For Users
- 📱 [iOS Shortcuts Setup Guide](IOS_SHORTCUTS.md)
- 🔄 [Update System Guide](UPDATE_GUIDE.md)
- 📊 [Logging & Diagnostics](LOGGING.md)
- 🔧 [Troubleshooting](#troubleshooting)

### For Developers
- 🔌 [API Documentation](API.md)
- 🏗️ [Technical Architecture](TECHNICAL.md)
- 🧪 [Testing Guide](TEST_COVERAGE.md)
- 🔒 [Security Notes](SECURITY_FIXES.md)

---

## 🆘 Troubleshooting

### Installation Issues

**Prerequisites not installing:**
- The script auto-detects your OS and installs what's needed
- On unsupported systems, manually install: git, docker, docker-compose
- See [TECHNICAL.md](TECHNICAL.md#manual-setup-alternative) for manual setup

**Can't connect to machine:**
- Verify your Meticulous machine is on the network
- Check the IP address is correct in your `.env` file
- Ensure both devices are on the same network

### Usage Issues

**"Connection Failed" errors:**
- Make sure MeticAI is running: `docker ps`
- Check you're on the same network as the server
- Verify the IP address in your requests

**Profiles not appearing on machine:**
- Check the MCP server logs: `docker logs meticulous-mcp -f`
- Verify `METICULOUS_IP` in `.env` is correct
- Ensure the machine's API is accessible

**Poor coffee analysis:**
- Take photos in good lighting
- Ensure the label is clear and in focus
- Try adding text preferences to guide the AI

### Getting Help

**Check detailed logs:**
```bash
# View structured error logs
tail -f logs/coffee-relay-errors.log | jq .

# View all logs
tail -f logs/coffee-relay.log | jq .

# Or via API
curl "http://localhost:8000/api/logs?level=ERROR&lines=100"

# See LOGGING.md for more details
```

**Check container logs:**
```bash
# All services
docker compose logs -f

# Specific service
docker logs coffee-relay -f
docker logs gemini-client -f
docker logs meticulous-mcp -f
```

**Restart services:**
```bash
docker compose restart
```

**Full reset (recommended - uses wrapper script for correct permissions):**
```bash
./docker-up.sh
```

**Full reset (manual - may require permission fix on Linux):**
```bash
docker compose down
docker compose up -d --build
# If you used sudo, fix permissions:
sudo chown -R $(id -u):$(id -g) data logs meticulous-source meticai-web
```

For comprehensive troubleshooting and log analysis, see [LOGGING.md](LOGGING.md).

---

## 🙏 Credits & Attribution

MeticAI is built on the excellent [Meticulous MCP](https://github.com/twchad/meticulous-mcp) project by **twchad** and its [containerized fork](https://github.com/manonstreet/meticulous-mcp) by **@manonstreet**, which provides the essential interface for controlling the Meticulous Espresso Machine.

### Technology Stack
- **Google Gemini 2.0 Flash** - Vision AI and reasoning
- **FastAPI** - Backend API framework  
- **Docker** - Containerization and deployment
- **React** - Web interface
- **Python** - Core application logic

### Open Source

MeticAI is open source and welcomes contributions!

- 📖 [View the code on GitHub](https://github.com/hessius/MeticAI)
- 🐛 [Report issues](https://github.com/hessius/MeticAI/issues)
- 💡 [Contribute improvements](https://github.com/hessius/MeticAI/pulls)

---

<div align="center">

**Made with ☕️, ❤️, and 🤖**

[Get Started](#-quick-start) • [Features](#-what-it-does) • [Documentation](#-additional-resources)

</div>
