#Requires -Version 5.1
<#
.SYNOPSIS
    MeticAI Installer for Windows

.DESCRIPTION
    Installs MeticAI on Windows using Docker Desktop.
    Creates configuration, downloads compose files, and starts the container.

    ⚠️ WINDOWS SUPPORT STATUS: UNTESTED IN REAL ENVIRONMENT
    This installer has been developed and tested via automated Pester tests
    but has NOT been verified on a real Windows machine. If you encounter
    issues, please report them at:
    https://github.com/hessius/MeticAI/issues

.EXAMPLE
    # Run directly:
    .\install.ps1

    # Or download and run:
    irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.ps1 | iex

.NOTES
    Requirements:
    - Windows 10/11 with Docker Desktop installed
    - PowerShell 5.1 or later (included with Windows 10+)
#>

[CmdletBinding()]
param(
    [string]$GeminiApiKey,
    [string]$MeticulousIp,
    [switch]$EnableTailscale,
    [string]$TailscaleAuthKey,
    [switch]$EnableWatchtower,
    [switch]$NonInteractive
)

# Strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ==============================================================================
# Configuration
# ==============================================================================

$InstallDir = Join-Path $env:USERPROFILE ".meticai"
$RepoUrl = "https://raw.githubusercontent.com/hessius/MeticAI/main"

# ==============================================================================
# Helper functions
# ==============================================================================

function Write-LogInfo    { param([string]$Message) Write-Host "  i " -ForegroundColor Blue -NoNewline; Write-Host $Message }
function Write-LogSuccess { param([string]$Message) Write-Host "  √ " -ForegroundColor Green -NoNewline; Write-Host $Message }
function Write-LogWarning { param([string]$Message) Write-Host "  ! " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-LogError   { param([string]$Message) Write-Host "  X " -ForegroundColor Red -NoNewline; Write-Host $Message }

function Test-DockerInstalled {
    try {
        $null = Get-Command docker -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Test-DockerRunning {
    try {
        $null = docker info 2>&1
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Get-UserInput {
    param(
        [string]$Prompt,
        [string]$Default = "",
        [switch]$Required,
        [switch]$Sensitive
    )
    
    if ($script:NonInteractive) {
        if ($Required -and [string]::IsNullOrEmpty($Default)) {
            throw "Required input '$Prompt' not provided in non-interactive mode."
        }
        return $Default
    }

    $displayPrompt = $Prompt
    if (-not [string]::IsNullOrEmpty($Default)) {
        $displayPrompt = "$Prompt [$Default]"
    }

    if ($Sensitive) {
        $secureInput = Read-Host -Prompt $displayPrompt -AsSecureString
        $userInput = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
        )
    }
    else {
        $userInput = Read-Host -Prompt $displayPrompt
    }

    if ([string]::IsNullOrEmpty($userInput)) {
        $userInput = $Default
    }

    if ($Required -and [string]::IsNullOrEmpty($userInput)) {
        Write-LogError "$Prompt is required"
        throw "Required input not provided: $Prompt"
    }

    return $userInput
}

function Get-YesNo {
    param(
        [string]$Prompt,
        [bool]$Default = $false
    )
    
    if ($script:NonInteractive) {
        return $Default
    }

    $suffix = if ($Default) { "(Y/n)" } else { "(y/N)" }
    $response = Read-Host -Prompt "$Prompt $suffix"

    if ([string]::IsNullOrEmpty($response)) {
        return $Default
    }

    return $response -match "^[Yy]"
}

function Get-RandomToken {
    param([int]$Length = 32)
    $bytes = [byte[]]::new($Length)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Invoke-DownloadFile {
    param(
        [string]$Url,
        [string]$OutFile,
        [switch]$Optional
    )
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
        return $true
    }
    catch {
        if (-not $Optional) {
            throw "Failed to download $Url : $_"
        }
        return $false
    }
}

# ==============================================================================
# Banner
# ==============================================================================

function Show-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║          ☕ MeticAI Installer         ║" -ForegroundColor Cyan
    Write-Host "  ║     Autonomous Espresso AI Agent     ║" -ForegroundColor Cyan
    Write-Host "  ║           (Windows Edition)          ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ⚠  WINDOWS SUPPORT: Community-tested only." -ForegroundColor Yellow
    Write-Host "     Report issues: github.com/hessius/MeticAI/issues" -ForegroundColor DarkGray
    Write-Host ""
}

# ==============================================================================
# Main installation logic
# ==============================================================================

function Install-MeticAI {
    [CmdletBinding()]
    param(
        [string]$GeminiApiKey,
        [string]$MeticulousIp,
        [switch]$EnableTailscale,
        [string]$TailscaleAuthKey,
        [switch]$EnableWatchtower,
        [switch]$NonInteractive
    )

    # Expose NonInteractive to helper functions via script scope
    $script:NonInteractive = $NonInteractive.IsPresent

    Show-Banner

    Write-LogInfo "Detected platform: Windows"

    # ------------------------------------------------------------------
    # 1. Check Docker
    # ------------------------------------------------------------------
    if (-not (Test-DockerInstalled)) {
        Write-LogError "Docker is not installed."
        Write-Host ""
        Write-Host "  Please install Docker Desktop from:" -ForegroundColor Yellow
        Write-Host "  https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  After installing, start Docker Desktop and run this script again." -ForegroundColor Yellow
        throw "Docker is not installed. Please install Docker Desktop first."
    }
    Write-LogSuccess "Docker is installed"

    if (-not (Test-DockerRunning)) {
        Write-LogError "Docker is not running."
        Write-Host ""
        Write-Host "  Please start Docker Desktop and try again." -ForegroundColor Yellow
        Write-Host "  Look for the Docker whale icon in your system tray." -ForegroundColor DarkGray
        throw "Docker is not running. Please start Docker Desktop."
    }
    Write-LogSuccess "Docker is running"

    # ------------------------------------------------------------------
    # 2. Check for existing installation
    # ------------------------------------------------------------------
    $oldInstall = Join-Path $env:USERPROFILE "MeticAI"
    $envFile = Join-Path $InstallDir ".env"

    if ((Test-Path $oldInstall) -or (Test-Path $envFile)) {
        Write-LogWarning "Existing MeticAI installation detected"
        Write-Host ""
        Write-Host "  Would you like to:"
        Write-Host "    1) Fresh install (will override existing config)"
        Write-Host "    2) Cancel"
        Write-Host ""
        $choice = Get-UserInput -Prompt "Choice [1]" -Default "1"

        if ($choice -ne "1") {
            Write-LogInfo "Cancelled"
            return
        }
        Write-LogInfo "Proceeding with fresh install..."
    }

    # ------------------------------------------------------------------
    # 3. Create installation directory
    # ------------------------------------------------------------------
    Write-LogInfo "Creating installation directory..."
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Set-Location $InstallDir

    # ------------------------------------------------------------------
    # 4. Configuration prompts
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "  Configuration" -ForegroundColor White
    Write-Host "  -------------"
    Write-Host ""

    # Gemini API Key
    $apiKey = $GeminiApiKey
    if ([string]::IsNullOrEmpty($apiKey)) {
        Write-Host "  Get your API key from: https://aistudio.google.com/app/apikey"
        $apiKey = Get-UserInput -Prompt "Gemini API Key" -Required
    }

    # Meticulous IP
    $machineIp = $MeticulousIp
    if ([string]::IsNullOrEmpty($machineIp)) {
        Write-Host ""
        Write-Host "  Enter the IP address or hostname of your Meticulous machine."
        Write-Host "  If unsure, try 'meticulous.local' for mDNS discovery."
        Write-Host "  Note: mDNS (*.local) may require Bonjour on Windows." -ForegroundColor DarkGray
        $machineIp = Get-UserInput -Prompt "Meticulous IP" -Default "meticulous.local"
    }

    # ------------------------------------------------------------------
    # 5. Optional services
    # ------------------------------------------------------------------
    $composeFiles = @("-f", "docker-compose.yml")

    Write-Host ""
    Write-Host "  Optional Services" -ForegroundColor White
    Write-Host "  -----------------"
    Write-Host ""

    # Tailscale
    $tsEnabled = $EnableTailscale.IsPresent
    $tsKey = $TailscaleAuthKey
    if (-not $NonInteractive -and -not $tsEnabled) {
        $tsEnabled = Get-YesNo -Prompt "Enable Tailscale for remote access?"
    }
    if ($tsEnabled) {
        if ([string]::IsNullOrEmpty($tsKey)) {
            Write-Host "  Get an auth key from: https://login.tailscale.com/admin/settings/keys"
            $tsKey = Get-UserInput -Prompt "Tailscale Auth Key"
        }
        if (-not [string]::IsNullOrEmpty($tsKey)) {
            $composeFiles += @("-f", "docker-compose.tailscale.yml")
        }
        else {
            Write-LogWarning "No auth key provided, skipping Tailscale"
            $tsEnabled = $false
        }
    }

    # Watchtower
    $wtEnabled = $EnableWatchtower.IsPresent
    $wtToken = ""
    if (-not $NonInteractive -and -not $wtEnabled) {
        $wtEnabled = Get-YesNo -Prompt "Enable Watchtower for automatic updates?"
    }
    if ($wtEnabled) {
        $wtToken = Get-RandomToken -Length 16
        $composeFiles += @("-f", "docker-compose.watchtower.yml")
        Write-LogSuccess "Watchtower enabled with auto-generated token"
        Write-LogWarning "Watchtower on Windows may require Docker socket config."
        Write-Host "     See: https://github.com/hessius/MeticAI/issues" -ForegroundColor DarkGray
    }

    # ------------------------------------------------------------------
    # 6. Write configuration
    # ------------------------------------------------------------------
    Write-LogInfo "Writing configuration..."

    $composeFilesString = $composeFiles -join " "
    $envContent = @"
# MeticAI Configuration
# Generated on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Platform: Windows (PowerShell installer)

# Required
GEMINI_API_KEY=$apiKey
METICULOUS_IP=$machineIp

# Compose files to load
COMPOSE_FILES="$composeFilesString"
"@

    if ($tsEnabled -and -not [string]::IsNullOrEmpty($tsKey)) {
        $envContent += "`nTAILSCALE_AUTHKEY=$tsKey"
    }
    if ($wtEnabled -and -not [string]::IsNullOrEmpty($wtToken)) {
        $envContent += "`nWATCHTOWER_TOKEN=$wtToken"
    }

    Set-Content -Path (Join-Path $InstallDir ".env") -Value $envContent -Encoding UTF8
    Write-LogSuccess "Configuration saved to $InstallDir\.env"

    # ------------------------------------------------------------------
    # 7. Download compose files
    # ------------------------------------------------------------------
    Write-LogInfo "Downloading Docker Compose files..."

    Invoke-DownloadFile -Url "$RepoUrl/docker-compose.yml" -OutFile (Join-Path $InstallDir "docker-compose.yml")
    Invoke-DownloadFile -Url "$RepoUrl/docker-compose.tailscale.yml" -OutFile (Join-Path $InstallDir "docker-compose.tailscale.yml") -Optional
    Invoke-DownloadFile -Url "$RepoUrl/docker-compose.watchtower.yml" -OutFile (Join-Path $InstallDir "docker-compose.watchtower.yml") -Optional

    Write-LogSuccess "Compose files downloaded"

    # ------------------------------------------------------------------
    # 8. Pull and start
    # ------------------------------------------------------------------
    Write-LogInfo "Pulling MeticAI image (this may take a few minutes)..."
    $pullArgs = @("compose") + $composeFiles + @("pull")
    & docker @pullArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to pull Docker images. Check your internet connection."
    }

    Write-LogInfo "Starting MeticAI..."
    $upArgs = @("compose") + $composeFiles + @("up", "-d")
    & docker @upArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start MeticAI containers."
    }

    # Wait for services
    Write-LogInfo "Waiting for services to start..."
    Start-Sleep -Seconds 5

    # ------------------------------------------------------------------
    # 9. Verify installation
    # ------------------------------------------------------------------
    $psOutput = docker compose ps 2>&1
    if ($psOutput -match "running|healthy") {
        Write-LogSuccess "MeticAI is running!"
    }
    else {
        Write-LogWarning "Container may still be starting..."
        Write-Host "  Check status with: cd ~\.meticai; docker compose ps"
    }

    # Get access URL
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
            Select-Object -First 1).IPAddress
    }
    catch {
        $ip = "localhost"
    }

    # ------------------------------------------------------------------
    # 10. Success message
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║      ✅ Installation Complete!       ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Web UI:  http://${ip}:3550"
    Write-Host "  API:     http://${ip}:3550/api/docs"
    Write-Host ""
    Write-Host "  Useful commands:" -ForegroundColor White
    Write-Host "    View logs:   cd ~\.meticai; docker compose logs -f"
    Write-Host "    Restart:     cd ~\.meticai; docker compose restart"
    Write-Host "    Stop:        cd ~\.meticai; docker compose down"
    Write-Host "    Update:      cd ~\.meticai; docker compose pull; docker compose up -d"
    Write-Host "    Uninstall:   irm $RepoUrl/scripts/uninstall.ps1 -OutFile uninstall.ps1; .\uninstall.ps1"
    Write-Host ""
    Write-Host "  ☕ Enjoy your coffee!" -ForegroundColor Cyan
    Write-Host ""
}

# ==============================================================================
# Entry point
# ==============================================================================

try {
    Install-MeticAI -GeminiApiKey $GeminiApiKey `
                    -MeticulousIp $MeticulousIp `
                    -EnableTailscale:$EnableTailscale `
                    -TailscaleAuthKey $TailscaleAuthKey `
                    -EnableWatchtower:$EnableWatchtower `
                    -NonInteractive:$NonInteractive
}
catch {
    Write-LogError $_.Exception.Message
    Write-Host ""
    Write-Host "  Installation failed. Please check the error above." -ForegroundColor Red
    Write-Host "  For help, visit: https://github.com/hessius/MeticAI/issues" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}
