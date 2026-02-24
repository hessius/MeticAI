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

$DefaultInstallDir = Join-Path $env:USERPROFILE "MeticAI"
$InstallDir = $null  # Resolved during detection phase

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
# Detection & safety
# ==============================================================================

function Find-MeticAIInstallation {
    # Method 1: Detect from running Docker containers
    try {
        $containers = docker ps --filter "name=meticai" --format "{{.ID}}" 2>&1
        if ($containers -and $LASTEXITCODE -eq 0) {
            foreach ($cid in ($containers -split "`n" | Where-Object { $_ })) {
                $workDir = docker inspect $cid --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>&1
                if ($workDir -and (Test-Path $workDir)) {
                    return $workDir.Trim()
                }
            }
        }
    } catch { }

    # Method 2: docker compose ls
    try {
        $projects = docker compose ls --format json 2>&1 | ConvertFrom-Json -ErrorAction SilentlyContinue
        foreach ($p in $projects) {
            if ($p.Name -match "meticai") {
                $configFile = ($p.ConfigFiles -split ",")[0]
                if ($configFile -and (Test-Path $configFile)) {
                    return (Split-Path $configFile -Parent)
                }
            }
        }
    } catch { }

    # Method 3: Check default location
    if (Test-Path (Join-Path $DefaultInstallDir "docker-compose.yml")) {
        return $DefaultInstallDir
    }
    if (Test-Path (Join-Path $DefaultInstallDir ".env")) {
        return $DefaultInstallDir
    }

    return $null
}

function Test-SafeToUninstall {
    param([string]$Dir)

    # REFUSE to delete git repositories
    if (Test-Path (Join-Path $Dir ".git")) {
        Write-LogError "The selected folder is a Git repository (development checkout):"
        Write-Host "    $Dir" -ForegroundColor Red
        Write-Host "    The uninstaller will NOT delete development folders." -ForegroundColor Red
        return $false
    }

    # REFUSE to delete dev-marked directories
    if (Test-Path (Join-Path $Dir ".meticai-dev")) {
        Write-LogError "The selected folder contains a .meticai-dev marker:"
        Write-Host "    $Dir" -ForegroundColor Red
        Write-Host "    This folder is marked as a development environment." -ForegroundColor Red
        return $false
    }

    return $true
}

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
    # Detect installation location
    # ------------------------------------------------------------------
    Write-LogInfo "Searching for MeticAI installation..."
    $detected = Find-MeticAIInstallation

    if ($detected) {
        Write-LogSuccess "Found MeticAI at: $detected"
        if (-not $NonInteractive) {
            Write-Host ""
            $useDetected = Read-Host "  Uninstall from this location? (Y/n)"
            if ($useDetected -match "^[Nn]") {
                $customDir = Read-Host "  Enter the MeticAI installation path"
                if (-not [string]::IsNullOrEmpty($customDir) -and (Test-Path $customDir)) {
                    $script:InstallDir = $customDir.TrimEnd('\', '/')
                } else {
                    Write-LogError "Invalid path. Cancelled."
                    return
                }
            } else {
                $script:InstallDir = $detected
            }
        } else {
            $script:InstallDir = $detected
        }
    } else {
        Write-LogWarning "Could not auto-detect MeticAI installation."
        if (-not $NonInteractive) {
            $customDir = Read-Host "  Enter the MeticAI installation path [$DefaultInstallDir]"
            if ([string]::IsNullOrEmpty($customDir)) { $customDir = $DefaultInstallDir }
            if (Test-Path $customDir) {
                $script:InstallDir = $customDir.TrimEnd('\', '/')
            } else {
                Write-LogError "Path not found: $customDir"
                return
            }
        } else {
            $script:InstallDir = $DefaultInstallDir
        }
    }

    # Safety check
    if (-not (Test-SafeToUninstall $InstallDir)) {
        Write-LogError "Uninstallation aborted for safety."
        return
    }

    Write-LogInfo "Will uninstall from: $InstallDir"

    # ------------------------------------------------------------------
    # Confirmation
    # ------------------------------------------------------------------
    if (-not $NonInteractive) {
        Write-Host ""
        Write-Host "  This will remove MeticAI containers, configuration, and optionally data." -ForegroundColor Yellow
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
    # [3/5] Remove Docker volumes (data)
    # ------------------------------------------------------------------
    Write-LogInfo "[3/5] Checking Docker volumes..."

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $meticVolumes = docker volume ls --format "{{.Name}}" 2>&1 |
            Where-Object { $_ -match "meticai|mosquitto" }

        if ($meticVolumes) {
            $doRemoveVolumes = $false
            if (-not $NonInteractive) {
                Write-Host ""
                Write-Host "  Found data volumes (profiles, shot history, settings):" -ForegroundColor Yellow
                $meticVolumes | ForEach-Object { Write-Host "    - $_" }
                Write-Host ""
                $volChoice = Read-Host "  Remove these data volumes? This cannot be undone. (y/N)"
                $doRemoveVolumes = $volChoice -match "^[Yy]"
            }

            if ($doRemoveVolumes) {
                try {
                    foreach ($vol in $meticVolumes) {
                        $null = docker volume rm $vol 2>&1
                    }
                    Write-LogSuccess "Docker volumes removed"
                    $script:UninstalledItems += "Docker volumes"
                }
                catch {
                    Write-LogWarning "Could not remove some volumes"
                    $script:FailedItems += "Docker volumes"
                }
            }
            else {
                Write-LogInfo "Keeping data volumes"
                $script:KeptItems += "Docker volumes (data preserved)"
            }
        }
        else {
            Write-LogInfo "No MeticAI volumes found"
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
        # Remove compose files, convenience scripts, and config
        $filesToRemove = @(
            "docker-compose.yml",
            "docker-compose.tailscale.yml",
            "docker-compose.watchtower.yml",
            "docker-compose.homeassistant.yml",
            "tailscale-serve.json",
            "start.sh", "stop.sh", "update.sh", "uninstall.sh"
        )
        foreach ($file in $filesToRemove) {
            $filePath = Join-Path $InstallDir $file
            if (Test-Path $filePath) {
                Remove-Item $filePath -Force
            }
        }
        # Remove docker/ config subdirectory
        $dockerDir = Join-Path $InstallDir "docker"
        if (Test-Path $dockerDir) {
            Remove-Item $dockerDir -Recurse -Force
        }
        Write-LogSuccess "Configuration files removed"
        $script:UninstalledItems += "Configuration files"

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
                $script:KeptItems += "Installation directory (~\meticai)"
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
