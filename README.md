# Barista AI ☕️🤖

An autonomous AI Agent running on Raspberry Pi that controls a Meticulous Espresso Machine. It uses **Google Gemini 2.0 Flash** to "see" coffee bags, understand roast profiles, and program the machine automatically.



## Features
* **Vision Analysis:** Identifies roaster, origin, and notes from a photo.
* **Intelligent Profiling:** Auto-generates flow/pressure profiles based on bean data.
* **Zero-Touch Control:** Uploads recipes directly to the Meticulous machine.
* **iOS Integration:** One-tap brewing via Shortcuts.

## Architecture
1.  **Relay (FastAPI):** Receives images/requests from iPhone.
2.  **Brain (Gemini CLI):** Decides on the recipe and tool usage.
3.  **Hands (MCP Server):** Communicates with the physical machine.

## Installation

### 1. Requirements
* Raspberry Pi (Docker & Docker Compose installed)
* Meticulous Espresso Machine (Local IP required)
* Google Gemini API Key

### 2. Setup
Clone the repo and the required MCP source:
```bash
git clone <your-repo-url> met-ai
cd met-ai
# Clone the specific MCP fork
git clone [https://github.com/manonstreet/meticulous-mcp.git](https://github.com/manonstreet/meticulous-mcp.git) meticulous-source
