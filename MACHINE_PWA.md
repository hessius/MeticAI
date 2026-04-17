# MeticAI — Machine-Hosted PWA (Beta)

Run MeticAI directly on your Meticulous machine — no server, no Docker, no cloud. Just your machine and a browser.

> **Status:** Beta — testing on `feat/machine-hosted-pwa` branch.

## What This Is

A lightweight version of MeticAI that runs as static files on the Meticulous machine itself. Your browser talks directly to the machine's API — no MeticAI backend needed.

**What works:**
- Profile catalogue (browse, run, delete, rename)
- Pour Over mode (free, ratio, recipe)
- Live telemetry (weight, flow, pressure)
- Shot history
- Dial-In assistant
- Run schedules
- AI features (bring your own Gemini API key)
- Add to home screen (PWA)

## Requirements

- A Meticulous espresso machine (any model)
- SSH access to the machine (see your machine's official documentation for credentials; prefer SSH key-based access)
- A device on the same network (phone, tablet, laptop)

## Quick Install

SSH into your machine and run a single command:

```bash
python3 -c "import urllib.request,sys; sys.stdout.buffer.write(urllib.request.urlopen(sys.argv[1]).read())" \
  https://raw.githubusercontent.com/hessius/MeticAI/feat/machine-hosted-pwa/scripts/install-direct.sh | bash
```

This will:
1. Download the latest pre-built PWA files (~2 MB)
2. Install to `/opt/meticai-web/`
3. Patch the machine's web server to serve MeticAI at `/meticai/`
4. Restart the backend

Then open: **http://`<your-machine>`.local:8080/meticai/**

> **Finding your machine's address:** Your machine's hostname is printed at the end of installation. It's usually something like `meticulousFlatWhite.local` or `meticulous-abc123.local`. Alternatively, check your router's connected devices for the machine's IP and use `http://<ip>:8080/meticai/`.

## Step-by-Step Install

If you prefer to do it manually:

### 1. Find your machine

Your Meticulous machine is on your local network. Find its IP address from your router's admin page, or try:

```bash
# macOS
dns-sd -B _http._tcp local.

# Linux
avahi-browse -art | grep meticulous
```

### 2. SSH into the machine

```bash
ssh root@<machine-ip>
# See your machine's documentation for the default password, or use SSH key auth
```

### 3. Download and run the installer

```bash
# Download the installer
python3 -c "import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/hessius/MeticAI/feat/machine-hosted-pwa/scripts/install-direct.sh', '/tmp/install-direct.sh')"

# Download the pre-built PWA
python3 -c "import urllib.request; urllib.request.urlretrieve('https://github.com/hessius/MeticAI/releases/download/latest/meticai-web.tar.gz', '/tmp/meticai-web.tar.gz')"

# Run the installer with the local tarball
bash /tmp/install-direct.sh --local /tmp/meticai-web.tar.gz
```

> **Note:** During beta, releases may not be available yet. Download the latest CI build artifact instead — see [Using CI Artifacts](#using-ci-artifacts) below.

### 4. Open MeticAI

Navigate to `http://<machine-ip>:8080/meticai/` in any browser.

**Pro tip:** Add it to your phone's home screen for an app-like experience:
- **iOS:** Safari → Share → Add to Home Screen
- **Android:** Chrome → Menu → Add to Home Screen

## Using CI Artifacts

During the beta, the easiest way to get pre-built files without building yourself:

1. Go to [GitHub Actions — Build Machine PWA](https://github.com/hessius/MeticAI/actions/workflows/build-machine-pwa.yml)
2. Click the latest successful run on the `feat/machine-hosted-pwa` branch
3. Download the **meticai-web** artifact (zip file)
4. Unzip it — you'll get `meticai-web.tar.gz`
5. Copy to your machine and install:

```bash
# From your computer
scp meticai-web.tar.gz root@<machine-ip>:/tmp/
ssh root@<machine-ip> 'bash /tmp/install-direct.sh --local /tmp/meticai-web.tar.gz'
```

Or as a one-liner (after copying the tarball):

```bash
scp meticai-web.tar.gz root@<machine-ip>:/tmp/ && ssh root@<machine-ip> "python3 -c \"import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/hessius/MeticAI/feat/machine-hosted-pwa/scripts/install-direct.sh', '/tmp/install-direct.sh')\" && bash /tmp/install-direct.sh --local /tmp/meticai-web.tar.gz"
```

## AI Features (Optional)

MeticAI can generate espresso profiles and analyze shots using Google Gemini. In machine-hosted mode, this runs entirely in your browser — your API key never leaves your device.

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Open MeticAI → Settings → Enter your Gemini API key
3. The key is stored in your browser's local storage — not on the machine

## Updating

Re-run the install command. The installer handles replacing the previous version automatically.

```bash
ssh root@<machine-ip>
python3 -c "import urllib.request,sys; sys.stdout.buffer.write(urllib.request.urlopen(sys.argv[1]).read())" \
  https://raw.githubusercontent.com/hessius/MeticAI/feat/machine-hosted-pwa/scripts/install-direct.sh | bash
```

## Uninstalling

```bash
ssh root@<machine-ip>
rm -rf /opt/meticai-web /opt/meticai-web.bak.*
```

The Tornado route patch is harmless if the files are removed — it will just show a 404.

## Troubleshooting

**"Connection refused" or page won't load**
- Make sure you're on the same network as the machine
- Try the IP address directly instead of `.local` hostname
- Verify the machine is on: `ping <machine-ip>`

**Profiles don't load / empty catalogue**
- The machine may still be starting up. Wait 30 seconds and refresh.
- Check that the machine is connected to your network

**"Gemini API key not configured"**
- This only affects AI features (profile generation, shot analysis)
- Go to Settings and enter your key, or ignore — everything else works without it

**Scale shows wrong weight**
- Tap "Tare" to zero the scale
- This is normal — the machine's scale may drift slightly

**Can't add to home screen**
- iOS: Must use Safari (not Chrome)
- Android: Must use Chrome (not Firefox)
