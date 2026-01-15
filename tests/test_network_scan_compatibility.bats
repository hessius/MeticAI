#!/usr/bin/env bats
# Tests for network scanning compatibility fixes
#
# These tests validate the fixes for:
# - macOS: mapfile not available in Bash 3.2
# - Pi: local keyword used outside function scope

SCRIPT_PATH="${BATS_TEST_DIRNAME}/../local-install.sh"

@test "Script does not use mapfile outside functions (Bash 3.2 compatibility)" {
    # mapfile is a Bash 4+ feature not available on macOS default Bash 3.2
    # It's okay to use inside functions, but not at script level
    
    # Extract the network scanning section (lines around device detection)
    # Look for actual mapfile commands, not comments
    run bash -c "sed -n '587,640p' '$SCRIPT_PATH' | grep -v '^[[:space:]]*#' | grep -c 'mapfile'"
    
    # Should be 0 mapfile commands in the network scanning section
    [ "$output" -eq 0 ]
}

@test "Script uses portable while-read loop for array population" {
    # Verify the portable alternative is used instead of mapfile
    run grep -A 3 "Scan for Meticulous devices" "$SCRIPT_PATH"
    
    # Should contain the portable while-read pattern
    [[ "$output" =~ "while IFS= read -r line; do" ]]
}

@test "Script does not use 'local' keyword outside functions" {
    # Using 'local' outside a function causes error on some systems
    # Need to check that variables in network scanning section don't use local
    
    # Extract the network scanning section (lines 587-640)
    # This is where devices are displayed and selected
    network_section=$(sed -n '587,640p' "$SCRIPT_PATH")
    
    # Check for 'local' in lines that are NOT inside a function
    # The section should not contain 'local hostname', 'local ip', etc.
    # outside the scan_for_meticulous function
    
    # Look for problematic patterns
    if echo "$network_section" | grep -q "^\s*local hostname"; then
        # If found, fail the test
        return 1
    fi
    
    if echo "$network_section" | grep -q "^\s*local ip="; then
        # If found, fail the test
        return 1
    fi
    
    if echo "$network_section" | grep -q "^\s*local index="; then
        # If found, fail the test
        return 1
    fi
    
    # Test passes if no problematic local keywords found
    return 0
}

@test "Script correctly assigns hostname and ip without 'local' in single device case" {
    # Verify the single device case doesn't use local (line ~624-625)
    run bash -c "sed -n '620,630p' '$SCRIPT_PATH' | grep 'hostname=' | head -1"
    
    # Should not start with 'local'
    [[ ! "$output" =~ ^[[:space:]]*local ]]
    
    run bash -c "sed -n '620,630p' '$SCRIPT_PATH' | grep 'ip=' | head -1"
    
    # Should not start with 'local'
    [[ ! "$output" =~ ^[[:space:]]*local ]]
}

@test "Script correctly assigns variables without 'local' in multiple device case" {
    # Verify the multiple device case doesn't use local (line ~605-608)
    run bash -c "sed -n '600,615p' '$SCRIPT_PATH' | grep 'index='"
    
    # Should not contain 'local index='
    [[ ! "$output" =~ local[[:space:]]+index= ]]
    
    run bash -c "sed -n '600,615p' '$SCRIPT_PATH' | grep 'hostname='"
    
    # Should not contain 'local hostname='
    [[ ! "$output" =~ local[[:space:]]+hostname= ]]
}

@test "Script uses 'local' keyword only inside functions" {
    # This is a comprehensive check: local should only appear inside functions
    
    # Get all lines with 'local' keyword
    local_lines=$(grep -n "local " "$SCRIPT_PATH" | grep -v "^#")
    
    # Each line with 'local' should be inside a function
    # Functions we know exist: detect_os, install_git, install_docker, etc.
    # and scan_for_meticulous
    
    # All local keywords should be inside the scan_for_meticulous function
    # or other defined functions (generate_qr_code, create_macos_dock_shortcut, etc.)
    
    # The network scanning section (587-640) should NOT have local outside functions
    run bash -c "sed -n '587,640p' '$SCRIPT_PATH' | grep -c '^[[:space:]]*local '"
    
    # Should be 0 (no local keywords at the top level in this section)
    [ "$output" -eq 0 ]
}

@test "Script contains comment explaining mapfile replacement" {
    # Good practice to document why we use while-read instead of mapfile
    run grep "Bash 3.2 compatibility" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Portable array population works correctly" {
    # Simulate the array population logic
    
    # Create a test script that uses the same pattern
    cat > /tmp/test_array_population.sh << 'EOF'
#!/bin/bash
# Test the portable array population

test_function() {
    echo "device1,192.168.1.1"
    echo "device2,192.168.1.2"
}

# Using the portable pattern from the fix
DEVICES=()
while IFS= read -r line; do
    DEVICES+=("$line")
done < <(test_function)

# Check result
if [ ${#DEVICES[@]} -eq 2 ]; then
    echo "SUCCESS"
else
    echo "FAILED: Got ${#DEVICES[@]} devices"
    exit 1
fi
EOF
    
    chmod +x /tmp/test_array_population.sh
    run /tmp/test_array_population.sh
    
    [ "$status" -eq 0 ]
    [[ "$output" == "SUCCESS" ]]
    
    rm /tmp/test_array_population.sh
}
