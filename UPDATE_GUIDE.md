# MeticAI Update System

This document provides a quick reference for the MeticAI update system.

## Quick Start

```bash
# Check for updates
./update.sh --check-only

# Apply updates
./update.sh

# Auto-update (non-interactive, great for automation)
./update.sh --auto
```

## What Gets Updated?

The update system manages three components:

1. **MeticAI Main Repository** - The core application
2. **Meticulous MCP** - The machine control protocol server
3. **MeticAI Web Interface** - The web-based user interface

## Features

### 1. Update Checking
- Checks git repositories for new commits
- Compares local vs. remote commit hashes
- Displays clear status for each component
- Non-invasive - doesn't modify anything in check-only mode

### 2. Dependency Management
- Automatically clones missing dependencies
- Updates existing dependencies to latest version
- Preserves your `.env` configuration
- **Automatic repository switching** based on central configuration

### 3. Automatic Repository Switching
- Repository URLs controlled centrally via `.update-config.json`
- Maintainers can switch all users to new repositories without manual intervention
- Automatic detection and switching during updates
- Backups created before switching
- Works seamlessly in both interactive and auto mode

### 4. Container Management
- Optionally rebuilds Docker containers after updates
- Restarts services with updated code
- Handles docker compose versions automatically

### 4. API Integration
- `/status` endpoint returns update availability
- JSON response with detailed version information
- CORS-enabled for web app integration
- Lightweight and fast

### 5. Startup Notifications
- Automatically checks for updates on container start
- Displays notification banner if updates available
- Non-blocking background check
- Doesn't slow down startup

## Command Reference

### Update Script Options

| Option | Description |
|--------|-------------|
| `--check-only` | Check for updates without applying them |
| `--auto` | Run non-interactively (auto-accept all prompts) |
| `--switch-mcp-repo` | Check and apply central repository configuration |
| `--help` | Show help message |

**Note on Repository Switching:** The `--switch-mcp-repo` option is now primarily for manual checking. Repository switching happens **automatically** based on the central `.update-config.json` file when you run normal updates.

### Examples

**Check what updates are available:**
```bash
./update.sh --check-only
```

**Apply updates interactively:**
```bash
./update.sh
# You'll be asked:
# - Whether to apply updates
# - Whether to rebuild containers
```

**Apply updates automatically (CI/CD):**
```bash
./update.sh --auto
# No prompts, applies all updates and rebuilds
# Automatically switches repositories based on central config
```

**Check repository configuration:**
```bash
./update.sh --switch-mcp-repo
# Checks and applies central repository configuration
# Note: This happens automatically during normal updates
```

## Automatic Repository Switching

### For Users

Repository switching is now **fully automatic**. When you run `./update.sh`, the script:

1. Fetches the central configuration from `.update-config.json`
2. Compares your current repository URL with the preferred one
3. Automatically switches if they differ (with confirmation in interactive mode)
4. Rebuilds containers with the new repository

You don't need to do anything special - just run your regular updates!

### For Maintainers

To switch all users to a different MCP repository (e.g., when the fork merges upstream):

1. **Edit `.update-config.json` in the main repository:**
```json
{
  "version": "1.0",
  "mcp_repo_url": "https://github.com/meticulous/meticulous-mcp.git",
  "description": "Central configuration for MeticAI update script",
  "last_updated": "2026-01-13T20:47:00Z"
}
```

2. **Commit and push the change:**
```bash
git add .update-config.json
git commit -m "Switch to main MCP repository"
git push
```

3. **That's it!** When users run `./update.sh` or `./update.sh --auto`, they will:
   - Fetch the updated configuration
   - See a notification about the repository change
   - Automatically switch to the new repository (with confirmation in interactive mode)
   - Have their containers rebuilt with the new dependency

**Benefits:**
- No user intervention required (in auto mode)
- Centralized control
- Safe backups created automatically
- Works with CI/CD pipelines

## API Endpoint

### GET /status

Check for updates programmatically.

**Request:**
```bash
curl http://YOUR_PI_IP:8000/status
```

**Response:**
```json
{
  "update_available": true,
  "last_check": "2026-01-13T19:45:00Z",
  "repositories": {
    "meticai": {
      "current_hash": "abc123...",
      "last_updated": "2026-01-13T19:00:00Z"
    },
    "meticulous-mcp": {
      "current_hash": "def456...",
      "repo_url": "https://github.com/manonstreet/meticulous-mcp.git",
      "last_updated": "2026-01-13T18:00:00Z"
    },
    "meticai-web": {
      "current_hash": "ghi789...",
      "last_updated": "2026-01-13T17:00:00Z"
    }
  }
}
```

## Version Tracking

Updates are tracked in `.versions.json`:
- **Automatically generated** - Created on first run
- **Git-ignored** - Won't be committed to repository
- **JSON format** - Easy to parse programmatically
- **Timestamps** - Last check and update times
- **Commit hashes** - Precise version tracking

## Troubleshooting

### "Updates are available" but nothing changed

This is expected when:
- Dependencies aren't installed yet (`meticulous-source` or `meticai-web` missing)
- Remote repository has new commits
- Repository URL has changed

Solution: Run `./update.sh` without `--check-only` to apply updates.

### Update script fails to pull changes

Possible causes:
- Local modifications to dependency repositories
- Network connectivity issues
- Invalid git repository state

Solutions:
1. Check network connection
2. Manually inspect dependency directories
3. Delete and re-clone: `rm -rf meticulous-source && ./update.sh`

### Container rebuild fails

If `docker compose up --build` fails:
- Check Docker is running
- Ensure you have sudo permissions (or are in docker group)
- Review Docker logs: `docker compose logs`

### Version file is corrupted

The update script handles this gracefully:
- Malformed JSON won't crash the script
- Script will create valid JSON on next successful run
- To reset: `rm .versions.json && ./update.sh --check-only`

## Integration Examples

### Web Application Polling

```javascript
async function checkForUpdates() {
  try {
    const response = await fetch('http://YOUR_PI_IP:8000/status');
    const data = await response.json();
    
    if (data.update_available) {
      showNotification('Updates available!', 'Run ./update.sh to update');
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
  }
}

// Check every hour
setInterval(checkForUpdates, 3600000);
```

### Automated Updates (Cron)

```bash
# Add to crontab to check daily at 3 AM
0 3 * * * cd /path/to/MeticAI && ./update.sh --check-only >> /var/log/meticai-updates.log 2>&1
```

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: Update dependencies
  run: |
    cd MeticAI
    ./update.sh --auto
```

## Best Practices

1. **Check before updating**: Always run `--check-only` first
2. **Backup .env**: Your configuration is preserved, but backup is good practice
3. **Test after update**: Verify services are running after update
4. **Review changes**: Check what changed in updated repositories
5. **Monitor logs**: Use `docker compose logs -f` to monitor after rebuild

## Security Considerations

- Update script requires sudo for Docker operations
- Only clones from known repository URLs
- Doesn't modify `.env` file
- Creates backups when switching repositories
- All operations are logged in update output

## Files Created

| File | Purpose | Git Status |
|------|---------|------------|
| `update.sh` | Main update script | Tracked |
| `check-updates-on-start.sh` | Startup notification | Tracked |
| `.versions.json` | Version tracking | Ignored |
| `tests/test_update.bats` | Test suite | Tracked |

## Support

If you encounter issues:
1. Check this document first
2. Review logs: `docker compose logs`
3. Run with verbose output: `bash -x update.sh --check-only`
4. Open an issue on GitHub with logs

## License

Same as MeticAI main project - see LICENSE file.
