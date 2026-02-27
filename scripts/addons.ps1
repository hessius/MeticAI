#!/usr/bin/env pwsh

param(
    [string]$InstallDir,
    [string]$RepoBranch = "main"
)

$ErrorActionPreference = "Stop"

function Write-LogInfo($msg) { Write-Host "i $msg" -ForegroundColor Cyan }
function Write-LogSuccess($msg) { Write-Host "v $msg" -ForegroundColor Green }
function Write-LogWarning($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-LogError($msg) { Write-Host "x $msg" -ForegroundColor Red }

function Find-InstallDir {
    param([string]$Requested)

    $candidates = @()
    if ($Requested) { $candidates += $Requested }
    $candidates += @($PWD.Path, (Join-Path $HOME "MeticAI"), "C:\MeticAI")

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if ((Test-Path (Join-Path $candidate ".env")) -and (Test-Path (Join-Path $candidate "docker-compose.yml"))) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Could not find MeticAI installation directory"
}

function Load-EnvFile {
    param([string]$Path)

    $map = @{}
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
        $idx = $_.IndexOf('=')
        if ($idx -lt 1) { return }
        $key = $_.Substring(0, $idx)
        $val = $_.Substring($idx + 1)
        $map[$key] = $val.Trim('"')
    }
    return $map
}

function Save-EnvMap {
    param([string]$Path, [hashtable]$Map)

    $lines = @()
    $existing = @{}
    if (Test-Path $Path) {
        $lines = Get-Content $Path
        foreach ($line in $lines) {
            if ($line -match '^([^#=]+)=') {
                $existing[$Matches[1]] = $true
            }
        }
    }

    foreach ($key in @($Map.Keys)) {
        if ($existing.ContainsKey($key)) {
            $lines = $lines | ForEach-Object {
                if ($_ -match "^$([regex]::Escape($key))=") { "$key=$($Map[$key])" } else { $_ }
            }
        } else {
            $lines += "$key=$($Map[$key])"
        }
    }

    Set-Content -Path $Path -Value $lines -Encoding UTF8
}

function Compose-HasFile {
    param([string]$ComposeString, [string]$File)
    return (" $ComposeString ").Contains(" -f $File ")
}

function Add-ComposeFile {
    param([string]$ComposeString, [string]$File)
    if (Compose-HasFile -ComposeString $ComposeString -File $File) { return $ComposeString }
    return "$ComposeString -f $File"
}

function Remove-ComposeFile {
    param([string]$ComposeString, [string]$File)
    $tmp = (" $ComposeString ").Replace(" -f $File ", " ").Trim()
    if ([string]::IsNullOrWhiteSpace($tmp)) { return "-f docker-compose.yml" }
    return $tmp
}

function Ensure-Download {
    param([string]$InstallPath, [string]$RepoUrl, [string]$File)
    $target = Join-Path $InstallPath $File
    if (Test-Path $target) { return }
    Write-LogInfo "Downloading $File"
    Invoke-WebRequest -Uri "$RepoUrl/$File" -OutFile $target -UseBasicParsing
}

function Ensure-WatchtowerConfig {
    param([hashtable]$EnvMap)
    if (-not $EnvMap.ContainsKey("WATCHTOWER_TOKEN") -or [string]::IsNullOrWhiteSpace($EnvMap["WATCHTOWER_TOKEN"])) {
        $bytes = New-Object byte[] 16
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $EnvMap["WATCHTOWER_TOKEN"] = ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLower()
    }
    if (-not $EnvMap.ContainsKey("WATCHTOWER_HOST_PORT") -or [string]::IsNullOrWhiteSpace($EnvMap["WATCHTOWER_HOST_PORT"])) {
        $EnvMap["WATCHTOWER_HOST_PORT"] = "127.0.0.1:18088"
    }
}

function Ensure-TailscaleConfig {
    param([hashtable]$EnvMap)
    if ($EnvMap.ContainsKey("TAILSCALE_AUTHKEY") -and -not [string]::IsNullOrWhiteSpace($EnvMap["TAILSCALE_AUTHKEY"])) {
        return $true
    }
    Write-Host "Get a Tailscale auth key from: https://login.tailscale.com/admin/settings/keys"
    $key = Read-Host "Enter Tailscale auth key (leave blank to cancel)"
    if ([string]::IsNullOrWhiteSpace($key)) {
        Write-LogWarning "No auth key provided. Tailscale not enabled."
        return $false
    }
    $EnvMap["TAILSCALE_AUTHKEY"] = $key
    return $true
}

function Apply-ComposeStack {
    param([string]$InstallPath, [string]$ComposeString, [hashtable]$EnvMap)

    $EnvMap["COMPOSE_FILES"] = $ComposeString
    Save-EnvMap -Path (Join-Path $InstallPath ".env") -Map $EnvMap

    $parts = $ComposeString -split ' '
    Write-LogInfo "Applying compose stack..."
    Push-Location $InstallPath
    try {
        docker compose @parts up -d --remove-orphans
    } finally {
        Pop-Location
    }

    Write-LogSuccess "Addon configuration applied"
}

$install = Find-InstallDir -Requested $InstallDir
$repoUrl = "https://raw.githubusercontent.com/hessius/MeticAI/$RepoBranch"
$envPath = Join-Path $install ".env"
$envMap = Load-EnvFile -Path $envPath
$compose = if ($envMap.ContainsKey("COMPOSE_FILES") -and $envMap["COMPOSE_FILES"]) { $envMap["COMPOSE_FILES"] } else { "-f docker-compose.yml" }

while ($true) {
    $wt = if (Compose-HasFile -ComposeString $compose -File "docker-compose.watchtower.yml") { "[x]" } else { "[ ]" }
    $ts = if (Compose-HasFile -ComposeString $compose -File "docker-compose.tailscale.yml") { "[x]" } else { "[ ]" }
    $ha = if (Compose-HasFile -ComposeString $compose -File "docker-compose.homeassistant.yml") { "[x]" } else { "[ ]" }

    Write-Host ""
    Write-Host "MeticAI Addon Manager"
    Write-Host "====================="
    Write-Host "Install dir: $install"
    Write-Host ""
    Write-Host "1. $wt Watchtower (auto-updates)"
    Write-Host "2. $ts Tailscale (remote access)"
    Write-Host "3. $ha Home Assistant MQTT"
    Write-Host ""
    $choice = Read-Host "Enter number to toggle, r to refresh, q to quit"

    switch ($choice) {
        "1" {
            if (Compose-HasFile -ComposeString $compose -File "docker-compose.watchtower.yml") {
                $compose = Remove-ComposeFile -ComposeString $compose -File "docker-compose.watchtower.yml"
            } else {
                Ensure-Download -InstallPath $install -RepoUrl $repoUrl -File "docker-compose.watchtower.yml"
                Ensure-WatchtowerConfig -EnvMap $envMap
                $compose = Add-ComposeFile -ComposeString $compose -File "docker-compose.watchtower.yml"
            }
            Apply-ComposeStack -InstallPath $install -ComposeString $compose -EnvMap $envMap
        }
        "2" {
            if (Compose-HasFile -ComposeString $compose -File "docker-compose.tailscale.yml") {
                $compose = Remove-ComposeFile -ComposeString $compose -File "docker-compose.tailscale.yml"
            } else {
                Ensure-Download -InstallPath $install -RepoUrl $repoUrl -File "docker-compose.tailscale.yml"
                Ensure-Download -InstallPath $install -RepoUrl $repoUrl -File "tailscale-serve.json"
                if (Ensure-TailscaleConfig -EnvMap $envMap) {
                    $compose = Add-ComposeFile -ComposeString $compose -File "docker-compose.tailscale.yml"
                }
            }
            Apply-ComposeStack -InstallPath $install -ComposeString $compose -EnvMap $envMap
        }
        "3" {
            if (Compose-HasFile -ComposeString $compose -File "docker-compose.homeassistant.yml") {
                $compose = Remove-ComposeFile -ComposeString $compose -File "docker-compose.homeassistant.yml"
            } else {
                Ensure-Download -InstallPath $install -RepoUrl $repoUrl -File "docker-compose.homeassistant.yml"
                $compose = Add-ComposeFile -ComposeString $compose -File "docker-compose.homeassistant.yml"
            }
            Apply-ComposeStack -InstallPath $install -ComposeString $compose -EnvMap $envMap
        }
        "r" { continue }
        "q" {
            Write-LogSuccess "Done"
            break
        }
        default {
            Write-LogWarning "Invalid choice"
        }
    }
}
