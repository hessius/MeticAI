#!/bin/bash
set -e

echo "Building MeticAI web application for Docker..."

# Check for required dependencies
echo "Checking dependencies..."

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed."
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check for docker compose (try both 'docker compose' and 'docker-compose')
DOCKER_COMPOSE_CMD=()
DOCKER_COMPOSE_DISPLAY=""
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD=(docker compose)
    DOCKER_COMPOSE_DISPLAY="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD=(docker-compose)
    DOCKER_COMPOSE_DISPLAY="docker-compose"
else
    echo "Error: Docker Compose is not installed."
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✓ All dependencies found"
echo "  Docker: $(docker --version)"
echo "  Docker Compose: $("${DOCKER_COMPOSE_CMD[@]}" version --short 2>/dev/null || echo 'installed')"
echo ""
echo "Note: Bun is not required on the host machine."
echo "The application will be built inside the Docker container using Bun."

# Function to run docker compose with sudo fallback
run_docker_compose() {
    local stderr_output
    stderr_output=$(mktemp)
    
    if "${DOCKER_COMPOSE_CMD[@]}" "$@" 2>"$stderr_output"; then
        rm -f "$stderr_output"
        return 0
    else
        # Check if it's a permission error
        if grep -qi "permission\|denied" "$stderr_output" 2>/dev/null; then
            rm -f "$stderr_output"
            echo "Docker compose requires elevated privileges, trying with sudo..."
            if command -v sudo &> /dev/null; then
                sudo "${DOCKER_COMPOSE_CMD[@]}" "$@"
            else
                echo "Error: sudo is not available and docker compose requires elevated privileges"
                echo "Please run this script with appropriate permissions or install sudo"
                exit 1
            fi
        else
            # Some other error, show it
            cat "$stderr_output" >&2
            rm -f "$stderr_output"
            return 1
        fi
    fi
}

# Build and start Docker containers
echo "Building Docker image and starting containers..."

# Fix: Ensure config.json exists and is a file (not a directory)
# Docker creates a directory when mounting a non-existent file, causing errors
if [ -d "config.json" ]; then
    echo "Removing config.json directory (should be a file)..."
    rm -rf config.json
fi

if [ ! -f "config.json" ]; then
    echo "Creating default config.json (you may need to update the serverUrl)..."
    if [ -f "config.example.json" ]; then
        cp config.example.json config.json
    else
        echo '{"serverUrl": "http://localhost:8000"}' > config.json
    fi
fi

run_docker_compose up -d --build

echo ""
echo "✓ Done! Application is running at http://localhost:3550"
echo ""
echo "IMPORTANT: API Configuration"
echo "----------------------------"
echo "To connect to your backend API, you need to create a config.json file."
echo "Replace 5000 with your actual API port if different."
echo ""
echo "If your API is running on the host machine:"
echo "  Linux:   echo '{\"serverUrl\":\"http://172.17.0.1:5000\"}' > config.json"
echo "  Mac/Win: echo '{\"serverUrl\":\"http://host.docker.internal:5000\"}' > config.json"
echo ""
echo "If your API is at a different location:"
echo "  echo '{\"serverUrl\":\"http://your-api-server:PORT\"}' > config.json"
echo ""
echo "After creating config.json, restart the container:"
echo "  $DOCKER_COMPOSE_DISPLAY restart"
echo ""
echo "To view logs: $DOCKER_COMPOSE_DISPLAY logs -f"
echo "To stop: $DOCKER_COMPOSE_DISPLAY down"
