# MeticAI ☕️🤖

A collection of docker containers enabling an autonomous AI Agent running on a low powered server, e.g. Raspberry Pi, that controls a Meticulous Espresso Machine. It uses **Google Gemini 2.0 Flash** and **Meticulous-mcp** to "see" coffee bags, understand roast profiles, and create espresso profiles (recipes) which are installed on the machine automatically.



## Features
* **Vision Analysis:** Identifies roaster, origin, and notes from a photo.
* **Intelligent Profiling:** Auto-generates flow/pressure profiles based on bean data.
* **Modern Barista Persona:** Creates profiles with experimental techniques and witty, pun-heavy names.
* **Detailed Guidance:** Post-creation summaries with preparation instructions and design rationale.
* **Complex Recipe Support:** Multi-stage extraction, pre-infusion, blooming, and advanced profiling.
* **Zero-Touch Control:** Uploads recipes directly to the Meticulous machine.
* **Web Interface:** Modern, user-friendly web application for easy control and management.
* **iOS Integration:** One-tap brewing via Shortcuts.
* **Curl Integration:** Any service capable of polling a url can use the service.
* **macOS Dock Shortcut:** Optional dock icon for quick access to the web interface (macOS only).

## Architecture
1.  **Relay (FastAPI):** Receives images/requests from url calls.
2.  **Brain (Gemini CLI):** Decides on the recipe and tool usage.
3.  **Hands (MCP Server):** Communicates with the physical machine.
4.  **Web Interface:** React-based web application for user-friendly control (port 3550).

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
5. Clone the required MCP source repository and web application
6. Build and launch all containers (including web interface)
7. **Display a QR code** for easy mobile access to the web interface
8. **[macOS only]** Offer to create a dock shortcut for easy access to the web app

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
3. Clone the required MCP source repository and web application
4. Build and launch all containers (including web interface)
5. **Display a QR code** for easy mobile access to the web interface
6. **[macOS only]** Offer to create a dock shortcut for easy access to the web app

**Note:** After successful installation, you'll see a QR code that links directly to the web interface. Scan it with your mobile device for instant access! The QR code feature uses `qrencode` if available, or shows a helpful fallback with the URL if not.

**macOS Users:** During installation, you'll be prompted to create an application shortcut that opens MeticAI in your default browser. This creates a `.app` bundle in your Applications folder that you can add to your Dock for quick access. To skip this prompt in automated installations, set the environment variable `SKIP_DOCK_SHORTCUT=true`.

### 3. Manual Setup (Alternative)
If you prefer to install dependencies manually or are running on an unsupported OS:

Clone the repo and the required dependencies:
```bash
git clone <your-repo-url> met-ai
cd met-ai
# Clone the specific MCP fork
git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
# Clone the web application
git clone https://github.com/hessius/MeticAI-web.git meticai-web
```

#### Manual Configuration

Create a `.env` file in the root directory:
```
GEMINI_API_KEY=your_key_here
METICULOUS_IP=192.168.x.x  # IP of your Espresso Machine
PI_IP=192.168.x.x          # IP of this Raspberry Pi
```

Create the web app configuration file:
```bash
mkdir -p meticai-web/public
cat > meticai-web/public/config.json << EOF
{
  "serverUrl": "http://YOUR_PI_IP:8000"
}
EOF
```
Replace `YOUR_PI_IP` with your actual server IP address.

#### Manual Run

Note: Use sudo if your user does not have direct docker permissions
```bash
sudo docker compose up -d --build
```

## Updating MeticAI

MeticAI includes an automated update script to keep all components up to date. See [UPDATE_GUIDE.md](UPDATE_GUIDE.md) for comprehensive documentation.

### Quick Update

To check for and install updates:

```bash
./update.sh
```

This will:
1. Check for updates to MeticAI, meticulous-mcp, and meticai-web
2. Show you what updates are available
3. Prompt you to apply them
4. Optionally rebuild and restart containers

### Update Options

**Check for updates without installing:**
```bash
./update.sh --check-only
```

**Automatic update (non-interactive):**
```bash
./update.sh --auto
```

**Check repository configuration:**
```bash
./update.sh --switch-mcp-repo
```
**Note:** Repository switching is now **automatic** based on central configuration. When maintainers update `.update-config.json`, all users will automatically switch to the new repository on their next update. The `--switch-mcp-repo` flag can be used to manually check and apply the central configuration.

**Show help:**
```bash
./update.sh --help
```

### Automatic Repository Switching

All repository URLs are controlled centrally via `.update-config.json` in the main repository. This allows maintainers to switch all users to different repositories without requiring manual intervention from each user.

**How it works:**
1. Maintainers update `.update-config.json` with the new repository URLs
2. Users run `./update.sh` (or `./update.sh --auto`)
3. The script automatically detects repository changes and switches
4. Containers are rebuilt with the new dependencies

**For maintainers:**
To switch all users to different repositories, update the repository URLs in `.update-config.json`:
```json
{
  "version": "1.1",
  "description": "Central configuration for MeticAI update script",
  "repositories": {
    "meticulous-mcp": {
      "url": "https://github.com/meticulous/meticulous-mcp.git",
      "description": "Meticulous MCP server for machine control"
    },
    "meticai-web": {
      "url": "https://github.com/your-org/MeticAI-web.git",
      "description": "MeticAI web interface"
    }
  }
}
```

### Update Status API

Check for updates programmatically via the API:

```bash
curl http://<PI_IP>:8000/status
```

Returns:
```json
{
  "update_available": true/false,
  "last_check": "2026-01-13T19:45:00Z",
  "repositories": {
    "meticai": { "current_hash": "abc123...", "last_updated": "..." },
    "meticulous-mcp": { "current_hash": "def456...", "repo_url": "...", "last_updated": "..." },
    "meticai-web": { "current_hash": "ghi789...", "last_updated": "..." }
  }
}
```

The web interface can use this endpoint to show update notifications to users.

### Trigger Update Endpoint

Programmatically trigger backend updates via the API:

**`POST /api/trigger-update`**

**Description:** Triggers the backend update process by running `update.sh --auto` on the server. This runs the update script in non-interactive mode.

**Request:** No body needed.

**Response:**
- `200 OK` with JSON containing script output if successful:
  ```json
  {
    "status": "success",
    "output": "... script output ...",
    "message": "Update script completed successfully"
  }
  ```
- `500 Internal Server Error` with error details if failed:
  ```json
  {
    "detail": {
      "status": "error",
      "output": "... partial output ...",
      "error": "... error message ...",
      "message": "Update script failed"
    }
  }
  ```

**Example (curl):**
```bash
curl -X POST http://<PI_IP>:8000/api/trigger-update
```

**Example (JavaScript):**
```javascript
fetch('http://YOUR_PI_IP:8000/api/trigger-update', { method: 'POST' })
  .then(r => r.json())
  .then(data => {
    if (data.status === 'success') {
      console.log('Update completed:', data.output);
    } else {
      console.error('Update failed:', data.error);
    }
  });
```

**Security Note:**  
This endpoint is open to anyone with access to the backend API. Ensure your backend is not publicly exposed or restrict access at the network level if necessary. The update process will:
- Pull latest code from all repositories
- Rebuild Docker containers (where possible from inside container)
- Restart services automatically

Consider the implications before exposing this endpoint publicly.

### Fully Automatic Updates from Web UI (macOS)

On macOS, Docker Desktop security restrictions prevent containers from fully rebuilding themselves. To enable completely automatic updates triggered from the web interface, the **rebuild watcher** service is installed automatically during installation.

If you need to reinstall or manage the service manually:

```bash
# Install the launchd service
./rebuild-watcher.sh --install

# Uninstall the service
./rebuild-watcher.sh --uninstall
```

This service watches for update requests from the web UI and automatically completes the container rebuild on the host system.

**How it works:**
1. User triggers update from web UI (calls `/api/trigger-update`)
2. Backend pulls latest code and rebuilds what it can
3. Backend creates `.rebuild-needed` flag file
4. Host-side watcher detects the flag and runs `docker compose up -d --build`
5. All containers are rebuilt and restarted

**Rebuild watcher commands:**
```bash
# Run once to check and rebuild if needed
./rebuild-watcher.sh

# Check if rebuild is pending
./rebuild-watcher.sh --status

# Install as background service (macOS launchd)
./rebuild-watcher.sh --install

# Remove the service
./rebuild-watcher.sh --uninstall
```

**Without the watcher:** Updates from the web UI will still pull the latest code, but you'll need to run `docker compose up -d --build` manually to apply changes to containers with host volume mounts.

### Automatic Update Notifications

When you start the containers with `docker compose up` or run the install script, MeticAI automatically checks for updates and displays a notification if updates are available.

### Update Workflow Example

Here's a typical update workflow:

```bash
# 1. Check for updates
./update.sh --check-only

# Output shows which components have updates:
# 📦 MeticAI Main Repository
#    ✓ Up to date
# 📦 Meticulous MCP
#    ⚠ Update available
#    Current: abc123
#    Latest:  def456
# 📦 MeticAI Web Interface
#    ✓ Up to date

# 2. Apply updates (interactive)
./update.sh
# You'll be prompted to confirm and optionally rebuild containers

# 3. Or apply updates automatically (non-interactive)
./update.sh --auto
# Updates and rebuilds without prompts - great for automation

# 4. Switch MCP repository when fork merges upstream
./update.sh --switch-mcp-repo
# Choose between fork and main repository
```

### Integration with Web Applications

Web applications can poll the `/status` endpoint to check for updates and display notifications:

```javascript
// Example: Check for updates every hour
setInterval(async () => {
  const response = await fetch('http://YOUR_PI_IP:8000/status');
  const data = await response.json();
  
  if (data.update_available) {
    // Show notification to user
    showUpdateNotification('Updates available for MeticAI!');
  }
}, 3600000); // 1 hour
```

## Usage

MeticAI can be controlled through multiple interfaces:

### 1. Web Interface (Recommended)
Access the modern web interface at `http://<PI_IP>:3550` in your browser.

Features:
- **Upload coffee bag images** for analysis and profile creation
- **Add custom preferences** for personalized recipes
- **View real-time status** and responses
- **Clean, intuitive interface** built with React and shadcn/ui

The web interface automatically connects to the relay API and provides the easiest way to interact with MeticAI.

### 2. API Endpoints

MeticAI provides two main API endpoints:

#### 2.1. Unified Analysis & Profile Creation (Recommended)
`POST http://<PI_IP>:8000/analyze_and_profile`

This consolidated endpoint analyzes coffee and creates a profile in a single LLM pass.

**Required**: At least ONE of the following:
- `file`: Image of the coffee bag (multipart/form-data)
- `user_prefs`: User preferences or specific instructions (form data)

**Example with image only:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**Example with preferences only:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "user_prefs=Strong and intense espresso"
```

**Example with both:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Balanced extraction"
```

**Response:**
```json
{
  "status": "success",
  "analysis": "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes",
  "reply": "Profile uploaded"
}
```

#### 2.2. Quick Coffee Analysis (Standalone)
`POST http://<PI_IP>:8000/analyze_coffee`

For quick coffee bag analysis without profile creation.

**Required**: 
- `file`: Image of the coffee bag (multipart/form-data)

**Example:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_coffee \
  -F "file=@coffee_bag.jpg"
```

**Response:**
```json
{
  "analysis": "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes"
}
```

### 3. iOS Shortcut Setup

MeticAI can be controlled directly from your iPhone using Apple Shortcuts. Choose the workflow that best fits your needs.

**Note:** Throughout these instructions, `<PI_IP>` refers to your MeticAI server's IP address (e.g., `192.168.1.100`).

### Quick Start: Pre-Built Shortcut (Coming Soon)
A ready-to-use shortcut will be available for download. Check back soon for the direct link!

### Manual Setup Options

#### Option 1: Photo + Description (Recommended)
This workflow lets you photograph your coffee bag and optionally add preferences for the most personalized profile.

**Steps to create:**
1. Open the **Shortcuts** app on your iPhone
2. Tap the **+** button to create a new shortcut
3. Add these actions in order:

   **Action 1: Take Photo**
   - Search for and add "Take Photo"
   - Configure: Show Camera Preview = On

   **Action 2: Ask for Input** (Optional preferences)
   - Search for and add "Ask for Input"
   - Set Question: "Any preferences? (e.g., 'bold and chocolatey', or leave blank)"
   - Set Input Type: Text
   - Configure: Allow empty input

   **Action 3: Get Contents of URL**
   - Search for and add "Get Contents of URL"
   - Set URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Set Method: **POST**
   - Add Request Body: **Form**
   - Add two form fields:
     - Field 1: Key = `file`, Value = `Photo` (from Action 1)
     - Field 2: Key = `user_prefs`, Value = `Provided Input` (from Action 2)

   **Action 4: Show Notification**
   - Search for and add "Show Notification"
   - Set text to show: `Contents of URL` (from Action 3)

4. Name your shortcut (e.g., "MeticAI Coffee")
5. Tap **Done** to save

**Usage:** Tap the shortcut, take a photo of your coffee bag, optionally add preferences, and wait for confirmation!

#### Option 2: Photo Only
Fastest option - just snap a photo and let MeticAI create the perfect profile automatically.

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Take Photo**
   - Add "Take Photo"
   - Show Camera Preview = On

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `file`, Value = `Photo` (from Action 1)

   **Action 3: Show Notification**
   - Add "Show Notification"
   - Text: `Contents of URL` (from Action 2)

4. Name and save your shortcut

**Usage:** One tap → photo → profile created automatically!

#### Option 3: Description Only
Create profiles based on text descriptions when you don't have a photo.

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Ask for Input**
   - Add "Ask for Input"
   - Question: "Describe your coffee or preferences"
   - Input Type: Text

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_and_profile`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `user_prefs`, Value = `Provided Input` (from Action 1)

   **Action 3: Show Notification**
   - Add "Show Notification"
   - Text: `Contents of URL` (from Action 2)

4. Name and save your shortcut

**Usage:** Perfect for requesting specific profiles like "turbo shot" or "ristretto extraction"!

### Advanced: Analysis-Only Shortcut
For when you just want to identify your coffee without creating a profile:

**Steps to create:**
1. Open the **Shortcuts** app
2. Create a new shortcut
3. Add these actions:

   **Action 1: Take Photo**
   - Add "Take Photo"

   **Action 2: Get Contents of URL**
   - Add "Get Contents of URL"
   - URL: `http://<PI_IP>:8000/analyze_coffee`
   - Method: **POST**
   - Request Body: **Form**
   - Add form field: Key = `file`, Value = `Photo` (from Action 1)

   **Action 3: Show Result**
   - Add "Show Result"
   - Content: `Contents of URL` (from Action 2)

4. Name and save your shortcut

### Troubleshooting

**"Connection Failed" or timeout errors:**
- Verify your iPhone is on the same network as your MeticAI server
- Double-check the IP address in your shortcut matches your server's IP
- Ensure MeticAI is running: `docker ps` should show the coffee-relay container
- Test the connection in Safari: navigate to `http://<PI_IP>:8000/docs`

**"Invalid Response" or unexpected results:**
- Make sure you're using the correct endpoint (`/analyze_and_profile` or `/analyze_coffee`)
- Verify the HTTP method is set to **POST**
- Check that form field names are exactly `file` and/or `user_prefs` (case-sensitive)
- Review the notification output for error messages from the server

**Photo not uploading:**
- Ensure the form field key is exactly `file` (lowercase)
- Verify the value is set to the photo output from the "Take Photo" action
- Try taking a new photo instead of selecting from the library

**Preferences not being applied:**
- Ensure the form field key is exactly `user_prefs` (case-sensitive)
- Check that the input action allows empty input if you want it to be optional
- Verify the value is connected to the "Provided Input" from the Ask for Input action

### Tips for Best Results
- **Good lighting:** Take photos in well-lit areas for better coffee bag analysis
- **Clear labels:** Ensure the coffee bag label is visible and in focus
- **Specific preferences:** Use descriptive terms like "bright and fruity" or "bold with chocolatey notes"
- **Experiment:** Try different extraction styles in your preferences: "turbo shot", "traditional", "ristretto"

## Enhanced Barista Experience

MeticAI features a modern, experimental barista persona that creates sophisticated espresso profiles with personality and precision.

### Profile Creation Features

#### 🎯 Complex Recipe Support
The barista can create advanced profiles including:
- **Multi-stage extractions** with varying flow and pressure curves
- **Multiple pre-infusion steps** for optimal bed preparation
- **Blooming phases** to enhance flavor extraction
- **Pressure ramping** and temperature surfing techniques
- **Flow profiling** tailored to specific bean characteristics

#### 🎨 Creative Profile Naming
Every profile gets a witty, pun-heavy name that balances creativity with clarity:

**Example Names:**
- **"Slow-Mo Blossom"** - Gentle blooming profile for light roasts
- **"Pressure Point"** - Aggressive pressure ramping for bold extractions
- **"The Gusher"** - High-flow profile for fast, intense shots
- **"Espresso Yourself"** - Expressive, artistic extraction
- **"Bean There, Done That"** - Classic reliable profile
- **"Grounds for Celebration"** - Special occasion profile
- **"Extraction Traction"** - Balanced, controlled extraction

**Naming Philosophy:**
- Witty and fun, but never cryptic
- Clear indication of profile characteristics
- Memorable for quick selection
- Professional barista humor

#### 📋 Post-Creation Summary
After creating a profile, you'll receive a detailed summary:

**Profile Created:** [Clever Name]

**Description:** What makes this profile special and unique

**Preparation:**
- Recommended dose (e.g., 20g)
- Grind setting guidance
- Temperature recommendations
- Any pre-shot preparation steps

**Why This Works:** Scientific reasoning behind the profile design, explaining how it extracts the best from your specific beans

**Special Notes:** Any special equipment requirements (bottom filter, specific basket, etc.) or technique notes

### Sample Dialogue Examples

#### Example 1: Image Only
```
User: [Uploads photo of Ethiopian Yirgacheffe bag]

MeticAI Response:
Profile Created: "Floral Highness"

Description: A delicate, multi-stage profile designed to showcase the floral and 
citrus notes of this light Ethiopian roast. Features gentle pre-infusion, extended 
blooming, and a gradual pressure ramp.

Preparation: 18g dose, medium-fine grind, 93°C water temperature. Allow 30 seconds 
for pre-warming. The profile handles the gentle extraction automatically.

Why This Works: Light Ethiopian beans are dense and require careful extraction. 
The extended bloom allows CO2 to escape while the gradual pressure ramp prevents 
channeling and bitter compounds from overwhelming the delicate florals.

Special Notes: Works best with a bottomless portafilter to monitor extraction. 
Standard 18g VST basket recommended.
```

#### Example 2: With Preferences
```
User: [Uploads photo of Brazilian medium roast]
Preferences: "I want something bold and chocolatey"

MeticAI Response:
Profile Created: "Choco-Lot Going On"

Description: A bold, high-pressure profile that emphasizes the chocolate and nutty 
notes in this Brazilian medium roast. Features minimal pre-infusion and sustained 
high pressure for full-bodied extraction.

Preparation: 20g dose, fine grind, 94°C water temperature. Tamp firmly with 30lbs 
pressure. Profile duration: 28-30 seconds total.

Why This Works: Brazilian beans at medium roast are less prone to over-extraction. 
The aggressive pressure curve (9-10 bars sustained) maximizes body and chocolate 
notes while the higher temperature brings out caramelization flavors.

Special Notes: Requires precision basket (20g). If shots run too fast, grind finer 
or increase dose to 20.5g.
```

#### Example 3: Custom Request
```
User: "Create a turbo shot profile"

MeticAI Response:
Profile Created: "Warp Speed Espresso"

Description: An ultra-fast turbo profile achieving full extraction in 15 seconds. 
High flow rate with moderate pressure for a bright, intense shot.

Preparation: 18g dose, medium-coarse grind (coarser than traditional espresso), 
93°C temperature. The quick extraction time is built into the profile.

Why This Works: Turbo shots use increased flow (6-8ml/sec vs traditional 2ml/sec) 
with a coarser grind to achieve proper extraction in half the time. The result is 
bright acidity with lower bitterness due to reduced contact time.

Special Notes: Requires flow control capability. May produce more crema than 
traditional shots. Adjust grind to hit 2:1 ratio in 15 seconds. Not recommended 
for very dark roasts.
```

### Profile Customization Tips

When requesting profiles, you can specify:
- **Extraction style:** turbo, traditional, allongé, ristretto
- **Flavor focus:** brightness, sweetness, body, complexity
- **Bean characteristics:** origin, roast level, processing method
- **Special techniques:** blooming, pressure profiling, temperature steps
- **Equipment constraints:** basket size, machine capabilities

The barista persona understands modern espresso techniques and will create profiles that push the boundaries while remaining grounded in extraction science.

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

**Update Script Tests:**
```bash
bats tests/test_update.bats
```

### Test Coverage
- **Python**: 100% code coverage (38 tests)
  - 26 core functionality tests
  - 8 status endpoint tests
  - 4 CORS tests
- **Bash**: 38 critical functionality tests
  - 20 installation script tests
  - 18 update script tests

See [tests/README.md](tests/README.md) for detailed testing documentation and [TEST_COVERAGE.md](TEST_COVERAGE.md) for coverage metrics.

### Continuous Integration
All pull requests are automatically tested via GitHub Actions. Tests must pass before merging.

## Attribution & Credits

This project builds upon the excellent work of **@manonstreet** and their [Meticulous MCP](https://github.com/manonstreet/meticulous-mcp) project. The Meticulous MCP server provides the essential interface for controlling the Meticulous Espresso Machine programmatically.

We are grateful for their contribution to the community and for making their work available for others to build upon.
