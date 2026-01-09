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

### Requirements
* Server (Git, Docker & Docker Compose installed)
* Meticulous Espresso Machine (Local IP required)
* **Google Gemini API Key** - [Get your free API key here](https://aistudio.google.com/app/apikey)

### Option 1: Automatic Installation (Recommended)

The easiest way to get started is using the interactive installation script:

```bash
git clone <your-repo-url> met-ai
cd met-ai
./local-install.sh
```

The script will:
1. ✓ Check for required prerequisites (Git & Docker)
2. ✓ Prompt you for configuration values (API key, machine IP, server IP)
3. ✓ Create your `.env` file automatically
4. ✓ Clone the required Meticulous MCP source
5. ✓ Build and launch the Docker containers

After installation, the script will provide you with a test command to verify everything is working.

### Option 2: Manual Installation

If you prefer to set up manually:

#### 1. Clone the repository
```bash
git clone <your-repo-url> met-ai
cd met-ai
```

#### 2. Clone the required MCP source
```bash
git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
```

#### 3. Configure environment

Create a `.env` file in the root directory:
```
GEMINI_API_KEY=your_key_here
METICULOUS_IP=192.168.x.x  # IP of your Espresso Machine
PI_IP=192.168.x.x          # IP of this Raspberry Pi
```

#### 4. Build and run

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
