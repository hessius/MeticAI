#!/usr/bin/env bats
# ==============================================================================
# Tests for MeticAI v2 install.sh script
# ==============================================================================
# Tests verify:
# - Script syntax and structure
# - Required features and user prompts
# - Docker compose integration
# - Optional services (Tailscale, Watchtower)
# - Convenience script generation
#
# Run with: bats tests/test_install.bats
# ==============================================================================

SCRIPT_PATH="${BATS_TEST_DIRNAME}/../scripts/install.sh"

# ==============================================================================
# Basic script validity
# ==============================================================================

@test "Script file exists and is readable" {
    [ -f "$SCRIPT_PATH" ]
    [ -r "$SCRIPT_PATH" ]
}

@test "Script has correct shebang" {
    run head -n 1 "$SCRIPT_PATH"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "Script is executable" {
    [ -x "$SCRIPT_PATH" ]
}

@test "Script has valid bash syntax" {
    run bash -n "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses set -e for error handling" {
    run grep -q "^set -e" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Banner and user experience
# ==============================================================================

@test "Script displays welcome banner" {
    run grep -q "MeticAI Installer" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays success message" {
    run grep -q "Installation Complete" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "All read commands use /dev/tty for curl|bash compatibility" {
    # Every 'read -p' must redirect from /dev/tty
    local reads_without_tty
    reads_without_tty=$(grep 'read -p' "$SCRIPT_PATH" | grep -v '/dev/tty' | wc -l)
    [ "$reads_without_tty" -eq 0 ]
}

# ==============================================================================
# Platform detection
# ==============================================================================

@test "Script detects Linux platform" {
    run grep -q 'Linux.*linux' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects macOS platform" {
    run grep -q 'Darwin.*macos' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script redirects Windows users to PowerShell installer" {
    run grep -q "PowerShell installer" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Docker checks
# ==============================================================================

@test "Script checks if Docker is installed" {
    run grep -q "command -v docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks if Docker is running" {
    run grep -q "docker info" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script attempts Docker installation on Linux" {
    run grep -q "get.docker.com" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script suggests Docker Desktop on macOS" {
    run grep -q "brew install --cask docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Migration support
# ==============================================================================

@test "Script detects existing installation" {
    run grep -q "Existing MeticAI installation detected" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers migration option" {
    run grep -q "Migrate existing installation" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script downloads migration script when needed" {
    run grep -q "migrate-to-unified.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Configuration
# ==============================================================================

@test "Script installs to ~/.meticai" {
    run grep -q 'INSTALL_DIR="${HOME}/.meticai"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides Gemini API key link" {
    run grep -q "aistudio.google.com/app/apikey" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script requires Gemini API key" {
    run grep -q "API key is required" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script loops until API key is provided" {
    run grep -q "while.*GEMINI_API_KEY" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script prompts for Meticulous IP" {
    run grep -q "METICULOUS_IP" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults Meticulous IP to meticulous.local" {
    run grep -q "meticulous.local" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script creates .env file" {
    run grep -q "cat > .env" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Optional services
# ==============================================================================

@test "Script offers Tailscale setup" {
    run grep -q "Enable Tailscale" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides Tailscale auth key link" {
    run grep -q "login.tailscale.com/admin/settings/keys" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script adds Tailscale compose file when enabled" {
    run grep -q "docker-compose.tailscale.yml" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers Watchtower setup" {
    run grep -q "Enable Watchtower" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script generates Watchtower token" {
    run grep -q "WATCHTOWER_TOKEN" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Docker Compose files
# ==============================================================================

@test "Script downloads tailscale-serve.json" {
    run grep -q "tailscale-serve.json" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses docker compose pull" {
    run grep -q "docker compose.*pull" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses docker compose up -d" {
    run grep -q "docker compose.*up -d" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script does NOT use eval for docker commands" {
    run grep -c 'eval.*docker' "$SCRIPT_PATH"
    [ "$output" = "0" ]
}

# ==============================================================================
# Convenience scripts
# ==============================================================================

@test "Script generates start.sh" {
    run grep -q "cat > start.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script generates stop.sh" {
    run grep -q "cat > stop.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script generates update.sh" {
    run grep -q "cat > update.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script makes convenience scripts executable" {
    local count
    count=$(grep -c "chmod +x" "$SCRIPT_PATH")
    [ "$count" -ge 3 ]
}

# ==============================================================================
# Post-install verification
# ==============================================================================

@test "Script verifies container is running after start" {
    run grep -q "docker compose ps" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays access URL with port 3550" {
    run grep -q "3550" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays API docs URL" {
    run grep -q "/api/docs" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script auto-detects local IP" {
    run grep -q "hostname -I\|ipconfig getifaddr" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Docker Compose file validation
# ==============================================================================

@test "docker-compose.yml exists" {
    [ -f "${BATS_TEST_DIRNAME}/../docker-compose.yml" ]
}

@test "docker-compose.yml defines meticai service" {
    run grep -q "meticai:" "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.yml has memory limit" {
    run grep -q "memory:" "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.yml has log rotation" {
    run grep -q "max-size" "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.yml has health check" {
    run grep -q "healthcheck" "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.yml uses port 3550" {
    run grep -q "3550:3550" "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.yml makes GEMINI_API_KEY optional" {
    run grep -q 'GEMINI_API_KEY:-' "${BATS_TEST_DIRNAME}/../docker-compose.yml"
    [ "$status" -eq 0 ]
}

@test "docker-compose.watchtower.yml binds API to localhost only" {
    run grep -q "127.0.0.1:8080" "${BATS_TEST_DIRNAME}/../docker-compose.watchtower.yml"
    [ "$status" -eq 0 ]
}

@test ".dockerignore exists" {
    [ -f "${BATS_TEST_DIRNAME}/../.dockerignore" ]
}

@test "Dockerfile.unified exists" {
    [ -f "${BATS_TEST_DIRNAME}/../docker/Dockerfile.unified" ]
}

@test "tailscale-serve.json exists" {
    [ -f "${BATS_TEST_DIRNAME}/../tailscale-serve.json" ]
}

# ==============================================================================
# Network discovery (ported from v1)
# ==============================================================================

@test "Script defines scan_for_meticulous function" {
    run grep -q "^scan_for_meticulous()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defines resolve_local_hostname function" {
    run grep -q "^resolve_local_hostname()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defines run_with_timeout function" {
    run grep -q "^run_with_timeout()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defines detect_server_ip function" {
    run grep -q "^detect_server_ip()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Network scan uses dns-sd (macOS Bonjour)" {
    run grep -q "dns-sd -B _http._tcp" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Network scan uses avahi-browse (Linux)" {
    run grep -q "avahi-browse" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Network scan uses ARP cache fallback" {
    run grep -q "arp -a" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Network scan uses direct mDNS name fallback" {
    run grep -q 'for name in meticulous' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Hostname resolution uses dscacheutil (macOS)" {
    run grep -q "dscacheutil -q host" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Hostname resolution uses getent (Linux)" {
    run grep -q "getent hosts" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Hostname resolution uses ping fallback" {
    run grep -q "ping -c 1" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Timeout helper supports GNU timeout" {
    run grep -q 'command -v timeout' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Timeout helper supports gtimeout (Homebrew)" {
    run grep -q 'command -v gtimeout' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Timeout helper supports perl alarm fallback" {
    run grep -q "perl -e 'alarm shift" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Machine selection shows numbered list for multiple devices" {
    run grep -q 'Select device' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Machine selection offers Y/n for single device" {
    run grep -q 'Use this device' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Scanning message is shown before network scan" {
    run grep -q "Scanning network for Meticulous machines" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Non-interactive mode
# ==============================================================================

@test "Script supports METICAI_NON_INTERACTIVE env var" {
    run grep -q 'METICAI_NON_INTERACTIVE' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Non-interactive mode requires GEMINI_API_KEY" {
    run grep -q 'GEMINI_API_KEY is required in non-interactive mode' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Non-interactive mode defaults METICULOUS_IP to meticulous.local" {
    run grep -q 'METICULOUS_IP:-meticulous.local' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Non-interactive mode skips Tailscale prompt" {
    run grep -q 'METICAI_NON_INTERACTIVE.*!=.*true.*Tailscale\|Tailscale.*METICAI_NON_INTERACTIVE' "$SCRIPT_PATH"
    # Check that Tailscale read is inside a non-interactive guard
    local tailscale_line
    tailscale_line=$(grep -n "Enable Tailscale" "$SCRIPT_PATH" | head -1 | cut -d: -f1)
    [ -n "$tailscale_line" ]
    # Verify there's a NON_INTERACTIVE check nearby (within 3 lines before)
    local guard_line
    guard_line=$(awk -v line="$tailscale_line" 'NR>=line-3 && NR<line && /NON_INTERACTIVE/' "$SCRIPT_PATH")
    [ -n "$guard_line" ]
}

@test "Non-interactive mode skips Docker install prompt" {
    run grep -A1 'METICAI_NON_INTERACTIVE.*true' "$SCRIPT_PATH"
    [[ "$output" == *"Docker is not installed"* ]]
}

# ==============================================================================
# Docker Compose availability check
# ==============================================================================

@test "Script checks Docker Compose availability" {
    run grep -q "docker compose version" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script shows fix suggestion when Compose is missing" {
    run grep -q "Docker Compose V2 is required" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Uninstall script generation
# ==============================================================================

@test "Script generates uninstall.sh" {
    run grep -q "cat > uninstall.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Uninstall script offers to remove data volumes" {
    run grep -q "remove data volume" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Uninstall script offers to remove Docker image" {
    run grep -q "remove the MeticAI Docker image" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Uninstall script cleans up macOS app shortcut" {
    run grep -q '/Applications/MeticAI.app' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Uninstall script uses /dev/tty for reads" {
    # Extract the uninstall script block and check reads
    local uninstall_reads
    uninstall_reads=$(sed -n '/cat > uninstall.sh/,/SCRIPT_END/p' "$SCRIPT_PATH" | grep 'read -p' | grep -v '/dev/tty' | wc -l)
    [ "$uninstall_reads" -eq 0 ]
}

# ==============================================================================
# macOS Dock shortcut
# ==============================================================================

@test "Script offers macOS Dock shortcut" {
    run grep -q "Add MeticAI to your macOS Dock" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Dock shortcut creates Info.plist" {
    run grep -q "Info.plist" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Dock shortcut only offered on macOS" {
    run grep -q 'PLATFORM.*macos.*ADD_DOCK\|macos.*Dock' "$SCRIPT_PATH"
    # The macOS Dock section is gated by platform check
    local dock_line
    dock_line=$(grep -n "Add MeticAI to your macOS Dock" "$SCRIPT_PATH" | head -1 | cut -d: -f1)
    [ -n "$dock_line" ]
    local platform_guard
    platform_guard=$(awk -v line="$dock_line" 'NR>=line-3 && NR<line && /macos/' "$SCRIPT_PATH")
    [ -n "$platform_guard" ]
}

# ==============================================================================
# Server IP detection
# ==============================================================================

@test "IP detection uses route/ipconfig on macOS" {
    run grep -q "route -n get default" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "IP detection uses hostname -I on Linux" {
    run grep -q "hostname -I" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "IP detection falls back to localhost" {
    run grep -q 'SERVER_IP:-localhost' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "IP detection tries multiple macOS interfaces" {
    run grep -q "en0 en1 en2" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ==============================================================================
# Post-install test command
# ==============================================================================

@test "Script shows curl test command" {
    run grep -q "curl.*api/version" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script shows docker compose logs command" {
    run grep -q "docker compose logs" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
