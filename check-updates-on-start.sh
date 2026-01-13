#!/bin/bash

################################################################################
# MeticAI - Startup Update Check
################################################################################
# 
# This script runs during container startup to check for updates and display
# a notification if updates are available.
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Quick check for updates (non-interactive)
if [ -f "$SCRIPT_DIR/update.sh" ]; then
    # Run update check in background to not slow down startup
    {
        sleep 5  # Wait for services to start
        
        # Run check-only mode
        UPDATE_OUTPUT=$("$SCRIPT_DIR/update.sh" --check-only 2>&1)
        
        # Check if updates are available
        if echo "$UPDATE_OUTPUT" | grep -q "Update available\|⚠\|Not installed"; then
            echo ""
            echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║                                                ║${NC}"
            echo -e "${YELLOW}║   📦 Updates Available for MeticAI!           ║${NC}"
            echo -e "${YELLOW}║                                                ║${NC}"
            echo -e "${YELLOW}║   Run './update.sh' to update all components  ║${NC}"
            echo -e "${YELLOW}║   Or visit http://YOUR_IP:8000/docs            ║${NC}"
            echo -e "${YELLOW}║   and check the /status endpoint              ║${NC}"
            echo -e "${YELLOW}║                                                ║${NC}"
            echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
            echo ""
        fi
    } &
fi
