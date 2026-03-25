#!/bin/bash
# uninstall-meticai.sh — Remove MeticAI PWA from a Meticulous machine
set -euo pipefail

INSTALL_DIR="/opt/meticai-web"

echo "╔══════════════════════════════════════════╗"
echo "║   MeticAI PWA Uninstaller               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

if [ ! -d "$INSTALL_DIR" ] && ! ls "${INSTALL_DIR}.bak."* 1>/dev/null 2>&1; then
  echo "MeticAI is not installed."
  exit 0
fi

# Show what will be removed
if [ -d "$INSTALL_DIR" ]; then
  SIZE=$(du -sh "$INSTALL_DIR" | cut -f1)
  echo "  Installation: ${INSTALL_DIR} (${SIZE})"
fi

BACKUP_COUNT=$(ls -d "${INSTALL_DIR}.bak."* 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 0 ]; then
  BACKUP_SIZE=$(du -shc "${INSTALL_DIR}.bak."* 2>/dev/null | tail -1 | cut -f1)
  echo "  Backups:      ${BACKUP_COUNT} (${BACKUP_SIZE})"
fi

echo ""
read -rp "Remove all MeticAI files? [y/N] " confirm
if [ "${confirm,,}" != "y" ]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo "Removing..."
rm -rf "$INSTALL_DIR" "${INSTALL_DIR}.bak."*

FREE_AFTER=$(df -m / | awk 'NR==2{print $4}')
echo ""
echo "Done. Free disk: ${FREE_AFTER} MB"
echo ""
echo "Remember to remove the Tornado route from web_ui.py"
echo "if you previously added it."
