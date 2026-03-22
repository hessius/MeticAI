#!/bin/bash
# install-meticai.sh — Install MeticAI PWA on a Meticulous machine
#
# Usage (auto-download from GitHub):
#   python3 -c "import urllib.request,sys; sys.stdout.buffer.write(urllib.request.urlopen(sys.argv[1]).read())" \
#     https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/machine/install-meticai.sh | bash
#
# Usage (manual — build locally and SCP):
#   # On your dev machine:
#   cd apps/web && bun run build:machine
#   tar -czf meticai-web.tar.gz -C dist .
#   scp meticai-web.tar.gz root@<machine-ip>:/tmp/
#   scp scripts/machine/install-meticai.sh root@<machine-ip>:/tmp/
#   # On the machine:
#   bash /tmp/install-meticai.sh --local /tmp/meticai-web.tar.gz
set -euo pipefail

LOCAL_TARBALL=""
METICAI_VERSION="latest"

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL_TARBALL="$2"; shift 2 ;;
    *) METICAI_VERSION="$1"; shift ;;
  esac
done

INSTALL_DIR="/opt/meticai-web"
MIN_FREE_DISK_MB=20

# ── HTTP helper (busybox wget → python3 urllib → curl → wget) ───────────────

fetch() {
  if busybox wget -q -O - "$1" 2>/dev/null; then
    return 0
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.request,sys; sys.stdout.buffer.write(urllib.request.urlopen('$1').read())"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    echo "ERROR: No HTTP tool found (tried busybox wget, python3, curl, wget)"
    exit 1
  fi
}

download() {
  local url="$1" dest="$2"
  if busybox wget -q "$url" -O "$dest" 2>/dev/null; then
    return 0
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.request; urllib.request.urlretrieve('$url', '$dest')"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$dest"
  else
    echo "ERROR: No HTTP tool found."
    exit 1
  fi
}

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

# ── Resolve source tarball ───────────────────────────────────────────────────

if [ -n "$LOCAL_TARBALL" ]; then
  # Local mode — tarball already on disk (SCP'd from dev machine)
  if [ ! -f "$LOCAL_TARBALL" ]; then
    echo "ERROR: Local tarball not found: ${LOCAL_TARBALL}"
    exit 1
  fi
  cp "$LOCAL_TARBALL" /tmp/meticai-web.tar.gz
  echo "Using local tarball: ${LOCAL_TARBALL}"
elif [ "$METICAI_VERSION" = "latest" ]; then
  echo "Resolving latest release..."
  RELEASE_URL=$(fetch https://api.github.com/repos/hessius/MeticAI/releases/latest \
    | grep "browser_download_url.*meticai-web.tar.gz" | head -1 | cut -d'"' -f4)
  if [ -z "$RELEASE_URL" ]; then
    echo "ERROR: Could not find meticai-web.tar.gz in latest release"
    echo "Check https://github.com/hessius/MeticAI/releases"
    exit 1
  fi
  echo "Downloading: ${RELEASE_URL}"
  download "$RELEASE_URL" /tmp/meticai-web.tar.gz
else
  RELEASE_URL="https://github.com/hessius/MeticAI/releases/download/${METICAI_VERSION}/meticai-web.tar.gz"
  echo "Downloading: ${RELEASE_URL}"
  download "$RELEASE_URL" /tmp/meticai-web.tar.gz
fi

DOWNLOAD_SIZE=$(du -m /tmp/meticai-web.tar.gz | cut -f1)
echo "Tarball: ${DOWNLOAD_SIZE} MB"
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
