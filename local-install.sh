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
#   - Google Gemini API key (get one at: https://aistudio.google.com/app/apikey)
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

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
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
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    
    # Try to install docker-compose-plugin (preferred method)
    local os
    os=$(detect_os)
    
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
    echo -e "${YELLOW}Git is not installed.${NC}"
    read -p "Would you like to install git now? (y/n) [y]: " INSTALL_GIT
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
    echo -e "${YELLOW}Docker is not installed.${NC}"
    read -p "Would you like to install Docker now? (y/n) [y]: " INSTALL_DOCKER
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
    read -p "Would you like to install Docker Compose now? (y/n) [y]: " INSTALL_COMPOSE
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
# Get your free API key at: https://aistudio.google.com/app/apikey
read -p "Enter your Google Gemini API Key: " GEMINI_KEY
while [[ -z "$GEMINI_KEY" ]]; do
    echo -e "${RED}API Key cannot be empty.${NC}"
    read -p "Enter your Google Gemini API Key: " GEMINI_KEY
done

# --- Meticulous IP ---
read -p "Enter the IP address of your Meticulous Machine (e.g., 192.168.50.168): " MET_IP
while [[ -z "$MET_IP" ]]; do
    echo -e "${RED}IP Address cannot be empty.${NC}"
    read -p "Enter the IP address of your Meticulous Machine: " MET_IP
done

# --- Raspberry Pi IP (Auto-detect) ---
# Try to detect the default route IP
DETECTED_IP=$(hostname -I | awk '{print $1}')
read -p "Enter the IP address of this Raspberry Pi [Default: $DETECTED_IP]: " PI_IP
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

# 3. Setup Dependencies (The MCP Fork)
################################################################################
# Clone the Meticulous MCP server fork required for machine communication
# Repository: https://github.com/manonstreet/meticulous-mcp.git
################################################################################
echo -e "${YELLOW}[3/4] Setting up Meticulous Source...${NC}"

if [ -d "meticulous-source" ]; then
    echo "Directory 'meticulous-source' already exists."
    read -p "Do you want to delete it and re-clone the latest version? (y/n) [n]: " CLONE_CONFIRM
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
echo -e "${GREEN}✓ Source code ready.${NC}"
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
    echo -e "👉 **Relay API:** http://$PI_IP:8000"
    echo -e "👉 **Meticulous:** http://$MET_IP (via Agent)"
    echo ""
    echo "To test the connection, copy/paste this command:"
    echo -e "${BLUE}curl -X POST -F 'coffee_info=System Test' -F 'user_prefs=Default' http://$PI_IP:8000/create_profile${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Installation failed during Docker build.${NC}"
    exit 1
fi
