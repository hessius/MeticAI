#!/bin/bash
# ==============================================================================
# MeticAI Installer
# ==============================================================================
# Simple, single-command installation for MeticAI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
#
# This script:
# 1. Checks/installs Docker if needed
# 2. Creates configuration directory
# 3. Prompts for required settings
# 4. Downloads docker-compose.yml
# 5. Starts MeticAI
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
REPO_URL="https://raw.githubusercontent.com/hessius/MeticAI/main"

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║          ☕ MeticAI Installer         ║"
echo "  ║     Autonomous Espresso AI Agent     ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Linux*)     PLATFORM="linux";;
    Darwin*)    PLATFORM="macos";;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows";;
    *)          PLATFORM="unknown";;
esac

log_info "Detected platform: $PLATFORM"

# Redirect Windows users to the PowerShell installer
if [[ "$PLATFORM" == "windows" ]]; then
    echo ""
    log_warning "This bash installer is not recommended on Windows."
    echo ""
    echo "  For the best Windows experience, use the PowerShell installer:"
    echo ""
    echo "    irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.ps1 -OutFile install.ps1; .\\install.ps1"
    echo ""
    echo "  Or run it directly:"
    echo ""
    echo "    irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.ps1 | iex"
    echo ""
    log_info "Continuing with bash installer anyway..."
    echo ""
fi

# ==============================================================================
# Check/Install Docker
# ==============================================================================

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
            # Add current user to docker group
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
        windows)
            log_error "Please install Docker Desktop from https://docker.com/products/docker-desktop"
            log_info "Then run this script again in PowerShell or Git Bash"
            exit 1
            ;;
        *)
            log_error "Unsupported platform. Please install Docker manually."
            exit 1
            ;;
    esac
}

if ! check_docker; then
    install_docker
fi

# Verify Docker is running
if ! docker info &> /dev/null; then
    log_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

log_success "Docker is running"

# ==============================================================================
# Check for existing installation
# ==============================================================================

if [[ -d "${HOME}/MeticAI" ]] || [[ -f "${INSTALL_DIR}/.env" ]]; then
    log_warning "Existing MeticAI installation detected"
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

# ==============================================================================
# Create installation directory
# ==============================================================================

log_info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ==============================================================================
# Configuration prompts
# ==============================================================================

echo ""
echo "Configuration"
echo "-------------"
echo ""

# Gemini API Key
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

# Meticulous IP
if [[ -z "$METICULOUS_IP" ]]; then
    echo ""
    echo "Enter the IP address or hostname of your Meticulous machine."
    echo "If unsure, try 'meticulous.local' for mDNS discovery."
    read -p "Meticulous IP [meticulous.local]: " METICULOUS_IP < /dev/tty
    METICULOUS_IP=${METICULOUS_IP:-meticulous.local}
fi

# ==============================================================================
# Optional services
# ==============================================================================

COMPOSE_FILES="-f docker-compose.yml"

echo ""
echo "Optional Services"
echo "-----------------"
echo ""

# Tailscale
read -p "Enable Tailscale for remote access? (y/N): " ENABLE_TAILSCALE < /dev/tty
if [[ "$ENABLE_TAILSCALE" =~ ^[Yy]$ ]]; then
    echo "Get an auth key from: https://login.tailscale.com/admin/settings/keys"
    read -p "Tailscale Auth Key: " TAILSCALE_AUTHKEY < /dev/tty
    if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tailscale.yml"
    else
        log_warning "No auth key provided, skipping Tailscale"
    fi
fi

# Watchtower
read -p "Enable Watchtower for automatic updates? (y/N): " ENABLE_WATCHTOWER < /dev/tty
if [[ "$ENABLE_WATCHTOWER" =~ ^[Yy]$ ]]; then
    WATCHTOWER_TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"
    log_success "Watchtower enabled with auto-generated token"
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

# ==============================================================================
# Download compose files
# ==============================================================================

log_info "Downloading Docker Compose files..."

curl -fsSL "${REPO_URL}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${REPO_URL}/docker-compose.tailscale.yml" -o docker-compose.tailscale.yml 2>/dev/null || true
curl -fsSL "${REPO_URL}/docker-compose.watchtower.yml" -o docker-compose.watchtower.yml 2>/dev/null || true
curl -fsSL "${REPO_URL}/tailscale-serve.json" -o tailscale-serve.json 2>/dev/null || true

log_success "Compose files downloaded"

# ==============================================================================
# Generate start/stop convenience scripts
# ==============================================================================

cat > start.sh << STARTEOF
#!/bin/bash
cd "\$(dirname "\$0")"
docker compose ${COMPOSE_FILES} up -d
STARTEOF
chmod +x start.sh

cat > stop.sh << STOPEOF
#!/bin/bash
cd "\$(dirname "\$0")"
docker compose ${COMPOSE_FILES} down
STOPEOF
chmod +x stop.sh

cat > update.sh << UPDATEEOF
#!/bin/bash
cd "\$(dirname "\$0")"
docker compose ${COMPOSE_FILES} pull
docker compose ${COMPOSE_FILES} up -d
UPDATEEOF
chmod +x update.sh

# ==============================================================================
# Pull and start
# ==============================================================================

log_info "Pulling MeticAI image (this may take a few minutes)..."
docker compose ${COMPOSE_FILES} pull

log_info "Starting MeticAI..."
docker compose ${COMPOSE_FILES} up -d

# Wait for services
log_info "Waiting for services to start..."
sleep 5

# ==============================================================================
# Verify installation
# ==============================================================================

if docker compose ps | grep -q "running\|healthy"; then
    log_success "MeticAI is running!"
else
    log_warning "Container may still be starting..."
    echo "Check status with: cd ~/.meticai && docker compose ps"
fi

# Get access URL
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")

echo ""
echo -e "${GREEN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║      ✅ Installation Complete!       ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "  🌐 Web UI:  http://${IP}:3550"
echo "  📚 API:     http://${IP}:3550/api/docs"
echo ""
echo "  Useful commands:"
echo "    View logs:   cd ~/.meticai && docker compose logs -f"
echo "    Restart:     cd ~/.meticai && ./start.sh"
echo "    Stop:        cd ~/.meticai && ./stop.sh"
echo "    Update:      cd ~/.meticai && ./update.sh"
echo ""
echo "  ☕ Enjoy your coffee!"
echo ""
