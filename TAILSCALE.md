# 🌐 Remote Access with Tailscale

Access MeticAI securely from anywhere — your phone on mobile data, a laptop at a café, or another location entirely. Tailscale creates an encrypted overlay network so your MeticAI instance is reachable without exposing it to the public internet.

## How It Works

MeticAI runs a **Tailscale sidecar container** alongside the main container. The sidecar joins your Tailscale network (called a "tailnet") and serves the MeticAI web UI over HTTPS with a valid TLS certificate.

```
Your phone (Tailscale app)  ──── encrypted tunnel ────  MeticAI (Tailscale sidecar)
                                                               │
                                                               ▼
                                                         MeticAI Web UI
                                                          (port 3550)
```

## Prerequisites

1. A **free Tailscale account** — [Sign up here](https://login.tailscale.com/start)
2. **Tailscale installed on your client devices** (the devices you want to access MeticAI from):
   - **iPhone/iPad**: [App Store](https://apps.apple.com/app/tailscale/id1470499037)
   - **Android**: [Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)
   - **Mac**: [App Store](https://apps.apple.com/app/tailscale/id1475387142) or `brew install tailscale`
   - **Windows**: [Download](https://tailscale.com/download/windows)
   - **Linux**: [Install guide](https://tailscale.com/download/linux)
3. A **Tailscale auth key** — [Generate one here](https://login.tailscale.com/admin/settings/keys)
   - Check **"Reusable"** if you want the key to survive container restarts
   - Check **"Ephemeral"** if you want the device to auto-remove when it disconnects

## Setup

### Option A: During Installation

If you use the install script, it will ask whether to enable Tailscale:

```
Enable Tailscale for remote access? (y/N): y
Tailscale Auth Key: tskey-auth-xxxxx
```

### Option B: Add to an Existing Installation

```bash
cd ~/.meticai   # or wherever MeticAI is installed

# 1. Add your auth key to .env
echo "TAILSCALE_AUTHKEY=tskey-auth-xxxxx" >> .env

# 2. Start with the Tailscale overlay
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

### Option C: Enable via the Web UI

1. Open MeticAI in your browser (`http://<server-ip>:3550`)
2. Go to **Settings**
3. Enter your Tailscale auth key
4. Toggle **Tailscale** on
5. Restart the container when prompted

## Enable HTTPS (Recommended)

Tailscale can automatically provision TLS certificates for your MeticAI instance, giving you a valid `https://` URL.

1. Go to the [Tailscale Admin Console](https://login.tailscale.com/admin/dns)
2. Under **DNS**, click **Enable HTTPS**
3. Restart the Tailscale sidecar to pick up the change:

```bash
cd ~/.meticai
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml restart tailscale
```

Your MeticAI will now be available at:
```
https://meticai.<your-tailnet-name>.ts.net
```

You can find the exact URL in the [Tailscale Admin Console → Machines](https://login.tailscale.com/admin/machines).

## Accessing MeticAI Remotely

> **Important:** Both the MeticAI server and your client device must have Tailscale installed and connected to the **same Tailscale account**.

1. Make sure Tailscale is running on your phone/laptop
2. Open `https://meticai.<your-tailnet-name>.ts.net` in your browser
3. That's it! The connection is end-to-end encrypted

### Why can't I just use the `.ts.net` URL without Tailscale on my device?

Tailscale DNS names (`.ts.net`) only resolve for devices that are part of your tailnet. This is by design — it's what makes Tailscale secure. Unlike port-forwarding or exposing a public URL, only your authorized devices can reach MeticAI.

## Verifying It's Working

### From the MeticAI Web UI

Go to **Settings** — the Tailscale status section shows:
- **Connected**: ✅
- **IP**: Your Tailscale IP (e.g., `100.x.y.z`)
- **Hostname**: `meticai`

### From the Command Line

```bash
# Check the Tailscale sidecar is running
docker ps | grep tailscale

# Check Tailscale status via the API
curl http://localhost:3550/api/tailscale-status
```

### From the Tailscale Admin Console

Visit [Machines](https://login.tailscale.com/admin/machines) — you should see a device called **meticai** with a green "Connected" indicator.

## Troubleshooting

### "Server not found" when visiting the `.ts.net` URL

- **Is Tailscale running on your client device?** The `.ts.net` domain only resolves within your tailnet. Install and connect Tailscale on the device you're browsing from.
- **Is the MeticAI Tailscale sidecar connected?** Check `docker logs meticai-tailscale` — look for `Switching ipn state Starting -> Running`.
- **Did you enable HTTPS?** The serve config routes HTTPS (port 443). If HTTPS is not enabled in the admin console, the sidecar can't issue TLS certs.

### "Not able to issue TLS certs"

Enable HTTPS in the [Tailscale Admin Console → DNS](https://login.tailscale.com/admin/dns) and restart the sidecar:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml restart tailscale
```

### Auth key expired

Tailscale auth keys have an expiration (default: 90 days). If the sidecar can't connect:
1. Generate a new key at [https://login.tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys)
2. Update `.env` with the new key
3. Remove the old state and restart:

```bash
docker volume rm meticai-tailscale-state
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

### Sidecar keeps restarting

Check logs: `docker logs meticai-tailscale`. Common causes:
- Invalid auth key
- Network issues reaching Tailscale's coordination server

## Combining with Other Overlays

You can stack all compose overlays:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.tailscale.yml \
  -f docker-compose.watchtower.yml \
  -f docker-compose.homeassistant.yml \
  up -d
```

## Security Notes

- Tailscale connections are **end-to-end encrypted** (WireGuard)
- Your MeticAI instance is **never exposed to the public internet**
- Only devices on your tailnet can reach MeticAI
- The Tailscale auth key is stored in your `.env` file — keep it private
- The sidecar runs in userspace mode (`TS_USERSPACE=true`) — no kernel module needed
