# Technical Documentation

## Architecture

MeticAI consists of three main containerized services:

1.  **Relay (FastAPI):** Receives images/requests from url calls.
2.  **Brain (Gemini CLI):** Decides on the recipe and tool usage.
3.  **Hands (MCP Server):** Communicates with the physical machine.
4.  **Web Interface:** React-based web application for user-friendly control (port 3550).

## Manual Setup (Alternative)

If you prefer to install dependencies manually or are running on an unsupported OS:

Clone the repo and the required dependencies:
```bash
git clone https://github.com/hessius/MeticAI.git met-ai
cd met-ai
# Clone the specific MCP fork
git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
# Clone the web application
git clone https://github.com/hessius/MeticAI-web.git meticai-web
```

### Manual Configuration

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

### Manual Run

Note: Use sudo if your user does not have direct docker permissions
```bash
sudo docker compose up -d --build
```

## Installation Process Details

### Automated Installer Features

The `local-install.sh` script includes several safety features to ensure a clean installation:

#### Previous Installation Detection

Before starting the installation, the script automatically checks for:
- Running MeticAI containers (`meticulous-mcp-server`, `gemini-client`, `coffee-relay`, `meticai-web`)
- Existing installation artifacts (`.env`, `meticulous-source/`, `meticai-web/`, etc.)
- macOS-specific integrations (Dock shortcuts, rebuild watcher service)

If any previous installation is detected, you'll be prompted with options:
1. **Run uninstall script first** (recommended for clean reinstall)
2. **Continue anyway** (reuses existing configuration if available)

#### Container Cleanup

The installer automatically:
- Detects running MeticAI containers
- Stops and removes them gracefully before proceeding
- Uses `docker compose down` when possible for clean shutdown
- Falls back to individual container removal if needed

This ensures:
- No port conflicts during installation
- Fresh container builds with latest changes
- Proper cleanup of orphaned containers

#### Safe Reinstallation Workflow

For the cleanest reinstallation experience:
```bash
# 1. Run the uninstaller
./uninstall.sh

# 2. Run the installer
./local-install.sh
```

Alternatively, the installer will offer to run the uninstaller automatically when previous installations are detected.

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

## Attribution & Credits

MeticAI is built on the excellent Meticulous MCP project by twchad and its containerized fork by @manonstreet, which provides the essential interface for controlling the Meticulous Espresso Machine.

## Data Persistence

### Scheduled Shots Persistence

MeticAI includes a robust persistence layer for scheduled shots to ensure reliability across server restarts.

#### Features

- **Automatic Persistence:** All scheduled shots are automatically saved to disk
- **Crash Recovery:** Scheduled shots survive server crashes, deploys, and host reboots
- **Smart Restoration:** On startup, pending shots are automatically restored and rescheduled
- **Expired Shot Filtering:** Shots scheduled in the past are automatically skipped during restoration
- **Atomic Writes:** File writes use atomic operations (temp file + rename) to prevent corruption
- **Graceful Degradation:** Corrupt files are automatically backed up and ignored

#### Implementation Details

**Storage Location:**
- Default: `/app/data/scheduled_shots.json`
- Fallback: System temporary directory if default is not writable

**Persisted Data:**
- Only active shots (`scheduled` and `preheating` status) are saved
- Completed, failed, and cancelled shots are not persisted
- Each shot includes: `id`, `profile_id`, `scheduled_time`, `preheat`, `status`, `created_at`

**Lifecycle:**
1. **On Creation:** Shot is saved to disk immediately after scheduling
2. **On Status Change:** Disk is updated when status changes (preheating → running → completed)
3. **On Startup:** All persisted shots are loaded and validated
4. **On Restoration:** Async tasks are recreated for pending shots with time remaining
5. **On Cleanup:** Completed/cancelled shots older than 1 hour are removed from memory and disk

**Error Handling:**
- Corrupt JSON files are backed up with `.corrupt` extension
- Permission errors fall back to temporary directory
- Invalid data is logged and skipped
- Missing files are treated as empty (no scheduled shots)

#### Testing

The persistence layer includes comprehensive test coverage:
- Save and load operations
- Active shot filtering
- Missing file handling
- Corrupt file recovery
- Atomic write verification
- Integration with scheduling endpoints

Run persistence tests:
```bash
cd coffee-relay
pytest test_main.py::TestScheduledShotsPersistence -v
```
