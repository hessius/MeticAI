#!/bin/bash
# install-meticai.sh — Install MeticAI PWA on a Meticulous machine
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/machine/install-meticai.sh | bash
#   # Or with a specific version:
#   curl -fsSL .../install-meticai.sh | bash -s -- v2.4.0
set -euo pipefail

METICAI_VERSION="${1:-latest}"
INSTALL_DIR="/opt/meticai-web"
MIN_FREE_DISK_MB=20

echo "╔══════════════════════════════════════════╗"
echo "║   MeticAI PWA Installer                  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Pre-flight resource checks ──────────────────────────────────────────────

FREE_DISK_MB=$(df -m / | awk 'NR==2{print $4}')
FREE_RAM_MB=$(free -m | awk '/Mem:/{print $7}')

echo "System resources:"
echo "  Free disk: ${FREE_DISK_MB} MB"
echo "  Free RAM:  ${FREE_RAM_MB} MB"
echo ""

if [ "$FREE_DISK_MB" -lt "$MIN_FREE_DISK_MB" ]; then
  echo "ERROR: Need ≥${MIN_FREE_DISK_MB} MB free disk space (have ${FREE_DISK_MB} MB)"
  exit 1
fi

# ── Resolve download URL ────────────────────────────────────────────────────

if [ "$METICAI_VERSION" = "latest" ]; then
  echo "Resolving latest release..."
  RELEASE_URL=$(curl -fsSL https://api.github.com/repos/hessius/MeticAI/releases/latest \
    | grep "browser_download_url.*meticai-web.tar.gz" | head -1 | cut -d'"' -f4)
  if [ -z "$RELEASE_URL" ]; then
    echo "ERROR: Could not find meticai-web.tar.gz in latest release"
    echo "Check https://github.com/hessius/MeticAI/releases"
    exit 1
  fi
else
  RELEASE_URL="https://github.com/hessius/MeticAI/releases/download/${METICAI_VERSION}/meticai-web.tar.gz"
fi

echo "Downloading: ${RELEASE_URL}"
curl -fsSL "$RELEASE_URL" -o /tmp/meticai-web.tar.gz
DOWNLOAD_SIZE=$(du -m /tmp/meticai-web.tar.gz | cut -f1)
echo "Downloaded: ${DOWNLOAD_SIZE} MB"
echo ""

# ── Backup existing installation ────────────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
  BACKUP="${INSTALL_DIR}.bak.$(date +%s)"
  echo "Backing up existing installation to ${BACKUP}..."
  mv "$INSTALL_DIR" "$BACKUP"

  # Keep only the 2 most recent backups
  # shellcheck disable=SC2012
  ls -dt "${INSTALL_DIR}.bak."* 2>/dev/null | tail -n +3 | xargs rm -rf 2>/dev/null || true
fi

# ── Extract ─────────────────────────────────────────────────────────────────

echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar -xzf /tmp/meticai-web.tar.gz -C "$INSTALL_DIR"
rm /tmp/meticai-web.tar.gz

# ── Report ──────────────────────────────────────────────────────────────────

FILE_COUNT=$(find "$INSTALL_DIR" -type f | wc -l)
INSTALL_SIZE=$(du -sm "$INSTALL_DIR" | cut -f1)
FREE_AFTER=$(df -m / | awk 'NR==2{print $4}')

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Installation Complete                  ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Files:      ${FILE_COUNT}"
echo "  Size:       ${INSTALL_SIZE} MB"
echo "  Free disk:  ${FREE_AFTER} MB (was ${FREE_DISK_MB} MB)"
echo ""
echo "── Next Steps ──────────────────────────────"
echo ""
echo "  Add the Tornado route to meticulous-backend."
echo "  In api/web_ui.py, add:"
echo ""
echo '    METICAI_HANDLER = ['
echo '        (r"/meticai", tornado.web.RedirectHandler, {"url": "/meticai/"}),'
echo '        (r"/meticai/(.*)", tornado.web.StaticFileHandler, {'
echo '            "default_filename": "index.html",'
echo '            "path": "/opt/meticai-web",'
echo '        }),'
echo '    ]'
echo ""
echo "  Then access MeticAI at:"
echo "    http://\$(hostname).local:8080/meticai/"
echo ""
echo "  Note: Your machine hostname may be randomized (e.g. meticulous-abc123.local)."
echo "  Check your machine's actual hostname with: hostname"
echo ""
