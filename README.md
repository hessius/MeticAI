<div align="center">

# ☕️ MeticAI 🤖

### Your AI Barista for the Meticulous Espresso Machine

*Snap a photo of your coffee bag. Get a perfect espresso recipe. Automatically.*

[Get Started](#-quick-start) • [Features](#-what-it-does) • [iOS Shortcuts](IOS_SHORTCUTS.md) • [Web Interface](#-using-meticai) • [Updates](UPDATE_GUIDE.md)

</div>

---

## 🎯 What is MeticAI?

MeticAI transforms your Meticulous Espresso Machine into an AI-powered coffee expert. Simply take a photo of your coffee bag, and MeticAI uses Google's Gemini vision AI to:

1. 📸 **Identify your coffee** - Roaster, origin, roast level, and tasting notes
2. 🧠 **Create a custom recipe** - Tailored extraction profile based on the beans
3. ☕️ **Upload it to your machine** - Ready to brew in seconds

No manual recipe tweaking. No guesswork. Just consistently great espresso.

## ✨ What It Does

### For Everyone
- 📱 **One-Tap iOS Shortcuts** - Take photo, get recipe, brew
- 🌐 **Beautiful Web Interface** - Control everything from your phone or computer
- 🎨 **Creative Recipe Names** - Like "Slow-Mo Blossom" and "Choco-Lot Going On"
- 💬 **Natural Language** - "Make it bold and chocolatey" or "turbo shot"
- 🤖 **Fully Automatic** - From photo to machine, no steps in between

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

### Need Help?
- 📖 [Detailed installation guide](TECHNICAL.md#manual-setup-alternative)
- 🔧 [Troubleshooting common issues](#troubleshooting)

## 📱 Using MeticAI

### Web Interface (Easiest)

Open `http://YOUR_SERVER_IP:3550` in any browser.

1. **Upload a photo** of your coffee bag
2. **Add preferences** (optional) - like "bold and intense" or "turbo shot"
3. **Click Create Profile**
4. ✨ Done! The recipe is now on your machine

The web interface shows real-time status, analysis results, and generated profiles with full details.

### iOS Shortcuts (One-Tap Brewing)

Create an iPhone shortcut to go from photo to profile in one tap!

**Quick setup:**
1. Open the Shortcuts app
2. Create new shortcut → Add "Take Photo" action
3. Add "Get Contents of URL" → Set to `http://YOUR_IP:8000/analyze_and_profile`
4. Set method to POST, add form field: `file` = Photo
5. Add "Show Notification" to see the result

[→ Detailed iOS setup guide with all options](IOS_SHORTCUTS.md)

### Examples

**Photo only:**
```bash
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**With preferences:**
```bash
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Make it bold and chocolatey"
```

**Text only (no photo):**
```bash
curl -X POST http://YOUR_IP:8000/analyze_and_profile \
  -F "user_prefs=Create a turbo shot profile"
```

[→ Full API documentation](API.md)

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

**Check logs:**
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

**Full reset:**
```bash
docker compose down
docker compose up -d --build
```

---

## 🙏 Credits & Attribution

MeticAI is built on the excellent [Meticulous MCP](https://github.com/manonstreet/meticulous-mcp) project by **@manonstreet**, which provides the essential interface for controlling the Meticulous Espresso Machine.

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

**Made with ☕️ and 🤖**

[Get Started](#-quick-start) • [Features](#-what-it-does) • [Documentation](#-additional-resources)

</div>
