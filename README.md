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
* Server running UNIX terminal (MacOS, Debian/Ubuntu, RHEL/Fedora/CentOS, or Arch-based)
* Meticulous Espresso Machine (Local IP required)
* **Google Gemini API Key** - [Get your free API key here](https://aistudio.google.com/app/apikey)

**Note:** The installation script will automatically check for and offer to install the following prerequisites if they are missing:
* Git
* Docker
* Docker Compose

### 2. Quick Setup

#### Option A: Remote Installation (Recommended)
Install directly from the web without cloning the repository first:
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash
```

This one-liner will:
1. Download and execute the installation script
2. Clone the MeticAI repository
3. Check for prerequisites (git, docker, docker-compose) and offer to install them if missing
4. Guide you through configuration (API keys, IP addresses)
5. Clone the required MCP source repository
6. Build and launch all containers

#### Option B: Local Installation
If you prefer to clone the repository first:
```bash
# Clone this repository
git clone https://github.com/hessius/MeticAI.git
cd MeticAI

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
git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
```

#### Manual Configuration

Create a `.env` file in the root directory:
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

## Testing

MeticAI includes a comprehensive test suite to ensure code quality and reliability.

### Running Tests

**Python Tests (FastAPI Application):**
```bash
cd coffee-relay
pip install -r requirements-test.txt
pytest test_main.py -v --cov=main
```

**Bash Tests (Installation Script):**
```bash
# Install BATS if not already installed
# Ubuntu/Debian: sudo apt-get install bats
# macOS: brew install bats-core

bats tests/test_local_install.bats
```

### Test Coverage
- **Python**: 100% code coverage (20 tests)
- **Bash**: 20 critical functionality tests

See [tests/README.md](tests/README.md) for detailed testing documentation and [TEST_COVERAGE.md](TEST_COVERAGE.md) for coverage metrics.

### Continuous Integration
All pull requests are automatically tested via GitHub Actions. Tests must pass before merging.

## Attribution & Credits

This project builds upon the excellent work of **@manonstreet** and their [Meticulous MCP](https://github.com/manonstreet/meticulous-mcp) project. The Meticulous MCP server provides the essential interface for controlling the Meticulous Espresso Machine programmatically.

We are grateful for their contribution to the community and for making their work available for others to build upon.
