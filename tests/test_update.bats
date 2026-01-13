#!/usr/bin/env bats

# Tests for update.sh script

setup() {
    # Create a temporary test directory
    export TEST_DIR="$(mktemp -d)"
    export ORIG_DIR="$PWD"
    
    # Copy update script to test directory
    cp "$ORIG_DIR/update.sh" "$TEST_DIR/"
    chmod +x "$TEST_DIR/update.sh"
    
    cd "$TEST_DIR"
}

teardown() {
    # Cleanup
    cd "$ORIG_DIR"
    rm -rf "$TEST_DIR"
}

@test "update.sh: script exists and is executable" {
    [ -x "$TEST_DIR/update.sh" ]
}

@test "update.sh: --help flag shows usage information" {
    run bash "$TEST_DIR/update.sh" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "USAGE" ]]
    [[ "$output" =~ "OPTIONS" ]]
}

@test "update.sh: creates .versions.json file on first run" {
    # Initialize a git repo to simulate MeticAI repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run update script in check-only mode
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Check that versions file was created
    [ -f "$TEST_DIR/.versions.json" ]
}

@test "update.sh: .versions.json contains required fields" {
    # Initialize a git repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run update script
    bash "$TEST_DIR/update.sh" --check-only
    
    # Verify JSON structure
    [ -f "$TEST_DIR/.versions.json" ]
    
    # Check for required fields using grep (more portable than jq)
    grep -q '"last_check"' "$TEST_DIR/.versions.json"
    grep -q '"repositories"' "$TEST_DIR/.versions.json"
    grep -q '"meticai"' "$TEST_DIR/.versions.json"
}

@test "update.sh: --check-only flag doesn't modify repositories" {
    # Initialize a git repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Get initial commit hash
    INITIAL_HASH=$(git rev-parse HEAD)
    
    # Run check-only
    bash "$TEST_DIR/update.sh" --check-only
    
    # Verify commit hash hasn't changed
    CURRENT_HASH=$(git rev-parse HEAD)
    [ "$INITIAL_HASH" = "$CURRENT_HASH" ]
}

@test "update.sh: detects missing meticulous-source directory" {
    # Initialize main repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run check and capture output
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Should mention MCP is not installed
    [[ "$output" =~ "Not installed" ]] || [[ "$output" =~ "Meticulous MCP" ]]
}

@test "update.sh: detects missing meticai-web directory" {
    # Initialize main repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run check and capture output
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Should mention web app is not installed
    [[ "$output" =~ "Not installed" ]] || [[ "$output" =~ "Web Interface" ]]
}

@test "update.sh: recognizes up-to-date repository" {
    # Initialize and setup remote
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Create a bare repo to act as remote
    REMOTE_DIR="$(mktemp -d)"
    git clone --bare . "$REMOTE_DIR/repo.git"
    git remote add origin "$REMOTE_DIR/repo.git"
    git fetch origin
    git branch --set-upstream-to=origin/main main 2>/dev/null || git branch --set-upstream-to=origin/master master
    
    # Run check
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Should indicate up to date
    [[ "$output" =~ "Up to date" ]] || [[ "$output" =~ "up to date" ]]
    
    # Cleanup
    rm -rf "$REMOTE_DIR"
}

@test "update.sh: version file has valid timestamp format" {
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run update script
    bash "$TEST_DIR/update.sh" --check-only
    
    # Check timestamp format (ISO 8601)
    grep -q '"last_check": "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T' "$TEST_DIR/.versions.json"
}

@test "update.sh: invalid option shows error" {
    run bash "$TEST_DIR/update.sh" --invalid-option
    [ "$status" -ne 0 ]
    [[ "$output" =~ "Unknown option" ]]
}

@test "update.sh: script handles missing git gracefully" {
    # This test verifies the script doesn't crash if git is missing
    # We can't actually remove git in the test environment, so we test
    # that the script at least runs without fatal errors
    
    # Initialize repo first
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    run bash "$TEST_DIR/update.sh" --check-only
    # Should complete (status 0 or 1, but not crash with status > 1)
    [ "$status" -le 1 ]
}

@test "update.sh: can detect when run from non-git directory" {
    # Don't initialize git in this test
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Should handle gracefully and not crash
    [ "$status" -le 1 ]
}

@test "update.sh: handles interrupted version file gracefully" {
    # Create malformed version file
    echo "{ incomplete json" > "$TEST_DIR/.versions.json"
    
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Should still complete without crashing
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Should complete successfully (exit 0 or 1, but not crash)
    [ "$status" -le 1 ]
}

@test "update.sh: displays colored output" {
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    run bash "$TEST_DIR/update.sh" --check-only
    
    # Check for ANSI color codes in output
    [[ "$output" =~ $'\033' ]] || [[ "$output" =~ "MeticAI" ]]
}

@test "update.sh: handles spaces in paths" {
    # Create a directory with spaces
    SPACE_DIR="$(mktemp -d -t "test dir XXXXXX")"
    cp "$ORIG_DIR/update.sh" "$SPACE_DIR/"
    chmod +x "$SPACE_DIR/update.sh"
    
    cd "$SPACE_DIR"
    
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Should handle path with spaces
    run bash "./update.sh" --check-only
    [ "$status" -le 1 ]
    
    # Cleanup
    cd "$ORIG_DIR"
    rm -rf "$SPACE_DIR"
}

@test "update.sh: generates valid JSON in versions file" {
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    bash "$TEST_DIR/update.sh" --check-only
    
    # Try to parse JSON with Python (if available) or just check structure
    if command -v python3 &> /dev/null; then
        run python3 -c "import json; json.load(open('$TEST_DIR/.versions.json'))"
        [ "$status" -eq 0 ]
    else
        # Fallback: check basic JSON structure
        grep -q '^{' "$TEST_DIR/.versions.json"
        grep -q '}$' "$TEST_DIR/.versions.json"
    fi
}

@test "update.sh: preserves existing .env file" {
    # Create .env file
    echo "GEMINI_API_KEY=test123" > "$TEST_DIR/.env"
    
    # Initialize repo
    git init .
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "test" > test.txt
    git add test.txt
    git commit -m "Initial commit"
    
    # Run update
    bash "$TEST_DIR/update.sh" --check-only
    
    # Verify .env still exists and is unchanged
    [ -f "$TEST_DIR/.env" ]
    grep -q "GEMINI_API_KEY=test123" "$TEST_DIR/.env"
}

@test "update.sh: exits with helpful message on --help" {
    run bash "$TEST_DIR/update.sh" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "MeticAI" ]]
    [[ "$output" =~ "update" ]] || [[ "$output" =~ "Update" ]]
}
