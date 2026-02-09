#Requires -Modules Pester
<#
.SYNOPSIS
    Pester tests for the MeticAI Windows installer (install.ps1)

.DESCRIPTION
    Comprehensive tests for the PowerShell installation script.
    Tests helper functions, configuration logic, and the installation flow
    using mocked Docker and network calls.

    ⚠️  These tests validate script logic but do NOT test on a real Windows
    machine with Docker Desktop. They mock all external dependencies.

.EXAMPLE
    # Run all tests
    Invoke-Pester -Path .\install.Tests.ps1 -Output Detailed

    # Run with code coverage
    Invoke-Pester -Path .\install.Tests.ps1 -CodeCoverage .\install.ps1
#>

BeforeAll {
    # Dot-source the script to get access to its functions
    # We need to prevent it from auto-executing, so we wrap the entry point
    $thisDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
    $scriptPath = Join-Path $thisDir "install.ps1"

    # Ensure $env:USERPROFILE exists (not set on macOS/Linux)
    if (-not $env:USERPROFILE) {
        $env:USERPROFILE = $env:HOME
    }

    # Stub Windows-only cmdlets so Pester can mock them on macOS/Linux
    if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
        function global:Get-NetIPAddress { }
    }

    # Extract and dot-source only the function definitions
    $scriptContent = Get-Content $scriptPath -Raw

    # Remove the entry-point try/catch block at the bottom so it doesn't auto-run
    $functionsOnly = $scriptContent -replace '(?s)# =+\s*# Entry point\s*# =+.*$', ''

    # Create a temp script with just the functions
    $tempScript = Join-Path $TestDrive "install-functions.ps1"
    Set-Content -Path $tempScript -Value $functionsOnly
    . $tempScript
}

# ==============================================================================
# Helper Function Tests
# ==============================================================================

Describe "Write-Log Functions" {
    It "Write-LogInfo should not throw" {
        { Write-LogInfo "test message" } | Should -Not -Throw
    }

    It "Write-LogSuccess should not throw" {
        { Write-LogSuccess "test message" } | Should -Not -Throw
    }

    It "Write-LogWarning should not throw" {
        { Write-LogWarning "test message" } | Should -Not -Throw
    }

    It "Write-LogError should not throw" {
        { Write-LogError "test message" } | Should -Not -Throw
    }
}

Describe "Test-DockerInstalled" {
    It "Returns true when docker command exists" {
        Mock Get-Command { return @{ Name = "docker" } } -ParameterFilter { $Name -eq "docker" }
        Test-DockerInstalled | Should -Be $true
    }

    It "Returns false when docker command does not exist" {
        Mock Get-Command { throw "Command not found" } -ParameterFilter { $Name -eq "docker" }
        Test-DockerInstalled | Should -Be $false
    }
}

Describe "Test-DockerRunning" {
    It "Returns true when docker info succeeds" {
        Mock docker { } -ParameterFilter { $args[0] -eq "info" }
        $global:LASTEXITCODE = 0
        Test-DockerRunning | Should -Be $true
    }

    It "Returns false when docker info fails" {
        Mock docker { } -ParameterFilter { $args[0] -eq "info" }
        $global:LASTEXITCODE = 1
        Test-DockerRunning | Should -Be $false
    }
}

Describe "Get-RandomToken" {
    It "Returns a hex string" {
        $token = Get-RandomToken -Length 16
        $token | Should -Match "^[0-9a-f]+$"
    }

    It "Returns a string of expected length (2 hex chars per byte)" {
        $token = Get-RandomToken -Length 16
        $token.Length | Should -Be 32
    }

    It "Returns different values on subsequent calls" {
        $token1 = Get-RandomToken -Length 16
        $token2 = Get-RandomToken -Length 16
        $token1 | Should -Not -Be $token2
    }

    It "Handles different lengths" {
        $token = Get-RandomToken -Length 8
        $token.Length | Should -Be 16

        $token32 = Get-RandomToken -Length 32
        $token32.Length | Should -Be 64
    }
}

Describe "Get-UserInput" {
    Context "Non-interactive mode" {
        BeforeAll {
            $script:NonInteractive = $true
        }

        It "Returns default value in non-interactive mode" {
            Get-UserInput -Prompt "Test" -Default "default_value" | Should -Be "default_value"
        }

        It "Throws when required input has no default in non-interactive mode" {
            { Get-UserInput -Prompt "Test" -Required } | Should -Throw "*not provided*"
        }

        It "Returns default when required input has a default" {
            Get-UserInput -Prompt "Test" -Default "val" -Required | Should -Be "val"
        }

        AfterAll {
            $script:NonInteractive = $false
        }
    }
}

Describe "Get-YesNo" {
    Context "Non-interactive mode" {
        BeforeAll {
            $script:NonInteractive = $true
        }

        It "Returns false by default in non-interactive mode" {
            Get-YesNo -Prompt "Test?" | Should -Be $false
        }

        It "Returns true when default is true in non-interactive mode" {
            Get-YesNo -Prompt "Test?" -Default $true | Should -Be $true
        }

        AfterAll {
            $script:NonInteractive = $false
        }
    }
}

Describe "Invoke-DownloadFile" {
    It "Returns true on successful download" {
        Mock Invoke-WebRequest { } -ParameterFilter { $Uri -like "*test*" }
        $outFile = Join-Path $TestDrive "test-download.yml"
        Invoke-DownloadFile -Url "https://example.com/test" -OutFile $outFile | Should -Be $true
    }

    It "Throws on failed required download" {
        Mock Invoke-WebRequest { throw "Network error" }
        $outFile = Join-Path $TestDrive "test-download.yml"
        { Invoke-DownloadFile -Url "https://example.com/fail" -OutFile $outFile } | Should -Throw "*Failed to download*"
    }

    It "Returns false on failed optional download" {
        Mock Invoke-WebRequest { throw "Network error" }
        $outFile = Join-Path $TestDrive "test-download.yml"
        Invoke-DownloadFile -Url "https://example.com/fail" -OutFile $outFile -Optional | Should -Be $false
    }
}

Describe "Show-Banner" {
    It "Should not throw" {
        { Show-Banner } | Should -Not -Throw
    }
}

# ==============================================================================
# Installation Flow Tests
# ==============================================================================

Describe "Install-MeticAI - Docker Checks" {
    Context "When Docker is not installed" {
        It "Should throw with installation instructions" {
            Mock Test-DockerInstalled { return $false }
            { Install-MeticAI } | Should -Throw "*Docker is not installed*"
        }
    }

    Context "When Docker is installed but not running" {
        It "Should throw asking user to start Docker" {
            Mock Test-DockerInstalled { return $true }
            Mock Test-DockerRunning { return $false }
            { Install-MeticAI } | Should -Throw "*Docker is not running*"
        }
    }
}

Describe "Install-MeticAI - Full Flow (Non-Interactive)" {
    BeforeAll {
        # Set up a temp install directory
        $script:InstallDir = Join-Path $TestDrive ".meticai"

        # Mock all external dependencies
        Mock Test-DockerInstalled { return $true }
        Mock Test-DockerRunning { return $true }
        Mock Test-Path { return $false } -ParameterFilter {
            $Path -like "*MeticAI" -or $Path -like "*.env"
        }
        Mock New-Item { } -ParameterFilter { $ItemType -eq "Directory" }
        Mock Set-Location { }
        Mock Invoke-DownloadFile { return $true }
        Mock docker { $global:LASTEXITCODE = 0 }
        Mock Start-Sleep { }
        Mock Get-NetIPAddress { return @([PSCustomObject]@{
            IPAddress = "192.168.1.100"
            InterfaceAlias = "Ethernet"
        }) }
    }

    It "Should complete successfully with all parameters" {
        Mock Set-Content { }

        {
            Install-MeticAI -GeminiApiKey "test-key-123" `
                            -MeticulousIp "192.168.1.50" `
                            -NonInteractive
        } | Should -Not -Throw
    }

    It "Should write .env file with correct content" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "test-key-456" `
                        -MeticulousIp "10.0.0.5" `
                        -NonInteractive

        $script:envContent | Should -Match "GEMINI_API_KEY=test-key-456"
        $script:envContent | Should -Match "METICULOUS_IP=10.0.0.5"
    }

    It "Should download compose files" {
        Mock Set-Content { }

        $script:downloadCalls = @()
        Mock Invoke-DownloadFile {
            $script:downloadCalls += $Url
            return $true
        }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -NonInteractive

        ($script:downloadCalls -join ",") | Should -Match "docker-compose.unified.yml" -Because "should download main compose file"
    }

    It "Should call docker compose pull and up" {
        Mock Set-Content { }
        Mock Invoke-DownloadFile { return $true }

        $script:dockerCalls = @()
        Mock docker {
            $script:dockerCalls += ($args -join " ")
            $global:LASTEXITCODE = 0
        }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -NonInteractive

        ($script:dockerCalls -join "|") | Should -Match "pull"
        ($script:dockerCalls -join "|") | Should -Match "up"
    }
}

Describe "Install-MeticAI - Optional Services" {
    BeforeAll {
        $script:InstallDir = Join-Path $TestDrive ".meticai"

        Mock Test-DockerInstalled { return $true }
        Mock Test-DockerRunning { return $true }
        Mock Test-Path { return $false } -ParameterFilter {
            $Path -like "*MeticAI" -or $Path -like "*.env"
        }
        Mock New-Item { }
        Mock Set-Location { }
        Mock Invoke-DownloadFile { return $true }
        Mock docker { $global:LASTEXITCODE = 0 }
        Mock Start-Sleep { }
        Mock Get-NetIPAddress { return @([PSCustomObject]@{
            IPAddress = "192.168.1.100"
            InterfaceAlias = "Ethernet"
        }) }
    }

    It "Should include Tailscale compose file when enabled" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -EnableTailscale `
                        -TailscaleAuthKey "tskey-test-123" `
                        -NonInteractive

        $script:envContent | Should -Match "docker-compose.tailscale.yml"
        $script:envContent | Should -Match "TAILSCALE_AUTHKEY=tskey-test-123"
    }

    It "Should include Watchtower compose file when enabled" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -EnableWatchtower `
                        -NonInteractive

        $script:envContent | Should -Match "docker-compose.watchtower.yml"
        $script:envContent | Should -Match "WATCHTOWER_TOKEN="
    }

    It "Should include both optional services when both enabled" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -EnableTailscale `
                        -TailscaleAuthKey "tskey-both-test" `
                        -EnableWatchtower `
                        -NonInteractive

        $script:envContent | Should -Match "docker-compose.tailscale.yml"
        $script:envContent | Should -Match "docker-compose.watchtower.yml"
        $script:envContent | Should -Match "TAILSCALE_AUTHKEY=tskey-both-test"
        $script:envContent | Should -Match "WATCHTOWER_TOKEN="
    }

    It "Should skip Tailscale when no auth key provided" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -MeticulousIp "1.2.3.4" `
                        -EnableTailscale `
                        -NonInteractive

        # In non-interactive mode with no key, Tailscale gets empty key → skipped
        $script:envContent | Should -Not -Match "TAILSCALE_AUTHKEY"
    }
}

Describe "Install-MeticAI - Default Values" {
    BeforeAll {
        $script:InstallDir = Join-Path $TestDrive ".meticai"

        Mock Test-DockerInstalled { return $true }
        Mock Test-DockerRunning { return $true }
        Mock Test-Path { return $false } -ParameterFilter {
            $Path -like "*MeticAI" -or $Path -like "*.env"
        }
        Mock New-Item { }
        Mock Set-Location { }
        Mock Invoke-DownloadFile { return $true }
        Mock docker { $global:LASTEXITCODE = 0 }
        Mock Start-Sleep { }
        Mock Get-NetIPAddress { return @([PSCustomObject]@{
            IPAddress = "192.168.1.100"
            InterfaceAlias = "Ethernet"
        }) }
    }

    It "Should use meticulous.local as default IP" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -NonInteractive

        $script:envContent | Should -Match "METICULOUS_IP=meticulous.local"
    }

    It "Should only include base compose file without optional services" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" `
                        -NonInteractive

        $script:envContent | Should -Match "docker-compose.yml"
        $script:envContent | Should -Not -Match "tailscale"
        $script:envContent | Should -Not -Match "watchtower"
    }
}

Describe "Install-MeticAI - Error Handling" {
    BeforeAll {
        $script:InstallDir = Join-Path $TestDrive ".meticai"
        Mock Test-DockerInstalled { return $true }
        Mock Test-DockerRunning { return $true }
        Mock Test-Path { return $false } -ParameterFilter {
            $Path -like "*MeticAI" -or $Path -like "*.env"
        }
        Mock New-Item { }
        Mock Set-Location { }
        Mock Set-Content { }
        Mock Start-Sleep { }
    }

    It "Should throw when docker pull fails" {
        Mock Invoke-DownloadFile { return $true }
        Mock docker {
            $global:LASTEXITCODE = 1
        } -ParameterFilter { ($args -join " ") -match "pull" }

        { Install-MeticAI -GeminiApiKey "key" -MeticulousIp "1.2.3.4" -NonInteractive } |
            Should -Throw "*Failed to pull*"
    }

    It "Should throw when compose file download fails" {
        Mock Invoke-DownloadFile { throw "Failed to download" }

        { Install-MeticAI -GeminiApiKey "key" -MeticulousIp "1.2.3.4" -NonInteractive } |
            Should -Throw
    }
}

# ==============================================================================
# .env File Format Tests
# ==============================================================================

Describe ".env File Format" {
    BeforeAll {
        $script:InstallDir = Join-Path $TestDrive ".meticai-env-test"

        Mock Test-DockerInstalled { return $true }
        Mock Test-DockerRunning { return $true }
        Mock Test-Path { return $false } -ParameterFilter {
            $Path -like "*MeticAI" -or $Path -like "*.env"
        }
        Mock New-Item { }
        Mock Set-Location { }
        Mock Invoke-DownloadFile { return $true }
        Mock docker { $global:LASTEXITCODE = 0 }
        Mock Start-Sleep { }
        Mock Get-NetIPAddress { return @([PSCustomObject]@{
            IPAddress = "192.168.1.100"
            InterfaceAlias = "Ethernet"
        }) }
    }

    It "Should have proper KEY=VALUE format" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "mykey123" -MeticulousIp "10.0.0.1" -NonInteractive

        # Each non-comment, non-blank line should be KEY=VALUE
        $lines = $script:envContent -split "`n" | Where-Object {
            $_ -and $_ -notmatch "^\s*#" -and $_.Trim() -ne ""
        }
        foreach ($line in $lines) {
            $line | Should -Match "^[A-Z_]+=.+" -Because "line '$line' should be KEY=VALUE format"
        }
    }

    It "Should include a generation timestamp comment" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" -NonInteractive

        $script:envContent | Should -Match "Generated on"
    }

    It "Should include Windows platform identifier" {
        $envContent = $null
        Mock Set-Content {
            $script:envContent = $Value
        } -ParameterFilter { $Path -like "*.env" }

        Install-MeticAI -GeminiApiKey "key" -NonInteractive

        $script:envContent | Should -Match "Windows"
    }
}
