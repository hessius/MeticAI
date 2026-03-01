#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}i${NC} $1"; }
log_success() { echo -e "${GREEN}v${NC} $1"; }
log_warning() { echo -e "${YELLOW}!${NC} $1"; }
log_error() { echo -e "${RED}x${NC} $1"; }

INSTALL_DIR="${INSTALL_DIR:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_URL="https://raw.githubusercontent.com/hessius/MeticAI/${REPO_BRANCH}"

find_install_dir() {
    # Honor INSTALL_DIR env var if set and valid
    if [[ -n "$INSTALL_DIR" && -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/docker-compose.yml" ]]; then
        return 0
    fi

    local candidates=("$PWD" "$HOME/MeticAI" "/opt/meticai")
    for dir in "${candidates[@]}"; do
        if [[ -f "$dir/.env" && -f "$dir/docker-compose.yml" ]]; then
            INSTALL_DIR="$dir"
            return 0
        fi
    done

    log_error "Could not find a MeticAI installation directory."
    log_info "Run this from your install folder or export INSTALL_DIR=/path/to/meticai first."
    exit 1
}

ensure_tools() {
    local missing=0
    for cmd in docker curl; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_error "Required command '$cmd' is missing"
            missing=1
        fi
    done
    if [[ "$missing" -eq 1 ]]; then
        exit 1
    fi
}

load_env_file() {
    # shellcheck disable=SC1090
    source "$INSTALL_DIR/.env"
}

get_compose_files() {
    local compose_from_env
    compose_from_env="${COMPOSE_FILES:-}"
    if [[ -z "$compose_from_env" ]]; then
        echo "-f docker-compose.yml"
    else
        echo "$compose_from_env"
    fi
}

compose_has_file() {
    local compose_string="$1"
    local target_file="$2"
    [[ " $compose_string " == *" -f $target_file "* ]]
}

add_compose_file() {
    local compose_string="$1"
    local target_file="$2"
    if compose_has_file "$compose_string" "$target_file"; then
        echo "$compose_string"
    else
        echo "$compose_string -f $target_file"
    fi
}

remove_compose_file() {
    local compose_string="$1"
    local target_file="$2"
    local result=" $compose_string "
    result="${result// -f $target_file / }"
    result="$(echo "$result" | xargs)"
    if [[ -z "$result" ]]; then
        result="-f docker-compose.yml"
    fi
    echo "$result"
}

update_env_var() {
    local key="$1"
    local value="$2"
    local env_file="$INSTALL_DIR/.env"

    if grep -q "^${key}=" "$env_file"; then
        if [[ "$OSTYPE" == darwin* ]]; then
            sed -i '' "s|^${key}=.*|${key}=${value}|" "$env_file"
        else
            sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
        fi
    else
        echo "${key}=${value}" >> "$env_file"
    fi
}

download_if_missing() {
    local file="$1"
    if [[ -f "$INSTALL_DIR/$file" ]]; then
        return 0
    fi

    log_info "Downloading $file"
    if ! curl -fsSL "$REPO_URL/$file" -o "$INSTALL_DIR/$file"; then
        log_error "Failed to download $file from $REPO_URL"
        return 1
    fi
}

ensure_watchtower_config() {
    if [[ -z "${WATCHTOWER_TOKEN:-}" ]]; then
        local token
        token="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        update_env_var "WATCHTOWER_TOKEN" "$token"
        log_info "Generated WATCHTOWER_TOKEN"
    fi

    if ! grep -q "^WATCHTOWER_HOST_PORT=" "$INSTALL_DIR/.env"; then
        update_env_var "WATCHTOWER_HOST_PORT" "127.0.0.1:18088"
    fi
}

ensure_tailscale_config() {
    if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
        return 0
    fi

    echo ""
    log_info "Get a Tailscale auth key from: https://login.tailscale.com/admin/settings/keys"
    read -r -p "Enter Tailscale auth key (leave blank to cancel): " ts_key < /dev/tty
    if [[ -z "$ts_key" ]]; then
        log_warning "No auth key provided. Tailscale will not be enabled."
        return 1
    fi

    update_env_var "TAILSCALE_AUTHKEY" "$ts_key"
}

restart_stack() {
    local compose_string="$1"
    update_env_var "COMPOSE_FILES" "\"$compose_string\""

    # shellcheck disable=SC2206
    local compose_args=( $compose_string )

    log_info "Applying new compose stack..."
    (
        cd "$INSTALL_DIR"
        docker compose "${compose_args[@]}" up -d --remove-orphans
    )
    log_success "Addon configuration applied"
}

print_menu() {
    local compose_string="$1"

    local wt="[ ]"
    local ts="[ ]"
    local ha="[ ]"

    compose_has_file "$compose_string" "docker-compose.watchtower.yml" && wt="[x]"
    compose_has_file "$compose_string" "docker-compose.tailscale.yml" && ts="[x]"
    compose_has_file "$compose_string" "docker-compose.homeassistant.yml" && ha="[x]"

    echo ""
    echo "MeticAI Addon Manager"
    echo "====================="
    echo "Install dir: $INSTALL_DIR"
    echo ""
    echo "1. $wt Watchtower (auto-updates)"
    echo "2. $ts Tailscale (remote access)"
    echo "3. $ha Home Assistant MQTT"
    echo ""
    echo "r. Refresh status"
    echo "q. Quit"
    echo ""
}

toggle_watchtower() {
    local compose_string="$1"
    if compose_has_file "$compose_string" "docker-compose.watchtower.yml"; then
        echo "$(remove_compose_file "$compose_string" "docker-compose.watchtower.yml")"
    else
        download_if_missing "docker-compose.watchtower.yml"
        ensure_watchtower_config
        echo "$(add_compose_file "$compose_string" "docker-compose.watchtower.yml")"
    fi
}

toggle_tailscale() {
    local compose_string="$1"
    if compose_has_file "$compose_string" "docker-compose.tailscale.yml"; then
        echo "$(remove_compose_file "$compose_string" "docker-compose.tailscale.yml")"
    else
        download_if_missing "docker-compose.tailscale.yml"
        download_if_missing "tailscale-serve.json"
        ensure_tailscale_config || {
            echo "$compose_string"
            return 0
        }
        echo "$(add_compose_file "$compose_string" "docker-compose.tailscale.yml")"
    fi
}

toggle_homeassistant() {
    local compose_string="$1"
    if compose_has_file "$compose_string" "docker-compose.homeassistant.yml"; then
        echo "$(remove_compose_file "$compose_string" "docker-compose.homeassistant.yml")"
    else
        download_if_missing "docker-compose.homeassistant.yml"
        echo "$(add_compose_file "$compose_string" "docker-compose.homeassistant.yml")"
    fi
}

main() {
    ensure_tools
    find_install_dir
    load_env_file

    local compose_string
    compose_string="$(get_compose_files)"

    while true; do
        print_menu "$compose_string"
        read -r -p "Enter number to toggle, 'r' to refresh, or 'q' to quit: " choice < /dev/tty

        case "$choice" in
            1)
                compose_string="$(toggle_watchtower "$compose_string")"
                restart_stack "$compose_string"
                ;;
            2)
                compose_string="$(toggle_tailscale "$compose_string")"
                restart_stack "$compose_string"
                ;;
            3)
                compose_string="$(toggle_homeassistant "$compose_string")"
                restart_stack "$compose_string"
                ;;
            r|R)
                load_env_file
                compose_string="$(get_compose_files)"
                ;;
            q|Q)
                log_success "Done"
                exit 0
                ;;
            *)
                log_warning "Invalid choice"
                ;;
        esac
    done
}

main "$@"
