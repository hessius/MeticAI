# 🔄 Updating MeticAI

## Quick Update (v2.x)

```bash
cd ~/MeticAI
docker compose pull
docker compose up -d
```

That's it. Your data and settings are preserved.

## Automatic Updates with Watchtower

If you enabled Watchtower during installation, MeticAI checks for updates every 6 hours and updates automatically. No action needed.

**Check if Watchtower is running:**

```bash
docker ps | grep watchtower
```

**Enable Watchtower on an existing installation:**

```bash
cd ~/MeticAI
docker compose -f docker-compose.yml -f docker-compose.watchtower.yml up -d
```

## When Auto-Update Didn't Work

If your MeticAI instance is outdated and Watchtower didn't update it (or you don't have Watchtower), try these options in order:

### Option A: Update from the Web UI

1. Open MeticAI in your browser (`http://<server-ip>:3550`)
2. Go to **Settings**
3. Look for the update notification or version info
4. Click **Check for Updates** / **Update** if available

### Option B: Run `update.sh`

```bash
cd ~/MeticAI
./update.sh
```

This script pulls the latest image and restarts containers. It also handles v1.x → v2.0 migration automatically.

### Option C: Manual Pull

```bash
cd ~/MeticAI
docker compose pull
docker compose up -d
```

If you use compose overlays (Tailscale, Watchtower, Home Assistant), include them:

```bash
docker compose -f docker-compose.yml -f docker-compose.watchtower.yml -f docker-compose.tailscale.yml pull
docker compose -f docker-compose.yml -f docker-compose.watchtower.yml -f docker-compose.tailscale.yml up -d
```

**Tip:** If your `.env` has `COMPOSE_FILES` set (the installer does this), use:

```bash
source .env
docker compose ${COMPOSE_FILES} pull
docker compose ${COMPOSE_FILES} up -d
```

## Migrating from v1.x to v2.0

MeticAI v2.0 is a complete rewrite — from multiple containers to a single unified container. Migration is handled automatically in most cases.

### Automatic Migration (Recommended)

If you installed v1.x via `git clone`:

```bash
cd ~/MeticAI
git pull
./update.sh
```

The `update.sh` script detects v1.x artifacts and runs a full migration:
- Preserves your `.env` settings (API key, machine IP, Tailscale key)
- Stops and removes old containers
- Removes the host-side rebuild-watcher service
- Cleans up old source directories
- Pulls and starts the v2.0 container
- Enables Watchtower for future automatic updates

### Fresh Install Over v1.x

If automatic migration fails or you prefer a clean start:

```bash
# 1. Back up your config
cp ~/MeticAI/.env ~/meticai-backup.env

# 2. Remove old installation
cd ~/MeticAI
docker compose down -v
cd ~ && rm -rf MeticAI

# 3. Fresh install
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash

# 4. Or clone and start manually
git clone https://github.com/hessius/MeticAI.git
cd MeticAI
cp ~/meticai-backup.env .env
docker compose up -d
```

### What Changed in v2.0

| Aspect | v1.x | v2.0 |
| ------ | ---- | ---- |
| Containers | 4+ separate containers | 1 unified container |
| Process manager | Docker Compose only | s6-overlay inside container |
| Updates | Manual git pull + rebuild | Docker image pull (or Watchtower) |
| Web UI | Basic React app | Full-featured React + shadcn/ui |
| MQTT/Telemetry | Not included | Built-in bridge + live dashboard |
| Home Assistant | Not supported | MQTT auto-discovery |

## Troubleshooting Updates

### Container won't start after update

```bash
# Check logs
docker logs meticai -f

# Nuclear option: clean restart
docker compose down -v
docker compose pull
docker compose up -d
```

> **Warning:** `docker compose down -v` removes data volumes. Back up first if you have important profiles or history.

### Image pull fails

```bash
# Check disk space
df -h

# Remove old images to free space
docker image prune -f

# Try again
docker compose pull
```

### Version check

```bash
curl http://localhost:3550/api/version
```
