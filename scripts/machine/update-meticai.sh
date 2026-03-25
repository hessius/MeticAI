#!/bin/bash
# update-meticai.sh — Update MeticAI PWA to a new version
#
# Usage:
#   ./update-meticai.sh           # Update to latest
#   ./update-meticai.sh v2.4.1    # Update to specific version
set -euo pipefail

METICAI_VERSION="${1:-latest}"
INSTALL_DIR="/opt/meticai-web"

echo "╔══════════════════════════════════════════╗"
echo "║   MeticAI PWA Updater                   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check current installation
if [ -d "$INSTALL_DIR" ]; then
  CURRENT_SIZE=$(du -sh "$INSTALL_DIR" | cut -f1)
  CURRENT_FILES=$(find "$INSTALL_DIR" -type f | wc -l)
  echo "Current: ${CURRENT_FILES} files, ${CURRENT_SIZE}"
else
  echo "No existing installation found."
fi

# Delegate to the install-direct.sh installer (handles backup, download, extract)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../install-direct.sh" "$METICAI_VERSION"
