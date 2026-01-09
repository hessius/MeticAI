#!/bin/bash

################################################################################
# MeticAI - Remote Web Installer
################################################################################
# 
# This script enables remote installation of MeticAI without requiring users
# to manually clone the repository first.
#
# USAGE:
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash
#
# WHAT IT DOES:
#   1. Checks for prerequisites (Git, curl)
#   2. Clones the MeticAI repository
#   3. Executes the local-install.sh script from the cloned repository
#
# REQUIREMENTS:
#   - curl (for downloading the script)
#   - Git (will be installed if missing)
#   - Internet connection
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/hessius/MeticAI.git"
INSTALL_DIR="MeticAI"
BRANCH="main"

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   ☕️ MeticAI Remote Installer 🤖    ${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Detect if script is being run from a local git repository
# If local-install.sh exists in current directory, we're likely in the repo
if [ -f "./local-install.sh" ] && [ -d "./.git" ]; then
    echo -e "${YELLOW}Detected local repository installation.${NC}"
    echo -e "${YELLOW}Running local-install.sh directly...${NC}"
    echo ""
    exec ./local-install.sh
fi

# From here on, we're running in remote/web installation mode
echo -e "${YELLOW}Remote installation mode detected.${NC}"
echo "This will clone the MeticAI repository and run the installer."
echo ""

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS=$ID
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        OS="unknown"
    fi
    echo "$OS"
}

# Install git based on OS
install_git() {
    local os
    os=$(detect_os)
    echo -e "${YELLOW}Installing git...${NC}"
    
    case "$os" in
        ubuntu|debian|raspbian)
            if sudo apt-get update && sudo apt-get install -y git; then
                echo -e "${GREEN}✓ Git installed successfully.${NC}"
            else
                echo -e "${RED}Failed to install git. Please install manually.${NC}"
                exit 1
            fi
            ;;
        fedora|rhel|centos)
            if command -v dnf &> /dev/null; then
                if sudo dnf install -y git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git. Please install manually.${NC}"
                    exit 1
                fi
            elif command -v yum &> /dev/null; then
                if sudo yum install -y git; then
                    echo -e "${GREEN}✓ Git installed successfully.${NC}"
                else
                    echo -e "${RED}Failed to install git. Please install manually.${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}No supported package manager found. Please install git manually.${NC}"
                exit 1
            fi
            ;;
        arch|manjaro)
            if sudo pacman -Sy --noconfirm git; then
                echo -e "${GREEN}✓ Git installed successfully.${NC}"
            else
                echo -e "${RED}Failed to install git. Please install manually.${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Unsupported OS for automatic installation. Please install git manually.${NC}"
            echo "Visit: https://git-scm.com/downloads"
            exit 1
            ;;
    esac
}

# Check for curl (should exist if user ran this script via curl)
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is not installed.${NC}"
    echo "curl is required for remote installation."
    echo "Please install curl and try again."
    exit 1
fi
echo -e "${GREEN}✓ curl found.${NC}"

# Check and install git if needed
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed.${NC}"
    read -r -p "Would you like to install git now? (y/n) [y]: " INSTALL_GIT
    INSTALL_GIT=${INSTALL_GIT:-y}
    
    if [[ "$INSTALL_GIT" =~ ^[Yy]$ ]]; then
        install_git
    else
        echo -e "${RED}Error: git is required. Please install it manually and run this script again.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Git found.${NC}"
fi

echo ""

# Check if directory already exists
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Warning: Directory '$INSTALL_DIR' already exists.${NC}"
    read -r -p "Do you want to remove it and clone fresh? (y/n) [y]: " REMOVE_DIR
    REMOVE_DIR=${REMOVE_DIR:-y}
    
    if [[ "$REMOVE_DIR" =~ ^[Yy]$ ]]; then
        echo "Removing existing directory..."
        rm -rf "$INSTALL_DIR"
    else
        echo -e "${YELLOW}Using existing directory. Attempting to update...${NC}"
        cd "$INSTALL_DIR" || exit 1
        
        # Try to pull latest changes
        if git pull origin "$BRANCH" 2>/dev/null; then
            echo -e "${GREEN}✓ Repository updated.${NC}"
        else
            echo -e "${YELLOW}Could not update repository. Continuing with existing version.${NC}"
        fi
        
        # Execute the local installer
        if [ -f "./local-install.sh" ]; then
            echo ""
            echo -e "${GREEN}Starting local installer...${NC}"
            echo ""
            exec ./local-install.sh
        else
            echo -e "${RED}Error: local-install.sh not found in existing directory.${NC}"
            exit 1
        fi
    fi
fi

# Clone the repository
echo -e "${YELLOW}Cloning MeticAI repository...${NC}"
if git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"; then
    echo -e "${GREEN}✓ Repository cloned successfully.${NC}"
else
    echo -e "${RED}Error: Failed to clone repository.${NC}"
    echo "Please check your internet connection and try again."
    exit 1
fi

# Change to the cloned directory
cd "$INSTALL_DIR" || exit 1

# Verify local-install.sh exists
if [ ! -f "./local-install.sh" ]; then
    echo -e "${RED}Error: local-install.sh not found in cloned repository.${NC}"
    exit 1
fi

# Make sure local-install.sh is executable
chmod +x ./local-install.sh

# Execute the local installer
echo ""
echo -e "${GREEN}Starting local installer...${NC}"
echo ""
exec ./local-install.sh
