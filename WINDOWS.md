# 🪟 Windows Installation & Support

> **Status:** Community-tested. The PowerShell installer passes automated tests but has not been verified on a real Windows machine. Please [report issues](https://github.com/hessius/MeticAI/issues) if you encounter problems.

## Prerequisites

- **Windows 10 or 11**
- **[Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)** installed and running
- **PowerShell 5.1+** (included with Windows 10+)
- A **free [Google Gemini API key](https://aistudio.google.com/app/apikey)**

## Installation

### Option A: Interactive Installer (Recommended)

```powershell
irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.ps1 -OutFile install.ps1
.\install.ps1
```

The installer guides you through configuration including optional Tailscale and Watchtower setup.

### Option B: Manual Setup

> **Note:** Do **not** use `git clone` on Windows. The repository contains macOS metadata files with special characters that are incompatible with NTFS. The install script and the steps below download only the files needed.

```powershell
# 1. Create the MeticAI directory
mkdir ~\MeticAI
cd ~\MeticAI

# 2. Download docker-compose.yml
irm https://raw.githubusercontent.com/hessius/MeticAI/main/docker-compose.yml -OutFile docker-compose.yml

# 3. Create .env file
@"
GEMINI_API_KEY=your_api_key_here
METICULOUS_IP=meticulous.local
"@ | Set-Content .env

# 4. Start MeticAI
docker compose up -d
```

Then open `http://localhost:3550` in your browser.

## Windows-Specific Notes

### mDNS / `meticulous.local`

Windows does not natively resolve `.local` hostnames. Options:

1. **Use the machine's IP address directly** (recommended) — find it in your router's admin page or the Meticulous app
2. Install [Bonjour Print Services](https://support.apple.com/kb/DL999) to enable mDNS resolution
3. If you have iTunes installed, Bonjour is already included

### Execution Policy

If PowerShell blocks the installer with a security error:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Docker Desktop Tips

- Ensure Docker Desktop is **running** (whale icon in the system tray) before installing
- If Docker commands fail, try restarting Docker Desktop
- WSL 2 backend is recommended over Hyper-V for better performance

### Watchtower on Windows

Watchtower (automatic updates) works on Windows but may require the Docker socket to be exposed. If Watchtower fails to start, you can update manually instead — see [Updating MeticAI](UPDATING.md).

## Updating

```powershell
cd ~\MeticAI
docker compose pull
docker compose up -d
```

See [UPDATING.md](UPDATING.md) for more options including migration from v1.x.

## Uninstalling

```powershell
# Download and run the uninstaller
irm https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/uninstall.ps1 -OutFile uninstall.ps1
.\uninstall.ps1
```

Or manually:

```powershell
cd ~\MeticAI
docker compose down -v   # -v removes data volumes
cd ~
Remove-Item -Recurse -Force MeticAI
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `docker: command not found` | Install [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) and restart your terminal |
| Docker not running | Start Docker Desktop from the Start menu |
| Execution policy error | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
| Can't resolve `meticulous.local` | Use the machine's IP address directly in your `.env` file |
| Container won't start | Run `docker compose logs -f` and check for errors |
| Port 3550 in use | Stop other services on that port, or edit `docker-compose.yml` to change the port mapping |
| Installer exits silently / nothing happens | Do **not** pipe directly with `irm ... \| iex` — use the two-step download shown in Option A above. If the window still closes immediately, open a PowerShell window first, then run `.\install.ps1` from inside it so output stays visible. Alternatively use **Option B (Manual Setup)** — it is equally fast and always works. |

For additional help, see the [main troubleshooting section](README.md#-troubleshooting) or [open an issue](https://github.com/hessius/MeticAI/issues).
