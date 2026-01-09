# MeticAI ☕️🤖

A collection of docker containers enabling an autonomous AI Agent running on a low powered server, e.g. Raspberry Pi, that controls a Meticulous Espresso Machine. It uses **Google Gemini 2.0 Flash** and **Meticulous-mcp** to "see" coffee bags, understand roast profiles, and create espresso profiles (recipes) which are installed on the machine automatically.



## Features
* **Vision Analysis:** Identifies roaster, origin, and notes from a photo.
* **Intelligent Profiling:** Auto-generates flow/pressure profiles based on bean data.
* **Modern Barista Persona:** Creates profiles with experimental techniques and witty, pun-heavy names.
* **Detailed Guidance:** Post-creation summaries with preparation instructions and design rationale.
* **Complex Recipe Support:** Multi-stage extraction, pre-infusion, blooming, and advanced profiling.
* **Zero-Touch Control:** Uploads recipes directly to the Meticulous machine.
* **iOS Integration:** One-tap brewing via Shortcuts.
* **Curl Integration:** Any service capable of polling a url can use the service.

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

## Usage

MeticAI provides two main endpoints:

### 1. Unified Analysis & Profile Creation (Recommended)
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

### 2. Quick Coffee Analysis (Standalone)
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

## iOS Shortcut Setup

### Option 1: One-Step Unified Approach (Recommended)
Create a shortcut with the following logic:

1. Take Photo
2. Ask for Input (Preferences) - Optional
3. Get Contents of URL
   - POST http://<PI_IP>:8000/analyze_and_profile
   - File: (Photo from Step 1)
   - Form: user_prefs (Input from Step 2, if provided)
4. Show Notification (Result)

### Option 2: Two-Step Approach
For users who want separate analysis first:

1. Take Photo
2. Get Contents of URL (Analyze)
   - POST http://<PI_IP>:8000/analyze_coffee
   - File: (Photo)
3. Show Result (Analysis)
4. Ask for Input (Preferences)
5. Get Contents of URL (Create Profile)
   - POST http://<PI_IP>:8000/analyze_and_profile
   - Form: user_prefs (Input from Step 4)
6. Show Notification (Result)

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

Preparation: 18g dose, medium-coarse grind (courser than traditional espresso), 
93°C temperature. The quick extraction time is built into the profile.

Why This Works: Turbo shots use increased flow (6-8ml/sec vs traditional 2ml/sec) 
with a courser grind to achieve proper extraction in half the time. The result is 
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

### Test Coverage
- **Python**: 100% code coverage (26 tests)
- **Bash**: 20 critical functionality tests

See [tests/README.md](tests/README.md) for detailed testing documentation and [TEST_COVERAGE.md](TEST_COVERAGE.md) for coverage metrics.

### Continuous Integration
All pull requests are automatically tested via GitHub Actions. Tests must pass before merging.

## Attribution & Credits

This project builds upon the excellent work of **@manonstreet** and their [Meticulous MCP](https://github.com/manonstreet/meticulous-mcp) project. The Meticulous MCP server provides the essential interface for controlling the Meticulous Espresso Machine programmatically.

We are grateful for their contribution to the community and for making their work available for others to build upon.
