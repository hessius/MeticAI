#!/bin/bash

################################################################################
# MeticAI - Interactive Installer
################################################################################
# 
# This script automates the installation of MeticAI, an autonomous AI agent
# that controls a Meticulous Espresso Machine using Google Gemini 2.0 Flash.
#
# USAGE:
#   ./local-install.sh
#
# WHAT IT DOES:
#   1. Checks for prerequisites (Git, Docker)
#   2. Interactively collects configuration (API keys, IP addresses)
#   3. Creates .env file with your settings
#   4. Clones the required Meticulous MCP source repository
#   5. Builds and launches Docker containers
#
# REQUIREMENTS:
#   - Git installed
#   - Docker & Docker Compose installed
#   - Google Gemini API key (get one at: https://aistudio.google.com/app/api-keys)
#   - Meticulous Espresso Machine with known local IP address
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}      ☕️ Barista AI Installer 🤖      ${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Generate and display ASCII QR code for a URL
generate_qr_code() {
    local url="$1"
    
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}     📱 Scan to Access Web App 📱      ${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    
    # Try to use qrencode if available (common on many Linux systems)
    if command -v qrencode &> /dev/null; then
        qrencode -t ansiutf8 "$url" 2>/dev/null
        echo ""
        echo -e "${YELLOW}Scan the QR code above to open MeticAI Web App${NC}"
        echo -e "${YELLOW}Or visit directly: ${BLUE}${url}${NC}"
        echo ""
        return
    fi
    
    # Try Python with qrcode library (if available)
    if command -v python3 &> /dev/null; then
        local python_result
        python_result=$(python3 -c "
try:
    import qrcode
    qr = qrcode.QRCode()
    qr.add_data('$url')
    qr.print_ascii()
    print('SUCCESS')
except:
    print('FAILED')
" 2>/dev/null)
        
        if echo "$python_result" | grep -q "SUCCESS"; then
            echo "$python_result" | grep -v "SUCCESS"
            echo ""
            echo -e "${YELLOW}Scan the QR code above to open MeticAI Web App${NC}"
            echo -e "${YELLOW}Or visit directly: ${BLUE}${url}${NC}"
            echo ""
            return
        fi
    fi
    
    # Fallback: Show a simple box with the URL
    echo -e "${YELLOW}┌──────────────────────────────────────────────┐${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  ${GREEN}✓${YELLOW} QR Code generation not available       │${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  Open this URL on your mobile device:       │${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  ${BLUE}${url}${YELLOW}│${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  💡 Tip: Install qrencode for QR codes:     │${NC}"
    echo -e "${YELLOW}│     apt install qrencode  (Debian/Ubuntu)    │${NC}"
    echo -e "${YELLOW}│     brew install qrencode (macOS)            │${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}└──────────────────────────────────────────────┘${NC}"
    echo ""
}

# Create macOS .app bundle for dock shortcut
create_macos_dock_shortcut() {
    local url="$1"
    local app_name="MeticAI"
    local app_path="$HOME/Applications/${app_name}.app"
    
    # Validate URL format (basic check for http/https)
    if [[ ! "$url" =~ ^https?:// ]]; then
        echo -e "${RED}Error: Invalid URL format. Skipping dock shortcut creation.${NC}"
        return 1
    fi
    
    echo ""
    echo -e "${YELLOW}Creating macOS dock shortcut...${NC}"
    
    # Create application bundle structure
    mkdir -p "${app_path}/Contents/MacOS"
    mkdir -p "${app_path}/Contents/Resources"
    
    # Create the executable script with properly escaped URL
    # Using printf to avoid shell expansion issues
    cat > "${app_path}/Contents/MacOS/${app_name}" << 'SCRIPT_EOF'
#!/bin/bash
# MeticAI Web App Launcher
SCRIPT_EOF
    printf 'open "%s"\n' "$url" >> "${app_path}/Contents/MacOS/${app_name}"
    
    # Make the script executable
    chmod +x "${app_path}/Contents/MacOS/${app_name}"
    
    # Create Info.plist
    # Note: CFBundleIconFile is omitted as we don't provide a custom icon.
    # macOS will use the default application icon.
    cat > "${app_path}/Contents/Info.plist" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${app_name}</string>
    <key>CFBundleIdentifier</key>
    <string>com.meticai.webapp</string>
    <key>CFBundleName</key>
    <string>${app_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST_EOF
    
    echo -e "${GREEN}✓ Dock shortcut created at: ${app_path}${NC}"
    echo -e "${YELLOW}  The MeticAI app will appear in your Applications folder.${NC}"
    echo -e "${YELLOW}  You can drag it to your Dock for quick access.${NC}"
    echo -e "${YELLOW}  Note: The app will use the default macOS application icon.${NC}"
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS=$ID
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        OS="unknown"
    fi
    echo "$OS"
}

# Install git based on OS
install_git() {
    local os
    os=$(detect_os)
    echo -e "${YELLOW}Installing git...${NC}"
    
    case "$os" in
        macos)
            if command -v brew &> /dev/null; then
                if brew install git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git via Homebrew.${NC}"
                    exit 1
                fi
            else
                echo -e "${YELLOW}Homebrew not found. Installing Homebrew first...${NC}"
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                
                # Source Homebrew environment for both Intel and Apple Silicon Macs
                if [ -f /opt/homebrew/bin/brew ]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [ -f /usr/local/bin/brew ]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                
                if command -v brew &> /dev/null && brew install git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git. Please install manually.${NC}"
                    echo "Visit: https://git-scm.com/downloads"
                    exit 1
                fi
            fi
            ;;
        ubuntu|debian|raspbian)
            if sudo apt-get update && sudo apt-get install -y git; then
                echo -e "${GREEN}✓ Git installed successfully.${NC}"
            else
                echo -e "${RED}Failed to install git. Please install manually.${NC}"
                exit 1
            fi
            ;;
        fedora|rhel|centos)
            if command -v dnf &> /dev/null; then
                if sudo dnf install -y git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git. Please install manually.${NC}"
                    exit 1
                fi
            elif command -v yum &> /dev/null; then
                if sudo yum install -y git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git. Please install manually.${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}No supported package manager found. Please install git manually.${NC}"
                exit 1
            fi
            ;;
        arch|manjaro)
            if sudo pacman -Sy --noconfirm git; then
                echo -e "${GREEN}✓ Git installed successfully.${NC}"
            else
                echo -e "${RED}Failed to install git. Please install manually.${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Unsupported OS for automatic installation. Please install git manually.${NC}"
            echo "Visit: https://git-scm.com/downloads"
            exit 1
            ;;
    esac
}

# Install docker based on OS
install_docker() {
    local os
    os=$(detect_os)
    echo -e "${YELLOW}Installing Docker...${NC}"
    
    if [[ "$os" == "macos" ]]; then
        echo -e "${YELLOW}On macOS, Docker Desktop must be installed manually.${NC}"
        echo -e "${YELLOW}Please visit: https://www.docker.com/products/docker-desktop${NC}"
        echo -e "${YELLOW}After installing Docker Desktop, make sure it's running and try again.${NC}"
        exit 1
    fi
    
    # Use Docker's official convenience script
    if command -v curl &> /dev/null; then
        curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        sudo sh /tmp/get-docker.sh
        rm /tmp/get-docker.sh
        
        # Add current user to docker group
        sudo usermod -aG docker "$USER" || true
        
        # Start docker service
        sudo systemctl enable docker || true
        sudo systemctl start docker || true
        
        echo -e "${GREEN}✓ Docker installed successfully.${NC}"
        echo -e "${YELLOW}Note: You may need to log out and back in for docker group changes to take effect.${NC}"
    else
        echo -e "${RED}curl is required to install Docker. Please install curl first.${NC}"
        exit 1
    fi
}

# Check if docker compose is available
check_docker_compose() {
    if docker compose version &> /dev/null; then
        return 0
    elif command -v docker-compose &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Install docker compose plugin
install_docker_compose() {
    local os
    os=$(detect_os)
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    
    if [[ "$os" == "macos" ]]; then
        echo -e "${YELLOW}On macOS, Docker Compose comes bundled with Docker Desktop.${NC}"
        echo -e "${YELLOW}If Docker Desktop is installed and running, Docker Compose should be available.${NC}"
        if check_docker_compose; then
            echo -e "${GREEN}✓ Docker Compose is available.${NC}"
            return 0
        else
            echo -e "${RED}Docker Compose not found. Please make sure Docker Desktop is installed and running.${NC}"
            echo -e "${YELLOW}Visit: https://www.docker.com/products/docker-desktop${NC}"
            exit 1
        fi
    fi
    
    # Try to install docker-compose-plugin (preferred method)
    case "$os" in
        ubuntu|debian|raspbian)
            if sudo apt-get update; then
                if sudo apt-get install -y docker-compose-plugin; then
                    echo -e "${GREEN}✓ Docker Compose plugin installed.${NC}"
                fi
            fi
            ;;
        fedora|rhel|centos)
            if command -v dnf &> /dev/null; then
                sudo dnf install -y docker-compose-plugin
            elif command -v yum &> /dev/null; then
                sudo yum install -y docker-compose-plugin
            fi
            ;;
        *)
            # Fallback to standalone docker-compose
            echo -e "${YELLOW}Installing standalone docker-compose...${NC}"
            sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
            sudo chmod +x /usr/local/bin/docker-compose
            ;;
    esac
    
    if check_docker_compose; then
        echo -e "${GREEN}✓ Docker Compose installed successfully.${NC}"
    else
        echo -e "${RED}Failed to install Docker Compose. Please install manually.${NC}"
        exit 1
    fi
}

# 1. Check for Prerequisites
echo -e "${YELLOW}[1/4] Checking and installing prerequisites...${NC}"

# Check and install git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed.${NC}"
    read -r -p "Would you like to install git now? (y/n) [y]: " INSTALL_GIT </dev/tty
    INSTALL_GIT=${INSTALL_GIT:-y}
    
    if [[ "$INSTALL_GIT" =~ ^[Yy]$ ]]; then
        install_git
    else
        echo -e "${RED}Error: git is required. Please install it manually and run this script again.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Git found.${NC}"
fi

# Check and install docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: docker is not installed.${NC}"
    read -r -p "Would you like to install Docker now? (y/n) [y]: " INSTALL_DOCKER </dev/tty
    INSTALL_DOCKER=${INSTALL_DOCKER:-y}
    
    if [[ "$INSTALL_DOCKER" =~ ^[Yy]$ ]]; then
        install_docker
    else
        echo -e "${RED}Error: Docker is required. Please install it manually and run this script again.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Docker found.${NC}"
fi

# Check and install docker compose
if ! check_docker_compose; then
    echo -e "${YELLOW}Docker Compose is not installed.${NC}"
    read -r -p "Would you like to install Docker Compose now? (y/n) [y]: " INSTALL_COMPOSE </dev/tty
    INSTALL_COMPOSE=${INSTALL_COMPOSE:-y}
    
    if [[ "$INSTALL_COMPOSE" =~ ^[Yy]$ ]]; then
        install_docker_compose
    else
        echo -e "${RED}Error: Docker Compose is required. Please install it manually and run this script again.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Docker Compose found.${NC}"
fi

echo -e "${GREEN}✓ All prerequisites satisfied.${NC}"
echo ""

# 2. Configure Environment Variables
################################################################################
# Collect user configuration and create .env file
# - GEMINI_API_KEY: Your Google Gemini API key
# - METICULOUS_IP: IP address of your espresso machine
# - PI_IP: IP address of this server (auto-detected, can override)
################################################################################
echo -e "${YELLOW}[2/4] Configuration${NC}"
echo "We need to create a .env file with your specific settings."
echo ""

# --- Gemini API Key ---
# Get your free API key at: https://aistudio.google.com/app/api-keys
echo "Get your free API key at: https://aistudio.google.com/app/api-keys"
read -r -p "Enter your Google Gemini API Key: " GEMINI_KEY </dev/tty
while [[ -z "$GEMINI_KEY" ]]; do
    echo -e "${RED}API Key cannot be empty.${NC}"
    read -r -p "Enter your Google Gemini API Key: " GEMINI_KEY </dev/tty
done

# --- Meticulous IP ---
read -r -p "Enter the IP address of your Meticulous Machine (e.g., 192.168.50.168): " MET_IP </dev/tty
while [[ -z "$MET_IP" ]]; do
    echo -e "${RED}IP Address cannot be empty.${NC}"
    read -r -p "Enter the IP address of your Meticulous Machine: " MET_IP </dev/tty
done

# --- Raspberry Pi IP (Auto-detect) ---
# Try to detect the default route IP (cross-platform)
detect_ip() {
    local detected_ip=""
    
    # Try macOS-specific methods first
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Try to get IP from default route
        detected_ip=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}' | xargs ipconfig getifaddr 2>/dev/null)
        
        if [ -z "$detected_ip" ]; then
            # Fallback: Try ipconfig getifaddr for common interfaces
            for interface in en0 en1 en2 en3 en4; do
                detected_ip=$(ipconfig getifaddr "$interface" 2>/dev/null)
                if [ -n "$detected_ip" ]; then
                    echo "$detected_ip"
                    return
                fi
            done
        fi
        
        if [ -z "$detected_ip" ]; then
            # Last resort: use ifconfig and parse
            detected_ip=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
        fi
    else
        # Linux: use hostname -I
        detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    
    echo "$detected_ip"
}

DETECTED_IP=$(detect_ip)
read -r -p "Enter the IP address of this Raspberry Pi [Default: $DETECTED_IP]: " PI_IP </dev/tty
PI_IP=${PI_IP:-$DETECTED_IP} # Use default if empty

# --- Write .env ---
echo ""
echo -e "Writing settings to .env..."
cat <<EOF > .env
GEMINI_API_KEY=$GEMINI_KEY
METICULOUS_IP=$MET_IP
PI_IP=$PI_IP
EOF
echo -e "${GREEN}✓ .env file created.${NC}"
echo ""

# 3. Setup Dependencies (The MCP Fork & Web App)
################################################################################
# Clone the Meticulous MCP server fork required for machine communication
# Repository: https://github.com/manonstreet/meticulous-mcp.git
# And the MeticAI Web Interface
# Repository: https://github.com/hessius/MeticAI-web.git
################################################################################
echo -e "${YELLOW}[3/4] Setting up Meticulous Source and Web App...${NC}"

# Clone MCP Source
if [ -d "meticulous-source" ]; then
    echo "Directory 'meticulous-source' already exists."
    read -r -p "Do you want to delete it and re-clone the latest version? (y/n) [n]: " CLONE_CONFIRM </dev/tty
    CLONE_CONFIRM=${CLONE_CONFIRM:-n}
    
    if [[ "$CLONE_CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Removing old source..."
        rm -rf meticulous-source
        echo "Cloning fresh repository..."
        git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
    else
        echo "Skipping clone (using existing source)."
    fi
else
    echo "Cloning Meticulous MCP fork..."
    git clone https://github.com/manonstreet/meticulous-mcp.git meticulous-source
fi
echo -e "${GREEN}✓ MCP source code ready.${NC}"

# Clone Web App
if [ -d "meticai-web" ]; then
    echo "Directory 'meticai-web' already exists."
    read -r -p "Do you want to delete it and re-clone the latest version? (y/n) [n]: " WEB_CLONE_CONFIRM </dev/tty
    WEB_CLONE_CONFIRM=${WEB_CLONE_CONFIRM:-n}
    
    if [[ "$WEB_CLONE_CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Removing old web app..."
        rm -rf meticai-web
        echo "Cloning fresh web app repository..."
        git clone https://github.com/hessius/MeticAI-web.git meticai-web
    else
        echo "Skipping clone (using existing web app)."
    fi
else
    echo "Cloning MeticAI Web Interface..."
    git clone https://github.com/hessius/MeticAI-web.git meticai-web
fi
echo -e "${GREEN}✓ Web app source code ready.${NC}"

# Create web app config directory if it doesn't exist
mkdir -p meticai-web/public

# Generate config.json for web app
echo "Generating web app configuration..."
cat <<WEBCONFIG > meticai-web/public/config.json
{
  "serverUrl": "http://$PI_IP:8000"
}
WEBCONFIG
echo -e "${GREEN}✓ Web app configured.${NC}"
echo ""

# 4. Build and Launch
################################################################################
# Stop any existing containers, then build and start the Docker services
# This includes:
# - coffee-relay: FastAPI server for receiving requests
# - gemini-client: AI brain using Google Gemini 2.0 Flash
################################################################################
echo -e "${YELLOW}[4/4] Building and Launching Containers...${NC}"
echo "Note: Running with sudo permissions."

# Stop existing containers if running
sudo docker compose down 2>/dev/null

# Build and start
if sudo docker compose up -d --build; then
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}      🎉 Installation Complete! 🎉       ${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo "Your Barista Agent is running."
    echo ""
    echo -e "👉 **Web Interface:** http://$PI_IP:3550"
    echo -e "👉 **Relay API:** http://$PI_IP:8000"
    echo -e "👉 **Meticulous:** http://$MET_IP (via Agent)"
    echo ""
    
    # Display QR code for easy mobile access
    generate_qr_code "http://$PI_IP:3550"
    
    # Offer macOS dock shortcut creation (only in interactive mode)
    if [[ "$OSTYPE" == "darwin"* ]] && [[ -t 0 ]]; then
        # Check if user wants to skip via environment variable
        if [[ "${SKIP_DOCK_SHORTCUT}" != "true" ]]; then
            echo ""
            read -r -p "Would you like to add a MeticAI shortcut to your Applications folder? (y/n) [y]: " CREATE_DOCK_SHORTCUT </dev/tty
            CREATE_DOCK_SHORTCUT=${CREATE_DOCK_SHORTCUT:-y}
            
            if [[ "$CREATE_DOCK_SHORTCUT" =~ ^[Yy]$ ]]; then
                create_macos_dock_shortcut "http://$PI_IP:3550"
            else
                echo -e "${YELLOW}Skipping dock shortcut creation.${NC}"
            fi
        fi
    fi
    
    echo "To test the connection, copy/paste this command:"
    echo -e "${BLUE}curl -X POST -F 'coffee_info=System Test' -F 'user_prefs=Default' http://$PI_IP:8000/analyze_and_profile${NC}"
    echo ""
    echo -e "${YELLOW}💡 Tip: Run './update.sh' anytime to check for updates to MeticAI and dependencies${NC}"
    echo ""
    
    # Run startup update check
    if [ -f "./check-updates-on-start.sh" ]; then
        ./check-updates-on-start.sh
    fi
else
    echo ""
    echo -e "${RED}❌ Installation failed during Docker build.${NC}"
    exit 1
fi
