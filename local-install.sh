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

# Check for existing .env file at the very beginning
if [ -f ".env" ]; then
    echo -e "${YELLOW}Found existing .env file.${NC}"
    echo ""
    cat .env
    echo ""
    read -r -p "Do you want to use this existing configuration? (y/n) [y]: " USE_EXISTING_ENV </dev/tty
    USE_EXISTING_ENV=${USE_EXISTING_ENV:-y}
    
    if [[ "$USE_EXISTING_ENV" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}✓ Using existing .env file.${NC}"
        echo -e "${YELLOW}Skipping configuration step...${NC}"
        echo ""
        SKIP_ENV_CREATION=true
    else
        echo -e "${YELLOW}Will create new .env file during configuration.${NC}"
        echo ""
        SKIP_ENV_CREATION=false
    fi
else
    SKIP_ENV_CREATION=false
fi

# Install qrencode based on OS
install_qrencode() {
    local os
    os=$(detect_os)
    
    case "$os" in
        macos)
            if command -v brew &> /dev/null; then
                echo -e "${YELLOW}Installing qrencode...${NC}"
                if brew install qrencode &> /dev/null; then
                    echo -e "${GREEN}✓ qrencode installed successfully.${NC}"
                    return 0
                else
                    echo -e "${YELLOW}Failed to install qrencode via Homebrew.${NC}"
                    return 1
                fi
            else
                return 1
            fi
            ;;
        ubuntu|debian|raspbian)
            echo -e "${YELLOW}Installing qrencode...${NC}"
            # Skip update to avoid slowness - qrencode is widely available
            if sudo apt-get install -y qrencode &> /dev/null; then
                echo -e "${GREEN}✓ qrencode installed successfully.${NC}"
                return 0
            else
                echo -e "${YELLOW}Failed to install qrencode.${NC}"
                return 1
            fi
            ;;
        fedora|rhel|centos)
            echo -e "${YELLOW}Installing qrencode...${NC}"
            if command -v dnf &> /dev/null; then
                if sudo dnf install -y qrencode &> /dev/null; then
                    echo -e "${GREEN}✓ qrencode installed successfully.${NC}"
                    return 0
                fi
            elif command -v yum &> /dev/null; then
                if sudo yum install -y qrencode &> /dev/null; then
                    echo -e "${GREEN}✓ qrencode installed successfully.${NC}"
                    return 0
                fi
            fi
            echo -e "${YELLOW}Failed to install qrencode.${NC}"
            return 1
            ;;
        arch|manjaro)
            echo -e "${YELLOW}Installing qrencode...${NC}"
            # Use -S instead of -Sy to avoid slow database sync
            if sudo pacman -S --noconfirm qrencode &> /dev/null; then
                echo -e "${GREEN}✓ qrencode installed successfully.${NC}"
                return 0
            else
                echo -e "${YELLOW}Failed to install qrencode.${NC}"
                return 1
            fi
            ;;
        *)
            return 1
            ;;
    esac
}

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
    
    # If qrencode not found, try to install it automatically
    echo -e "${YELLOW}QR code generator not found. Attempting to install...${NC}"
    if install_qrencode && command -v qrencode &> /dev/null; then
        # Installation succeeded, generate QR code
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
    echo -e "${YELLOW}│  Open this URL on your mobile device:       │${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  ${BLUE}${url}${YELLOW}│${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}│  💡 QR code not available on this system    │${NC}"
    echo -e "${YELLOW}│                                              │${NC}"
    echo -e "${YELLOW}└──────────────────────────────────────────────┘${NC}"
    echo ""
}

# Install the rebuild watcher service on macOS for automatic web UI updates
install_rebuild_watcher() {
    local script_dir="$1"
    local watcher_script="${script_dir}/rebuild-watcher.sh"
    
    if [ ! -f "$watcher_script" ]; then
        echo -e "${YELLOW}Warning: rebuild-watcher.sh not found, skipping.${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Installing rebuild watcher service...${NC}"
    echo -e "${BLUE}This enables fully automatic updates from the web interface.${NC}"
    
    # Ensure the script is executable
    chmod +x "$watcher_script"
    
    # Create empty rebuild-needed file for Docker mount
    touch "${script_dir}/.rebuild-needed"
    
    # Run the install command
    if "$watcher_script" --install; then
        echo -e "${GREEN}✓ Rebuild watcher installed successfully${NC}"
        echo -e "${BLUE}  Updates triggered from the web UI will now automatically rebuild containers.${NC}"
        return 0
    else
        echo -e "${YELLOW}Warning: Failed to install rebuild watcher service.${NC}"
        echo -e "${YELLOW}  You can install it manually later with: ./rebuild-watcher.sh --install${NC}"
        return 1
    fi
}

# Create macOS .app bundle for dock shortcut
create_macos_dock_shortcut() {
    local url="$1"
    local app_name="MeticAI"
    local app_path="/Applications/${app_name}.app"
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local icon_source="${script_dir}/resources/MeticAI.icns"
    
    # Validate URL format (basic check for http/https)
    if [[ ! "$url" =~ ^https?:// ]]; then
        echo -e "${RED}Error: Invalid URL format. Skipping dock shortcut creation.${NC}"
        return 1
    fi
    
    echo ""
    echo -e "${YELLOW}Creating macOS application and adding to Dock...${NC}"
    
    # Create application bundle structure (may need sudo for /Applications)
    if ! mkdir -p "${app_path}/Contents/MacOS" 2>/dev/null; then
        # Try with sudo
        sudo mkdir -p "${app_path}/Contents/MacOS"
        sudo mkdir -p "${app_path}/Contents/Resources"
        NEED_SUDO=true
    else
        mkdir -p "${app_path}/Contents/Resources"
        NEED_SUDO=false
    fi
    
    # Copy the icon if it exists
    if [ -f "$icon_source" ]; then
        if [ "$NEED_SUDO" = true ]; then
            sudo cp "$icon_source" "${app_path}/Contents/Resources/MeticAI.icns"
        else
            cp "$icon_source" "${app_path}/Contents/Resources/MeticAI.icns"
        fi
        local icon_key="<key>CFBundleIconFile</key>
    <string>MeticAI</string>"
    else
        local icon_key=""
    fi
    
    # Create the executable script with properly escaped URL
    # Using printf to avoid shell expansion issues
    local script_content="#!/bin/bash
# MeticAI Web App Launcher
open \"${url}\"
"
    if [ "$NEED_SUDO" = true ]; then
        echo "$script_content" | sudo tee "${app_path}/Contents/MacOS/${app_name}" > /dev/null
        sudo chmod +x "${app_path}/Contents/MacOS/${app_name}"
    else
        echo "$script_content" > "${app_path}/Contents/MacOS/${app_name}"
        chmod +x "${app_path}/Contents/MacOS/${app_name}"
    fi
    
    # Create Info.plist with icon reference if available
    local plist_content="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>CFBundleExecutable</key>
    <string>${app_name}</string>
    ${icon_key}
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
</plist>"
    
    if [ "$NEED_SUDO" = true ]; then
        echo "$plist_content" | sudo tee "${app_path}/Contents/Info.plist" > /dev/null
    else
        echo "$plist_content" > "${app_path}/Contents/Info.plist"
    fi
    
    echo -e "${GREEN}✓ Application created at: ${app_path}${NC}"
    
    # Add to Dock using defaults command
    # First check if it's already in the Dock
    local dock_plist="$HOME/Library/Preferences/com.apple.dock.plist"
    if ! /usr/libexec/PlistBuddy -c "Print :persistent-apps" "$dock_plist" 2>/dev/null | grep -q "MeticAI"; then
        # Add the app to the Dock
        defaults write com.apple.dock persistent-apps -array-add "<dict>
            <key>tile-data</key>
            <dict>
                <key>file-data</key>
                <dict>
                    <key>_CFURLString</key>
                    <string>file://${app_path}/</string>
                    <key>_CFURLStringType</key>
                    <integer>15</integer>
                </dict>
            </dict>
        </dict>"
        
        # Restart the Dock to apply changes
        killall Dock
        
        echo -e "${GREEN}✓ MeticAI added to your Dock${NC}"
    else
        echo -e "${YELLOW}  MeticAI is already in your Dock${NC}"
    fi
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

# Detect server IP address (cross-platform)
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

# Portable timeout function that works on both macOS and Linux
# Usage: run_with_timeout <seconds> <command> [args...]
run_with_timeout() {
    local timeout_secs="$1"
    shift
    
    # Try GNU timeout first (works on Linux, available as gtimeout on macOS with coreutils)
    if command -v timeout &>/dev/null; then
        timeout "$timeout_secs" "$@" 2>/dev/null
        return $?
    elif command -v gtimeout &>/dev/null; then
        gtimeout "$timeout_secs" "$@" 2>/dev/null
        return $?
    else
        # Fallback: use perl alarm (available on macOS by default)
        perl -e 'alarm shift; exec @ARGV' "$timeout_secs" "$@" 2>/dev/null
        return $?
    fi
}

# Resolve .local hostname to IP address (cross-platform)
resolve_local_hostname() {
    local hostname="$1"
    local resolved_ip=""
    
    # Ensure hostname ends with .local
    if [[ ! "$hostname" =~ \.local$ ]]; then
        hostname="${hostname}.local"
    fi
    
    # Method 1: macOS dscacheutil (most reliable for .local on macOS)
    if command -v dscacheutil &>/dev/null; then
        resolved_ip=$(dscacheutil -q host -a name "$hostname" 2>/dev/null | grep "^ip_address:" | head -1 | awk '{print $2}')
        if [[ -n "$resolved_ip" ]]; then
            echo "$resolved_ip"
            return 0
        fi
    fi
    
    # Method 2: getent (Linux)
    if command -v getent &>/dev/null; then
        resolved_ip=$(getent hosts "$hostname" 2>/dev/null | awk '{print $1}' | head -1)
        if [[ -n "$resolved_ip" ]]; then
            echo "$resolved_ip"
            return 0
        fi
    fi
    
    # Method 3: ping (works on both, but slower)
    if command -v ping &>/dev/null; then
        # macOS ping uses -t for timeout, Linux uses -W
        if [[ "$OSTYPE" == "darwin"* ]]; then
            resolved_ip=$(ping -c 1 -t 2 "$hostname" 2>/dev/null | grep -oE '\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)' | head -1 | tr -d '()')
        else
            resolved_ip=$(ping -c 1 -W 2 "$hostname" 2>/dev/null | grep -oE '\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)' | head -1 | tr -d '()')
        fi
        if [[ -n "$resolved_ip" ]]; then
            echo "$resolved_ip"
            return 0
        fi
    fi
    
    return 1
}

# Scan network for Meticulous machines
# Returns list of "hostname,ip" pairs
scan_for_meticulous() {
    local devices=()
    
    # Method 1: macOS dns-sd (Bonjour) - most reliable on macOS
    if [[ "$OSTYPE" == "darwin"* ]] && command -v dns-sd &>/dev/null; then
        # Browse for _http._tcp services and capture meticulous devices
        local dns_sd_output
        dns_sd_output=$(run_with_timeout 4 dns-sd -B _http._tcp local 2>/dev/null || true)
        
        # Parse dns-sd output to find meticulous devices
        # Format: "Timestamp  A/R  Flags  if Domain  Service Type  Instance Name"
        if [ -n "$dns_sd_output" ]; then
            while IFS= read -r line; do
                # Look for lines containing "meticulous" (case insensitive)
                if echo "$line" | grep -qi "meticulous"; then
                    # Extract the instance name (last field, may contain spaces)
                    # The format is: timestamp Add/Remove flags interface domain type instancename
                    local instance_name
                    instance_name=$(echo "$line" | awk '{for(i=7;i<=NF;i++) printf "%s", (i>7?" ":"") $i; print ""}')
                    
                    if [[ -n "$instance_name" ]]; then
                        # Resolve the hostname to IP using dscacheutil
                        local resolved_ip
                        resolved_ip=$(resolve_local_hostname "$instance_name")
                        
                        if [[ -n "$resolved_ip" ]]; then
                            devices+=("${instance_name}.local,$resolved_ip")
                        fi
                    fi
                fi
            done <<< "$dns_sd_output"
        fi
    fi
    
    # Method 2: Try avahi-browse (Linux mDNS/Bonjour)
    if command -v avahi-browse &>/dev/null && [[ ${#devices[@]} -eq 0 ]]; then
        # Scan for _http._tcp services with a timeout
        local avahi_results
        avahi_results=$(run_with_timeout 5 avahi-browse -a -t -r -p 2>/dev/null | grep -i meticulous || true)
        
        if [ -n "$avahi_results" ]; then
            # Parse avahi output: format is =;interface;protocol;name;type;domain;hostname;address;port;txt
            while IFS= read -r line; do
                if [[ "$line" == =* ]]; then
                    local hostname=$(echo "$line" | cut -d';' -f7)
                    local ip=$(echo "$line" | cut -d';' -f8)
                    if [[ "$hostname" =~ meticulous ]] && [[ -n "$ip" ]]; then
                        devices+=("$hostname,$ip")
                    fi
                fi
            done <<< "$avahi_results"
        fi
    fi
    
    # Method 3: Try ARP cache (works on both Linux and macOS)
    if [[ ${#devices[@]} -eq 0 ]]; then
        if command -v arp &>/dev/null; then
            # Get all IPs from ARP cache and try to resolve hostnames
            local arp_ips
            arp_ips=$(arp -a 2>/dev/null | grep -oE '\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)' | tr -d '()' || true)
            
            for ip in $arp_ips; do
                # Try to get hostname via various methods
                local hostname=""
                
                # macOS: try dscacheutil reverse lookup
                if [[ "$OSTYPE" == "darwin"* ]] && command -v dscacheutil &>/dev/null; then
                    hostname=$(dscacheutil -q host -a ip_address "$ip" 2>/dev/null | grep "^name:" | head -1 | awk '{print $2}' || true)
                fi
                
                # Linux: try getent
                if [[ -z "$hostname" ]] && command -v getent &>/dev/null; then
                    hostname=$(getent hosts "$ip" 2>/dev/null | awk '{print $2}' || true)
                fi
                
                # Fallback: nslookup
                if [[ -z "$hostname" ]] && command -v nslookup &>/dev/null; then
                    hostname=$(nslookup "$ip" 2>/dev/null | grep 'name =' | awk '{print $4}' | sed 's/\.$//' || true)
                fi
                
                # Fallback: host command
                if [[ -z "$hostname" ]] && command -v host &>/dev/null; then
                    hostname=$(host "$ip" 2>/dev/null | grep 'domain name pointer' | awk '{print $5}' | sed 's/\.$//' || true)
                fi
                
                # Check if hostname contains "meticulous"
                if [[ -n "$hostname" ]] && echo "$hostname" | grep -qi "meticulous"; then
                    devices+=("$hostname,$ip")
                fi
            done
        fi
    fi
    
    # Method 4: Try scanning .local mDNS domain directly
    if [[ ${#devices[@]} -eq 0 ]]; then
        # Try common meticulous hostnames patterns
        for name in meticulous meticulousmodelalmondmilklatte meticulousInspiringCoffeeGeek; do
            local resolved_ip
            resolved_ip=$(resolve_local_hostname "$name")
            
            if [[ -n "$resolved_ip" ]]; then
                devices+=("${name}.local,$resolved_ip")
            fi
        done
    fi
    
    # Return unique devices
    if [ ${#devices[@]} -gt 0 ]; then
        printf '%s\n' "${devices[@]}" | sort -u
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

# Skip configuration if using existing .env file
if [ "$SKIP_ENV_CREATION" = true ]; then
    echo -e "${YELLOW}[2/4] Configuration${NC}"
    echo -e "${GREEN}✓ Using existing .env configuration.${NC}"
    echo ""
else
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

    # --- Meticulous IP (Auto-detect) ---
    echo ""
    echo -e "${YELLOW}Scanning network for Meticulous machines...${NC}"
    
    # Scan for Meticulous devices (using portable while-read loop instead of mapfile for Bash 3.2 compatibility)
    METICULOUS_DEVICES=()
    while IFS= read -r line; do
        METICULOUS_DEVICES+=("$line")
    done < <(scan_for_meticulous)
    
    MET_IP=""
    
    if [ ${#METICULOUS_DEVICES[@]} -gt 0 ]; then
        echo -e "${GREEN}Found ${#METICULOUS_DEVICES[@]} Meticulous device(s):${NC}"
        echo ""
        
        # Present choices if multiple devices found
        if [ ${#METICULOUS_DEVICES[@]} -gt 1 ]; then
            index=1
            for device in "${METICULOUS_DEVICES[@]}"; do
                hostname=$(echo "$device" | cut -d',' -f1)
                ip=$(echo "$device" | cut -d',' -f2)
                echo "  $index) $hostname ($ip)"
                ((index++))
            done
            echo ""
            
            read -r -p "Select device (1-${#METICULOUS_DEVICES[@]}) or press Enter to input manually: " DEVICE_CHOICE </dev/tty
            
            if [[ "$DEVICE_CHOICE" =~ ^[0-9]+$ ]] && [ "$DEVICE_CHOICE" -ge 1 ] && [ "$DEVICE_CHOICE" -le ${#METICULOUS_DEVICES[@]} ]; then
                selected_device="${METICULOUS_DEVICES[$((DEVICE_CHOICE-1))]}"
                MET_IP=$(echo "$selected_device" | cut -d',' -f2)
                selected_hostname=$(echo "$selected_device" | cut -d',' -f1)
                echo -e "${GREEN}✓ Selected: $selected_hostname ($MET_IP)${NC}"
            fi
        else
            # Only one device found
            hostname=$(echo "${METICULOUS_DEVICES[0]}" | cut -d',' -f1)
            ip=$(echo "${METICULOUS_DEVICES[0]}" | cut -d',' -f2)
            echo "  1) $hostname ($ip)"
            echo ""
            
            read -r -p "Use this device? (y/n) [y]: " USE_DETECTED </dev/tty
            USE_DETECTED=${USE_DETECTED:-y}
            
            if [[ "$USE_DETECTED" =~ ^[Yy]$ ]]; then
                MET_IP="$ip"
                echo -e "${GREEN}✓ Using: $hostname ($MET_IP)${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}No Meticulous devices found automatically.${NC}"
    fi
    
    # Fallback to manual input if not detected or not selected
    if [[ -z "$MET_IP" ]]; then
        echo ""
        read -r -p "Enter the IP address of your Meticulous Machine (e.g., 192.168.50.168): " MET_IP </dev/tty
        while [[ -z "$MET_IP" ]]; do
            echo -e "${RED}IP Address cannot be empty.${NC}"
            read -r -p "Enter the IP address of your Meticulous Machine: " MET_IP </dev/tty
        done
    fi

    # --- Raspberry Pi IP (Auto-detect) ---
    echo ""
    DETECTED_IP=$(detect_ip)
    
    if [[ -n "$DETECTED_IP" ]]; then
        echo -e "${GREEN}Detected server IP: $DETECTED_IP${NC}"
        read -r -p "Use this IP address? (y/n) [y]: " USE_DETECTED_IP </dev/tty
        USE_DETECTED_IP=${USE_DETECTED_IP:-y}
        
        if [[ "$USE_DETECTED_IP" =~ ^[Yy]$ ]]; then
            PI_IP="$DETECTED_IP"
        else
            read -r -p "Enter the IP address of this server: " PI_IP </dev/tty
            while [[ -z "$PI_IP" ]]; do
                echo -e "${RED}IP Address cannot be empty.${NC}"
                read -r -p "Enter the IP address of this server: " PI_IP </dev/tty
            done
        fi
    else
        read -r -p "Enter the IP address of this server: " PI_IP </dev/tty
        while [[ -z "$PI_IP" ]]; do
            echo -e "${RED}IP Address cannot be empty.${NC}"
            read -r -p "Enter the IP address of this server: " PI_IP </dev/tty
        done
    fi

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
fi

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

# Load .env values for display and web config generation
if [ -f ".env" ]; then
    # Source the .env file to get the values
    set -a  # automatically export all variables
    source .env
    set +a
    
    # Ensure variables are set (fallback for any issues)
    : ${PI_IP:="localhost"}
    : ${MET_IP:="localhost"}
fi

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
            read -r -p "Would you like to add MeticAI to your Dock? (y/n) [y]: " CREATE_DOCK_SHORTCUT </dev/tty
            CREATE_DOCK_SHORTCUT=${CREATE_DOCK_SHORTCUT:-y}
            
            if [[ "$CREATE_DOCK_SHORTCUT" =~ ^[Yy]$ ]]; then
                create_macos_dock_shortcut "http://$PI_IP:3550"
            else
                echo -e "${YELLOW}Skipping Dock shortcut creation.${NC}"
            fi
        fi
        
        # Install rebuild watcher for automatic web UI updates
        if [[ "${SKIP_REBUILD_WATCHER}" != "true" ]]; then
            echo ""
            install_rebuild_watcher "$(pwd)"
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
