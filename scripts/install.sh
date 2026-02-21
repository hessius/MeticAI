#!/bin/bash
# ==============================================================================
# MeticAI Installer (v2)
# ==============================================================================
# Single-command installation for MeticAI.
#
# Usage (interactive):
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
#
# Usage (non-interactive):
#   GEMINI_API_KEY=xxx METICULOUS_IP=192.168.1.50 METICAI_NON_INTERACTIVE=true \
#     curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
#
# Environment variables (pre-set to skip prompts):
#   GEMINI_API_KEY          - Google Gemini API key (required)
#   METICULOUS_IP           - Meticulous machine IP or hostname
#   METICAI_NON_INTERACTIVE - Set to "true" to skip all prompts
#   ENABLE_TAILSCALE        - Set to "y" to enable Tailscale
#   TAILSCALE_AUTHKEY       - Tailscale auth key
#   ENABLE_WATCHTOWER       - Set to "y" to enable Watchtower
#   REPO_BRANCH             - GitHub branch to download from (default: main)
#
# Branch testing:
#   REPO_BRANCH=version/2.0.0 bash <(curl -fsSL \
#     https://raw.githubusercontent.com/hessius/MeticAI/version/2.0.0/scripts/install.sh)
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${HOME}/.meticai"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_URL="https://raw.githubusercontent.com/hessius/MeticAI/${REPO_BRANCH}"

# ==============================================================================
# Logging helpers
# ==============================================================================

log_info() { echo -e "${BLUE}i${NC} $1"; }
log_success() { echo -e "${GREEN}v${NC} $1"; }
log_warning() { echo -e "${YELLOW}!${NC} $1"; }
log_error() { echo -e "${RED}x${NC} $1"; }

# ==============================================================================
# Banner
# ==============================================================================

echo ""
echo -e "${CYAN}"
echo "  +======================================+"
echo "  |          MeticAI Installer           |"
echo "  |     Autonomous Espresso AI Agent     |"
echo "  +======================================+"
echo -e "${NC}"
echo ""

# ==============================================================================
# Platform detection
# ==============================================================================

OS="$(uname -s)"
case "$OS" in
    Linux*)     PLATFORM="linux";;
    Darwin*)    PLATFORM="macos";;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows";;
    *)          PLATFORM="unknown";;
esac

log_info "Detected platform: $PLATFORM"

if [[ "$PLATFORM" == "windows" ]]; then
    echo ""
    log_warning "This bash installer is not recommended on Windows."
    echo ""
    echo "  For the best Windows experience, use the PowerShell installer:"
    echo ""
    echo "    irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.ps1 -OutFile install.ps1; .\install.ps1"
    echo ""
    log_info "Continuing with bash installer anyway..."
    echo ""
fi

# ==============================================================================
# Non-interactive mode validation
# ==============================================================================

if [[ "$METICAI_NON_INTERACTIVE" == "true" ]]; then
    log_info "Running in non-interactive mode"
    if [[ -z "$GEMINI_API_KEY" ]]; then
        log_error "GEMINI_API_KEY is required in non-interactive mode"
        exit 1
    fi
    METICULOUS_IP="${METICULOUS_IP:-meticulous.local}"
fi

# ==============================================================================
# Portable timeout helper (for network scanning)
# ==============================================================================

run_with_timeout() {
    local timeout_secs="$1"
    shift

    if command -v timeout &>/dev/null; then
        timeout "$timeout_secs" "$@" 2>/dev/null
        return $?
    fi

    if command -v gtimeout &>/dev/null; then
        gtimeout "$timeout_secs" "$@" 2>/dev/null
        return $?
    fi

    perl -e 'alarm shift; exec @ARGV' "$timeout_secs" "$@" 2>/dev/null
    return $?
}

# ==============================================================================
# Network discovery: resolve .local hostnames
# ==============================================================================

resolve_local_hostname() {
    local hostname="$1"
    local resolved_ip=""

    if [[ ! "$hostname" =~ \.local$ ]]; then
        hostname="${hostname}.local"
    fi

    # Method 1: macOS dscacheutil
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

    # Method 3: ping fallback
    if command -v ping &>/dev/null; then
        if [[ "$PLATFORM" == "macos" ]]; then
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

# ==============================================================================
# Network discovery: scan for Meticulous machines
# ==============================================================================

scan_for_meticulous() {
    local devices=()

    # Method 1: macOS dns-sd (Bonjour) - most reliable on macOS
    if [[ "$PLATFORM" == "macos" ]] && command -v dns-sd &>/dev/null; then
        local dns_sd_output
        dns_sd_output=$(run_with_timeout 4 dns-sd -B _http._tcp local 2>/dev/null || true)

        if [[ -n "$dns_sd_output" ]]; then
            while IFS= read -r line; do
                if echo "$line" | grep -qi "meticulous"; then
                    local instance_name
                    instance_name=$(echo "$line" | awk '{for(i=7;i<=NF;i++) printf "%s", (i>7?" ":"") $i; print ""}')
                    if [[ -n "$instance_name" ]]; then
                        local resolved_ip
                        resolved_ip=$(resolve_local_hostname "$instance_name")
                        if [[ -n "$resolved_ip" ]]; then
                            devices+=("${instance_name}.local,${resolved_ip}")
                        fi
                    fi
                fi
            done <<< "$dns_sd_output"
        fi
    fi

    # Method 2: avahi-browse (Linux mDNS/Bonjour)
    if command -v avahi-browse &>/dev/null && [[ ${#devices[@]} -eq 0 ]]; then
        local avahi_results
        avahi_results=$(run_with_timeout 5 avahi-browse -a -t -r -p 2>/dev/null | grep -i meticulous || true)

        if [[ -n "$avahi_results" ]]; then
            while IFS= read -r line; do
                if [[ "$line" == =* ]]; then
                    local av_hostname av_ip
                    av_hostname=$(echo "$line" | cut -d';' -f7)
                    av_ip=$(echo "$line" | cut -d';' -f8)
                    if [[ "$av_hostname" =~ meticulous ]] && [[ -n "$av_ip" ]]; then
                        devices+=("${av_hostname},${av_ip}")
                    fi
                fi
            done <<< "$avahi_results"
        fi
    fi

    # Method 3: ARP cache - reverse-resolve to find "meticulous" hostnames
    if [[ ${#devices[@]} -eq 0 ]] && command -v arp &>/dev/null; then
        local arp_ips
        arp_ips=$(arp -a 2>/dev/null | grep -oE '\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)' | tr -d '()' || true)

        for ip in $arp_ips; do
            local hostname=""

            if [[ "$PLATFORM" == "macos" ]] && command -v dscacheutil &>/dev/null; then
                hostname=$(dscacheutil -q host -a ip_address "$ip" 2>/dev/null | grep "^name:" | head -1 | awk '{print $2}' || true)
            fi

            if [[ -z "$hostname" ]] && command -v getent &>/dev/null; then
                hostname=$(getent hosts "$ip" 2>/dev/null | awk '{print $2}' || true)
            fi

            if [[ -n "$hostname" ]] && echo "$hostname" | grep -qi "meticulous"; then
                devices+=("${hostname},${ip}")
            fi
        done
    fi

    # Method 4: Try common .local mDNS names directly
    if [[ ${#devices[@]} -eq 0 ]]; then
        for name in meticulous; do
            local resolved_ip
            resolved_ip=$(resolve_local_hostname "$name" 2>/dev/null || true)
            if [[ -n "$resolved_ip" ]]; then
                devices+=("${name}.local,${resolved_ip}")
            fi
        done
    fi

    # Return unique devices
    if [[ ${#devices[@]} -gt 0 ]]; then
        printf '%s\n' "${devices[@]}" | sort -u
    fi
}

# ==============================================================================
# Server IP detection
# ==============================================================================

detect_server_ip() {
    local detected_ip=""

    if [[ "$PLATFORM" == "macos" ]]; then
        # macOS: get the default route interface, then its IP
        local iface
        iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}')
        if [[ -n "$iface" ]]; then
            detected_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
        fi
        # Fallback: try en0-en4
        if [[ -z "$detected_ip" ]]; then
            for iface in en0 en1 en2 en3 en4; do
                detected_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
                if [[ -n "$detected_ip" ]]; then break; fi
            done
        fi
    else
        # Linux: hostname -I
        detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    echo "$detected_ip"
}

# ==============================================================================
# [1/4] Check/Install Docker
# ==============================================================================

echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"
echo ""

check_docker() {
    if command -v docker &> /dev/null; then
        log_success "Docker is installed"
        return 0
    fi
    return 1
}

install_docker() {
    log_info "Installing Docker..."

    case "$PLATFORM" in
        linux)
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker "$USER" 2>/dev/null || true
            log_warning "You may need to log out and back in for Docker permissions"
            ;;
        macos)
            if command -v brew &> /dev/null; then
                brew install --cask docker
                log_warning "Please start Docker Desktop manually, then run this script again"
                exit 0
            else
                log_error "Please install Docker Desktop from https://docker.com/products/docker-desktop"
                exit 1
            fi
            ;;
        *)
            log_error "Unsupported platform. Please install Docker manually."
            exit 1
            ;;
    esac
}

if ! check_docker; then
    if [[ "$METICAI_NON_INTERACTIVE" == "true" ]]; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    install_docker
fi

# Verify Docker is running
if ! docker info &> /dev/null; then
    log_error "Docker is not running. Please start Docker and try again."
    exit 1
fi
log_success "Docker is running"

# Verify Docker Compose is available
if ! docker compose version &> /dev/null; then
    log_error "Docker Compose is not available."
    echo ""
    echo "  Docker Compose V2 is required. It usually comes bundled with Docker."
    echo "  If you installed Docker via 'apt install docker.io', try instead:"
    echo ""
    echo "    curl -fsSL https://get.docker.com | sh"
    echo ""
    exit 1
fi
log_success "Docker Compose is available"

# ==============================================================================
# Check for existing installation
# ==============================================================================

if [[ -d "${HOME}/MeticAI" ]] || [[ -f "${INSTALL_DIR}/.env" ]]; then
    log_warning "Existing MeticAI installation detected"

    if [[ "$METICAI_NON_INTERACTIVE" == "true" ]]; then
        log_info "Non-interactive mode: proceeding with fresh install"
    else
        echo ""
        echo "Would you like to:"
        echo "  1) Migrate existing installation to v2.0 (recommended)"
        echo "  2) Fresh install (will override existing config)"
        echo "  3) Cancel"
        echo ""
        read -p "Choice [1]: " CHOICE < /dev/tty
        CHOICE=${CHOICE:-1}

        case "$CHOICE" in
            1)
                log_info "Running migration script..."
                curl -fsSL "${REPO_URL}/scripts/migrate-to-unified.sh" | bash
                exit $?
                ;;
            2)
                log_info "Proceeding with fresh install..."
                ;;
            *)
                log_info "Cancelled"
                exit 0
                ;;
        esac
    fi
fi

# ==============================================================================
# Create installation directory
# ==============================================================================

log_info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ==============================================================================
# Download compose files (early, so we know what's available)
# ==============================================================================

log_info "Downloading Docker Compose files..."

curl -fsSL "${REPO_URL}/docker-compose.yml" -o docker-compose.yml
HAS_TAILSCALE_COMPOSE=false
if curl -fsSL "${REPO_URL}/docker-compose.tailscale.yml" -o docker-compose.tailscale.yml 2>/dev/null; then
    HAS_TAILSCALE_COMPOSE=true
fi
HAS_WATCHTOWER_COMPOSE=false
if curl -fsSL "${REPO_URL}/docker-compose.watchtower.yml" -o docker-compose.watchtower.yml 2>/dev/null; then
    HAS_WATCHTOWER_COMPOSE=true
fi
curl -fsSL "${REPO_URL}/tailscale-serve.json" -o tailscale-serve.json 2>/dev/null || true

log_success "Compose files downloaded"

# ==============================================================================
# [2/4] Configuration
# ==============================================================================

echo ""
echo -e "${YELLOW}[2/4] Configuration${NC}"
echo ""

# --- Gemini API Key ---
if [[ -z "$GEMINI_API_KEY" ]]; then
    echo "Get your API key from: https://aistudio.google.com/app/apikey"
    while [[ -z "$GEMINI_API_KEY" ]]; do
        read -p "Gemini API Key: " GEMINI_API_KEY < /dev/tty
        if [[ -z "$GEMINI_API_KEY" ]]; then
            log_error "API key is required. Get one from https://aistudio.google.com/app/apikey"
        fi
    done
    log_success "API key configured"
fi

# --- Meticulous Machine Discovery ---
if [[ -z "$METICULOUS_IP" ]]; then
    echo ""
    echo -e "${YELLOW}Scanning network for Meticulous machines...${NC}"

    METICULOUS_DEVICES=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && METICULOUS_DEVICES+=("$line")
    done < <(scan_for_meticulous)

    if [[ ${#METICULOUS_DEVICES[@]} -gt 0 ]]; then
        echo -e "${GREEN}Found ${#METICULOUS_DEVICES[@]} Meticulous device(s):${NC}"
        echo ""

        if [[ ${#METICULOUS_DEVICES[@]} -gt 1 ]]; then
            # Multiple devices - numbered list
            index=1
            for device in "${METICULOUS_DEVICES[@]}"; do
                d_hostname=$(echo "$device" | cut -d',' -f1)
                d_ip=$(echo "$device" | cut -d',' -f2)
                echo "  $index) $d_hostname ($d_ip)"
                ((index++))
            done
            echo ""

            read -p "Select device (1-${#METICULOUS_DEVICES[@]}) or Enter for manual input: " DEVICE_CHOICE < /dev/tty

            if [[ "$DEVICE_CHOICE" =~ ^[0-9]+$ ]] && [[ "$DEVICE_CHOICE" -ge 1 ]] && [[ "$DEVICE_CHOICE" -le ${#METICULOUS_DEVICES[@]} ]]; then
                selected_device="${METICULOUS_DEVICES[$((DEVICE_CHOICE-1))]}"
                METICULOUS_IP=$(echo "$selected_device" | cut -d',' -f2)
                selected_hostname=$(echo "$selected_device" | cut -d',' -f1)
                log_success "Selected: $selected_hostname ($METICULOUS_IP)"
            fi
        else
            # Single device found
            d_hostname=$(echo "${METICULOUS_DEVICES[0]}" | cut -d',' -f1)
            d_ip=$(echo "${METICULOUS_DEVICES[0]}" | cut -d',' -f2)
            echo "  -> $d_hostname ($d_ip)"
            echo ""

            read -p "Use this device? (Y/n): " USE_DETECTED < /dev/tty
            USE_DETECTED=${USE_DETECTED:-y}

            if [[ "$USE_DETECTED" =~ ^[Yy]$ ]]; then
                METICULOUS_IP="$d_ip"
                log_success "Using: $d_hostname ($METICULOUS_IP)"
            fi
        fi
    else
        log_info "No Meticulous devices found automatically"
    fi

    # Fallback to manual input
    if [[ -z "$METICULOUS_IP" ]]; then
        echo ""
        echo "Enter the IP address or hostname of your Meticulous machine."
        echo "Tip: try 'meticulous.local' if your network supports mDNS."
        read -p "Meticulous IP [meticulous.local]: " METICULOUS_IP < /dev/tty
        METICULOUS_IP=${METICULOUS_IP:-meticulous.local}
    fi
fi
log_success "Meticulous machine: $METICULOUS_IP"

# ==============================================================================
# [3/4] Optional services
# ==============================================================================

COMPOSE_FILES="-f docker-compose.yml"

echo ""
echo -e "${YELLOW}[3/4] Optional services${NC}"
echo ""

if [[ "$HAS_TAILSCALE_COMPOSE" == "true" ]]; then
    if [[ "$METICAI_NON_INTERACTIVE" != "true" ]]; then
        read -p "Enable Tailscale for remote access? (y/N): " ENABLE_TAILSCALE < /dev/tty
    fi
    if [[ "$ENABLE_TAILSCALE" =~ ^[Yy]$ ]]; then
        if [[ -z "$TAILSCALE_AUTHKEY" ]]; then
            echo "Get an auth key from: https://login.tailscale.com/admin/settings/keys"
            read -p "Tailscale Auth Key: " TAILSCALE_AUTHKEY < /dev/tty
        fi
        if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
            COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tailscale.yml"
            log_success "Tailscale enabled"
        else
            log_warning "No auth key provided, skipping Tailscale"
        fi
    else
        log_info "Tailscale: skipped"
    fi
else
    log_info "Tailscale: not available (compose file not found)"
fi

if [[ "$HAS_WATCHTOWER_COMPOSE" == "true" ]]; then
    if [[ "$METICAI_NON_INTERACTIVE" != "true" ]]; then
        read -p "Enable Watchtower for automatic updates? (y/N): " ENABLE_WATCHTOWER < /dev/tty
    fi
    if [[ "$ENABLE_WATCHTOWER" =~ ^[Yy]$ ]]; then
        WATCHTOWER_TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"
        log_success "Watchtower enabled (auto-update)"
    else
        log_info "Watchtower: skipped"
    fi
else
    log_info "Watchtower: not available (compose file not found)"
fi

# ==============================================================================
# Write configuration
# ==============================================================================

log_info "Writing configuration..."

cat > .env << EOF
# MeticAI Configuration
# Generated on $(date)

# Required
GEMINI_API_KEY=${GEMINI_API_KEY}
METICULOUS_IP=${METICULOUS_IP}

# Compose files to load
COMPOSE_FILES="${COMPOSE_FILES}"
EOF

# Add optional config
if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
    echo "TAILSCALE_AUTHKEY=${TAILSCALE_AUTHKEY}" >> .env
fi

if [[ -n "$WATCHTOWER_TOKEN" ]]; then
    echo "WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}" >> .env
fi

log_success "Configuration saved to ${INSTALL_DIR}/.env"

# Verify all referenced compose files exist before proceeding
for cf in $COMPOSE_FILES; do
    if [[ "$cf" == "-f" ]]; then continue; fi
    if [[ ! -f "$cf" ]]; then
        log_error "Required compose file missing: $cf"
        log_error "Downloads may have failed. Check your network and try again."
        exit 1
    fi
done

# ==============================================================================
# Generate convenience scripts
# ==============================================================================

generate_start_script() {
    cat > start.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
SCRIPT_END
    chmod +x start.sh
}

generate_stop_script() {
    cat > stop.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down
SCRIPT_END
    chmod +x stop.sh
}

generate_update_script() {
    cat > update.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo "Pulling latest MeticAI image..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} pull
echo "Restarting..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
echo "Updated!"
SCRIPT_END
    chmod +x update.sh
}

generate_uninstall_script() {
    cat > uninstall.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo ""
echo "  MeticAI Uninstaller"
echo "  ==================="
echo ""
INSTALL_PATH="$(pwd)"
echo "This will stop MeticAI and remove all files from ${INSTALL_PATH}."
echo "Your data (profiles, history) is stored in a Docker volume and will be preserved."
echo ""
read -p "Are you sure? (y/N): " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Stopping containers..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down 2>/dev/null || true

read -p "Also remove data volume (profiles, history, settings)? (y/N): " REMOVE_DATA < /dev/tty
if [[ "$REMOVE_DATA" =~ ^[Yy]$ ]]; then
    echo "Removing data volumes..."
    docker volume rm meticai-data 2>/dev/null || true
    docker volume rm mosquitto-data 2>/dev/null || true
    docker volume rm meticai-tailscale-state 2>/dev/null || true
    echo "Data volumes removed"
fi

read -p "Also remove the MeticAI Docker image? (y/N): " REMOVE_IMAGE < /dev/tty
if [[ "$REMOVE_IMAGE" =~ ^[Yy]$ ]]; then
    docker rmi ghcr.io/hessius/meticai:latest 2>/dev/null || true
    echo "Image removed"
fi

# Remove macOS Dock shortcut if it exists
if [[ -d "/Applications/MeticAI.app" ]]; then
    echo "Removing macOS app shortcut..."
    rm -rf "/Applications/MeticAI.app" 2>/dev/null || sudo rm -rf "/Applications/MeticAI.app" 2>/dev/null || true
fi

echo ""
echo "MeticAI has been uninstalled."
echo ""
echo "To remove the installation directory:"
echo "  rm -rf ${INSTALL_PATH}"
echo ""
SCRIPT_END
    chmod +x uninstall.sh
}

generate_start_script
generate_stop_script
generate_update_script
generate_uninstall_script

log_success "Generated: start.sh, stop.sh, update.sh, uninstall.sh"

# ==============================================================================
# [4/4] Pull and start
# ==============================================================================

echo ""
echo -e "${YELLOW}[4/4] Starting MeticAI...${NC}"
echo ""

log_info "Pulling MeticAI image (this may take a few minutes)..."
docker compose ${COMPOSE_FILES} pull

log_info "Starting MeticAI..."
docker compose ${COMPOSE_FILES} up -d

# Wait for services
log_info "Waiting for services to start..."
sleep 8

# ==============================================================================
# Verify installation
# ==============================================================================

if docker compose ps 2>/dev/null | grep -q "running\|healthy"; then
    log_success "MeticAI is running!"
else
    log_warning "Container may still be starting..."
    echo "  Check status with: cd ~/.meticai && docker compose ps"
fi

# ==============================================================================
# macOS Dock shortcut (optional)
# ==============================================================================

SERVER_IP=$(detect_server_ip)
SERVER_IP=${SERVER_IP:-localhost}

if [[ "$PLATFORM" == "macos" ]] && [[ "$METICAI_NON_INTERACTIVE" != "true" ]]; then
    echo ""
    read -p "Add MeticAI to your macOS Dock? (y/N): " ADD_DOCK < /dev/tty
    if [[ "$ADD_DOCK" =~ ^[Yy]$ ]]; then
        APP_PATH="/Applications/MeticAI.app"
        APP_URL="http://${SERVER_IP}:3550"

        mkdir -p "${APP_PATH}/Contents/MacOS"
        mkdir -p "${APP_PATH}/Contents/Resources"

        cat > "${APP_PATH}/Contents/MacOS/MeticAI" << APPEOF
#!/bin/bash
open "${APP_URL}"
APPEOF
        chmod +x "${APP_PATH}/Contents/MacOS/MeticAI"

        cat > "${APP_PATH}/Contents/Info.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>MeticAI</string>
    <key>CFBundleIdentifier</key>
    <string>com.meticai.app</string>
    <key>CFBundleName</key>
    <string>MeticAI</string>
    <key>CFBundleVersion</key>
    <string>2.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
</dict>
</plist>
PLISTEOF

        curl -fsSL "${REPO_URL}/resources/Favicons/android-chrome-512x512.png" -o "${APP_PATH}/Contents/Resources/icon.png" 2>/dev/null || true

        log_success "MeticAI.app created in /Applications"
        log_info "You can drag it to your Dock from the Applications folder"
    fi
fi

# ==============================================================================
# Success banner
# ==============================================================================

echo ""
echo -e "${GREEN}"
echo "  +======================================+"
echo "  |      Installation Complete!          |"
echo "  +======================================+"
echo -e "${NC}"
echo ""
echo "  Web UI:  http://${SERVER_IP}:3550"
echo "  API:     http://${SERVER_IP}:3550/api/docs"
echo ""
echo "  Test it:"
echo "    curl -sf http://${SERVER_IP}:3550/api/version"
echo ""
echo "  Useful commands:"
echo "    cd ~/.meticai"
echo "    ./start.sh        Start MeticAI"
echo "    ./stop.sh         Stop MeticAI"
echo "    ./update.sh       Pull latest image & restart"
echo "    ./uninstall.sh    Remove MeticAI"
echo "    docker compose logs -f   View live logs"
echo ""
echo "  Enjoy your coffee!"
echo ""
