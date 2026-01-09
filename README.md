# MeticAI ☕️🤖

A collection of docker containers enabling an autonomous AI Agent running on a low powered server, e.g. Raspberry Pi, that controls a Meticulous Espresso Machine. It uses **Google Gemini 2.0 Flash** and **Meticulous-mcp** to "see" coffee bags, understand roast profiles, and create espresso profiles (recipes) which are installed on the machine automatically.



## Features
* **Vision Analysis:** Identifies roaster, origin, and notes from a photo.
* **Intelligent Profiling:** Auto-generates flow/pressure profiles based on bean data.
* **Zero-Touch Control:** Uploads recipes directly to the Meticulous machine.
* **iOS Integration:** One-tap brewing via Shortcuts.
* **Curl Integration**: Any service capable of polling a url can use the service

## Architecture
1.  **Relay (FastAPI):** Receives images/requests from url calls.
2.  **Brain (Gemini CLI):** Decides on the recipe and tool usage.
3.  **Hands (MCP Server):** Communicates with the physical machine.

## Installation

### 1. Requirements
* Server running Linux (Debian/Ubuntu, RHEL/Fedora/CentOS, or Arch-based)
* Meticulous Espresso Machine (Local IP required)
* Google Gemini API Key

**Note:** The installation script will automatically check for and offer to install the following prerequisites if they are missing:
* Git
* Docker
* Docker Compose

### 2. Quick Setup
Use the automated installer script:
```bash
# Clone this repository (if git is installed)
git clone <your-repo-url> met-ai
cd met-ai

# Run the interactive installer
./local-install.sh
```

The script will:
1. Check for prerequisites (git, docker, docker-compose) and offer to install them if missing
2. Guide you through configuration (API keys, IP addresses)
3. Clone the required MCP source repository
4. Build and launch all containers

### 3. Manual Setup (Alternative)
If you prefer to install dependencies manually or are running on an unsupported OS:

Clone the repo and the required MCP source:
```bash
git clone <your-repo-url> met-ai
cd met-ai
# Clone the specific MCP fork
git clone [https://github.com/manonstreet/meticulous-mcp.git](https://github.com/manonstreet/meticulous-mcp.git) meticulous-source
```

#### Manual Configuration

Create a .env file in the root directory:
```
GEMINI_API_KEY=your_key_here
METICULOUS_IP=192.168.x.x  # IP of your Espresso Machine
PI_IP=192.168.x.x          # IP of this Raspberry Pi
```

#### Manual Run

Note: Use sudo if your user does not have direct docker permissions
```bash
sudo docker compose up -d --build
```

## iOS Shortcut Setup
Create a shortcut with the following logic:

Take Photo

Get Contents of URL (Analyze)

POST http://<PI_IP>:8000/analyze_coffee

File: (Photo)

Ask for Input (Preferences)

Get Contents of URL (Create)

POST http://<PI_IP>:8000/create_profile

Form: coffee_info (Result of Step 2), user_prefs (Result of Step 3)

Show Notification (Result)
