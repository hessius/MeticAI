#!/usr/bin/env bats
# Comprehensive tests for local-install.sh script
#
# Tests cover:
# - Prerequisite checks (git, docker)
# - Environment file creation
# - Input validation
# - Error handling
# - Git clone operations
# - Docker compose commands

# Setup and teardown functions
setup() {
    # Create a temporary directory for test files
    export TEST_DIR="$(mktemp -d)"
    export ORIGINAL_DIR="$(pwd)"
    
    # Copy the script to test directory
    cp local-install.sh "$TEST_DIR/"
    cd "$TEST_DIR"
    
    # Mock commands for testing
    export PATH="$TEST_DIR/mocks:$PATH"
    mkdir -p "$TEST_DIR/mocks"
}

teardown() {
    # Clean up test directory
    cd "$ORIGINAL_DIR"
    rm -rf "$TEST_DIR"
}

# Helper function to create mock commands
create_mock_command() {
    local cmd_name="$1"
    local exit_code="${2:-0}"
    local output="${3:-}"
    
    cat > "$TEST_DIR/mocks/$cmd_name" <<EOF
#!/bin/bash
echo "$output"
exit $exit_code
EOF
    chmod +x "$TEST_DIR/mocks/$cmd_name"
}

# Tests for prerequisite checking
@test "Script exits with error if git is not installed" {
    # Remove git from path
    create_mock_command "git" 127 ""
    create_mock_command "docker" 0 ""
    
    run bash -c 'echo "" | ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Error: git is not installed"* ]]
}

@test "Script exits with error if docker is not installed" {
    create_mock_command "git" 0 "git version 2.30.0"
    create_mock_command "docker" 127 ""
    
    run bash -c 'echo "" | ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Error: docker is not installed"* ]]
}

@test "Script continues when both git and docker are installed" {
    create_mock_command "git" 0 "git version 2.30.0"
    create_mock_command "docker" 0 "Docker version 20.10.0"
    create_mock_command "hostname" 0 "192.168.1.100"
    
    # Provide test inputs
    run bash -c 'echo -e "test_api_key\n192.168.1.50\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Git and Docker found"* ]]
}

# Tests for .env file creation
@test "Script creates .env file with correct format" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    # Mock inputs: API key, Meticulous IP, PI IP (accept default), skip clone, skip docker
    run bash -c 'echo -e "my_api_key_123\n192.168.50.168\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    # Check if .env file was created
    [ -f .env ]
    
    # Verify contents
    grep -q "GEMINI_API_KEY=my_api_key_123" .env
    grep -q "METICULOUS_IP=192.168.50.168" .env
    grep -q "PI_IP=192.168.1.100" .env
}

@test "Script rejects empty API key" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    
    # Try to submit empty API key first, then provide valid one
    run bash -c 'echo -e "\nvalid_key\n192.168.1.1\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"API Key cannot be empty"* ]]
}

@test "Script rejects empty Meticulous IP" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    # Provide valid API key, empty IP, then valid IP
    run bash -c 'echo -e "test_key\n\n192.168.1.50\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"IP Address cannot be empty"* ]]
}

@test "Script uses default PI IP when user presses enter" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [ -f .env ]
    grep -q "PI_IP=192.168.1.100" .env
}

@test "Script accepts custom PI IP" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n192.168.1.200\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [ -f .env ]
    grep -q "PI_IP=192.168.1.200" .env
}

# Tests for git clone operations
@test "Script clones meticulous-source if directory doesn't exist" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n\nn" | timeout 10 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Cloning Meticulous MCP fork"* ]]
}

@test "Script prompts for re-clone if directory exists" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    # Create existing directory
    mkdir -p meticulous-source
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"already exists"* ]]
    [[ "$output" == *"delete it and re-clone"* ]]
}

@test "Script skips clone when user chooses not to delete existing directory" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    mkdir -p meticulous-source
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Skipping clone"* ]]
}

@test "Script re-clones when user chooses to delete existing directory" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    mkdir -p meticulous-source
    touch meticulous-source/test_file
    
    run bash -c 'echo -e "test_key\n192.168.1.50\n\ny\nn" | timeout 10 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Removing old source"* ]]
    [[ "$output" == *"Cloning fresh repository"* ]]
}

# Tests for output messages and user feedback
@test "Script displays welcome banner" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    
    run bash -c 'echo -e "test\n192.168.1.1\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"Barista AI Installer"* ]]
}

@test "Script shows progress through all phases" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    run bash -c 'echo -e "test\n192.168.1.1\n\nn\nn" | timeout 5 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"[1/4]"* ]]
    [[ "$output" == *"[2/4]"* ]]
    [[ "$output" == *"[3/4]"* ]]
}

@test "Script provides test command with correct IP" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    create_mock_command "sudo" 0 "Docker Compose up successful"
    
    run bash -c 'echo -e "test\n192.168.1.50\n192.168.1.200\nn\n" | timeout 10 ./local-install.sh 2>&1 || true'
    
    [[ "$output" == *"http://192.168.1.200:8000"* ]]
}

# Tests for edge cases
@test "Script handles very long API key" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    long_key=$(printf 'A%.0s' {1..500})
    
    run bash -c "echo -e \"$long_key\n192.168.1.1\n\nn\nn\" | timeout 5 ./local-install.sh 2>&1 || true"
    
    [ -f .env ]
    grep -q "GEMINI_API_KEY=$long_key" .env
}

@test "Script handles IP addresses with different formats" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    create_mock_command "hostname" 0 "192.168.1.100"
    
    # Test with different valid IP formats
    for ip in "192.168.1.1" "10.0.0.1" "172.16.0.1"; do
        rm -f .env
        run bash -c "echo -e \"test\n$ip\n\nn\nn\" | timeout 5 ./local-install.sh 2>&1 || true"
        
        [ -f .env ]
        grep -q "METICULOUS_IP=$ip" .env
    done
}

@test "Script creates executable with correct permissions" {
    # Verify the script itself has execute permissions
    [ -x local-install.sh ]
}

@test "Script uses correct shebang" {
    # Verify proper bash shebang
    head -n 1 local-install.sh | grep -q "^#!/bin/bash$"
}
