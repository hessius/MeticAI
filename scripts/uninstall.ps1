#Requires -Version 5.1
<#
.SYNOPSIS
    MeticAI Uninstaller for Windows

.DESCRIPTION
    Removes MeticAI containers, images, configuration, and installation directory.
    Preserves the .env file by default for easy reinstallation.

    ⚠️ WINDOWS SUPPORT STATUS: UNTESTED IN REAL ENVIRONMENT
    Developed alongside the installer. Report issues at:
    https://github.com/hessius/MeticAI/issues

.EXAMPLE
    .\uninstall.ps1

.EXAMPLE
    .\uninstall.ps1 -NonInteractive -RemoveEnv

.NOTES
    Requirements:
    - PowerShell 5.1 or later
#>

[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [switch]$RemoveEnv,
    [switch]$RemoveImages
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ==============================================================================
# Configuration
# ==============================================================================

$InstallDir = Join-Path $env:USERPROFILE ".meticai"

# ==============================================================================
# Helper functions
# ==============================================================================

function Write-LogInfo    { param([string]$Message) Write-Host "  i " -ForegroundColor Blue -NoNewline; Write-Host $Message }
function Write-LogSuccess { param([string]$Message) Write-Host "  √ " -ForegroundColor Green -NoNewline; Write-Host $Message }
function Write-LogWarning { param([string]$Message) Write-Host "  ! " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-LogError   { param([string]$Message) Write-Host "  X " -ForegroundColor Red -NoNewline; Write-Host $Message }

# Tracking arrays
$script:UninstalledItems = @()
$script:KeptItems = @()
$script:FailedItems = @()

# ==============================================================================
# Banner
# ==============================================================================

function Show-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "  ║        ☕ MeticAI Uninstaller         ║" -ForegroundColor Red
    Write-Host "  ║           (Windows Edition)          ║" -ForegroundColor Red
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Red
    Write-Host ""
}

# ==============================================================================
# Main uninstall logic
# ==============================================================================

function Uninstall-MeticAI {
    [CmdletBinding()]
    param(
        [switch]$NonInteractive,
        [switch]$RemoveEnv,
        [switch]$RemoveImages
    )

    Show-Banner

    # ------------------------------------------------------------------
    # Confirmation
    # ------------------------------------------------------------------
    if (-not $NonInteractive) {
        Write-Host "  This will remove MeticAI containers, volumes, and configuration." -ForegroundColor Yellow
        Write-Host ""
        $confirm = Read-Host "  Are you sure you want to uninstall MeticAI? (y/N)"
        if ($confirm -notmatch "^[Yy]") {
            Write-LogInfo "Uninstallation cancelled."
            return
        }
        Write-Host ""
    }

    # ------------------------------------------------------------------
    # [1/5] Stop and remove containers
    # ------------------------------------------------------------------
    Write-LogInfo "[1/5] Stopping MeticAI containers..."

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            Push-Location $InstallDir -ErrorAction SilentlyContinue
            $null = docker compose down --remove-orphans 2>&1
            Pop-Location -ErrorAction SilentlyContinue
            Write-LogSuccess "Containers stopped and removed"
            $script:UninstalledItems += "Docker containers"
        }
        catch {
            Write-LogWarning "Could not stop containers via docker compose, trying individually..."
            $containers = @("meticai-unified", "meticai-watchtower", "meticai-tailscale")
            foreach ($container in $containers) {
                try {
                    $null = docker stop $container 2>&1
                    $null = docker rm $container 2>&1
                }
                catch { }
            }
            $script:UninstalledItems += "Docker containers (manual cleanup)"
        }
    }
    else {
        Write-LogWarning "Docker not found, skipping container cleanup"
        $script:KeptItems += "Docker containers (docker not found)"
    }

    # ------------------------------------------------------------------
    # [2/5] Remove Docker images
    # ------------------------------------------------------------------
    Write-LogInfo "[2/5] Checking Docker images..."

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $meticImages = docker images --format "{{.Repository}}:{{.Tag}}" 2>&1 |
            Where-Object { $_ -match "meticai|meticai-server|meticai-web" }

        if ($meticImages) {
            $doRemove = $RemoveImages.IsPresent
            if (-not $NonInteractive -and -not $doRemove) {
                Write-Host ""
                Write-Host "  Found MeticAI Docker images:" -ForegroundColor Yellow
                $meticImages | ForEach-Object { Write-Host "    - $_" }
                Write-Host ""
                $removeChoice = Read-Host "  Remove these images? (y/N)"
                $doRemove = $removeChoice -match "^[Yy]"
            }

            if ($doRemove) {
                foreach ($img in $meticImages) {
                    try {
                        $null = docker rmi $img 2>&1
                    }
                    catch { }
                }
                Write-LogSuccess "Docker images removed"
                $script:UninstalledItems += "Docker images"
            }
            else {
                Write-LogInfo "Keeping Docker images"
                $script:KeptItems += "Docker images"
            }
        }
        else {
            Write-LogInfo "No MeticAI images found"
        }
    }

    # ------------------------------------------------------------------
    # [3/5] Remove Docker volumes
    # ------------------------------------------------------------------
    Write-LogInfo "[3/5] Removing Docker volumes..."

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            $meticVolumes = docker volume ls --format "{{.Name}}" 2>&1 |
                Where-Object { $_ -match "meticai" }
            foreach ($vol in $meticVolumes) {
                $null = docker volume rm $vol 2>&1
            }
            if ($meticVolumes) {
                Write-LogSuccess "Docker volumes removed"
                $script:UninstalledItems += "Docker volumes"
            }
            else {
                Write-LogInfo "No MeticAI volumes found"
            }
        }
        catch {
            Write-LogWarning "Could not remove some volumes"
            $script:FailedItems += "Docker volumes"
        }
    }

    # ------------------------------------------------------------------
    # [4/5] Handle .env file
    # ------------------------------------------------------------------
    Write-LogInfo "[4/5] Handling configuration..."

    $envFile = Join-Path $InstallDir ".env"
    if (Test-Path $envFile) {
        if ($RemoveEnv) {
            Remove-Item $envFile -Force
            Write-LogSuccess ".env file removed"
            $script:UninstalledItems += ".env configuration"
        }
        else {
            Write-LogInfo "Preserving .env file (contains your API keys)"
            Write-Host "    Use -RemoveEnv flag to also remove it" -ForegroundColor DarkGray
            $script:KeptItems += ".env file (API keys)"
        }
    }

    # ------------------------------------------------------------------
    # [5/5] Clean installation directory
    # ------------------------------------------------------------------
    Write-LogInfo "[5/5] Cleaning installation directory..."

    if (Test-Path $InstallDir) {
        # Remove compose files and other generated files
        $filesToRemove = @(
            "docker-compose.yml",
            "docker-compose.tailscale.yml",
            "docker-compose.watchtower.yml"
        )
        foreach ($file in $filesToRemove) {
            $filePath = Join-Path $InstallDir $file
            if (Test-Path $filePath) {
                Remove-Item $filePath -Force
            }
        }
        Write-LogSuccess "Compose files removed"
        $script:UninstalledItems += "Compose files"

        # Remove install dir if empty (or only has .env)
        $remaining = Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue
        if (-not $remaining -or ($remaining.Count -eq 1 -and $remaining[0].Name -eq ".env")) {
            if (-not $remaining) {
                Remove-Item $InstallDir -Force -Recurse
                Write-LogSuccess "Installation directory removed"
                $script:UninstalledItems += "Installation directory"
            }
            else {
                Write-LogInfo "Installation directory kept (contains .env)"
                $script:KeptItems += "Installation directory (~\.meticai)"
            }
        }
        else {
            Write-LogWarning "Installation directory has extra files, keeping it"
            $script:KeptItems += "Installation directory (has extra files)"
        }
    }

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║      Uninstallation Summary          ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""

    if ($script:UninstalledItems.Count -gt 0) {
        Write-Host "  Removed:" -ForegroundColor Green
        $script:UninstalledItems | ForEach-Object { Write-Host "    √ $_" -ForegroundColor Green }
    }

    if ($script:KeptItems.Count -gt 0) {
        Write-Host "  Kept:" -ForegroundColor Yellow
        $script:KeptItems | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
    }

    if ($script:FailedItems.Count -gt 0) {
        Write-Host "  Failed:" -ForegroundColor Red
        $script:FailedItems | ForEach-Object { Write-Host "    X $_" -ForegroundColor Red }
    }

    Write-Host ""
    if (-not $RemoveEnv -and (Test-Path (Join-Path $InstallDir ".env") -ErrorAction SilentlyContinue)) {
        Write-Host "  Your .env file was preserved at: $InstallDir\.env" -ForegroundColor DarkGray
        Write-Host "  You can safely delete it if you no longer need it." -ForegroundColor DarkGray
        Write-Host ""
    }
    Write-Host "  MeticAI has been uninstalled. Thanks for trying it! ☕" -ForegroundColor Cyan
    Write-Host ""
}

# ==============================================================================
# Entry point
# ==============================================================================

try {
    Uninstall-MeticAI -NonInteractive:$NonInteractive `
                      -RemoveEnv:$RemoveEnv `
                      -RemoveImages:$RemoveImages
}
catch {
    Write-LogError $_.Exception.Message
    Write-Host ""
    Write-Host "  Uninstallation encountered an error." -ForegroundColor Red
    Write-Host "  For help, visit: https://github.com/hessius/MeticAI/issues" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}
