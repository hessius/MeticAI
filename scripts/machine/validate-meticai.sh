#!/bin/bash
# validate-meticai.sh — Verify MeticAI PWA installation on a Meticulous machine
set -euo pipefail

INSTALL_DIR="/opt/meticai-web"

echo "╔══════════════════════════════════════════╗"
echo "║   MeticAI Installation Validator         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "OK" ]; then
    echo "  ✅ ${desc}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc}: ${result}"
    FAIL=$((FAIL + 1))
  fi
}

# ── Disk ────────────────────────────────────────────────────────────────────

echo "── Disk ──"
df -h / | awk 'NR==2{printf "  Total: %s | Used: %s | Free: %s | Use: %s\n",$2,$3,$4,$5}'
if [ -d "$INSTALL_DIR" ]; then
  INSTALL_SIZE=$(du -sh "$INSTALL_DIR" | cut -f1)
  echo "  MeticAI: ${INSTALL_SIZE}"
else
  echo "  MeticAI: NOT INSTALLED"
fi
echo ""

# ── Memory ──────────────────────────────────────────────────────────────────

echo "── Memory ──"
free -m | awk '/Mem:/{printf "  Total: %s MB | Used: %s MB | Available: %s MB\n",$2,$3,$7}'
echo ""

# ── CPU ─────────────────────────────────────────────────────────────────────

echo "── CPU ──"
LOAD=$(cat /proc/loadavg | awk '{printf "%s %s %s", $1, $2, $3}')
echo "  Load avg (1/5/15 min): ${LOAD}"
echo ""

# ── Files ───────────────────────────────────────────────────────────────────

echo "── Files ──"
if [ -f "${INSTALL_DIR}/index.html" ]; then
  check "index.html exists" "OK"
else
  check "index.html exists" "NOT FOUND"
fi

FILE_COUNT=$(find "$INSTALL_DIR" -type f 2>/dev/null | wc -l)
check "File count (${FILE_COUNT})" "$([ "$FILE_COUNT" -gt 5 ] && echo 'OK' || echo 'Too few files')"

JS_COUNT=$(find "$INSTALL_DIR" -name '*.js' 2>/dev/null | wc -l)
check "JS chunks (${JS_COUNT})" "$([ "$JS_COUNT" -gt 0 ] && echo 'OK' || echo 'No JS files')"

CSS_COUNT=$(find "$INSTALL_DIR" -name '*.css' 2>/dev/null | wc -l)
check "CSS files (${CSS_COUNT})" "$([ "$CSS_COUNT" -gt 0 ] && echo 'OK' || echo 'No CSS files')"

# Check for locale files
LOCALE_COUNT=$(find "$INSTALL_DIR" -path "*/locales/*/translation.json" 2>/dev/null | wc -l)
check "Locale files (${LOCALE_COUNT}/6)" "$([ "$LOCALE_COUNT" -ge 6 ] && echo 'OK' || echo 'Missing locales')"
echo ""

# ── HTTP helper ─────────────────────────────────────────────────────────────

http_status() {
  local url="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import urllib.request, sys
try:
    r = urllib.request.urlopen('$url', timeout=5)
    print(r.status)
except Exception:
    print('000')
" 2>/dev/null
  elif command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000"
  elif busybox wget --spider -q -T 5 "$url" 2>/dev/null; then
    echo "200"
  else
    echo "000"
  fi
}

# ── Routes ──────────────────────────────────────────────────────────────────

echo "── Routes ──"
HTTP_CODE=$(http_status http://localhost:8080/meticai/)
check "GET /meticai/ (HTTP ${HTTP_CODE})" "$([ "$HTTP_CODE" = "200" ] && echo 'OK' || echo 'Route not configured')"

# ── Machine API ─────────────────────────────────────────────────────────────

API_CODE=$(http_status http://localhost:8080/api/v1/profile)
check "Machine API (HTTP ${API_CODE})" "$([ "$API_CODE" = "200" ] && echo 'OK' || echo 'API not responding')"
echo ""

# ── Summary ─────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "══════════════════════════════════════════"

exit "$FAIL"
