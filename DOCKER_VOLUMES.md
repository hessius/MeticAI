# Docker Volume Mounts Documentation

## Overview

This document describes each volume mount in `docker-compose.yml` for the `meticai-server` container, explaining its purpose, security implications, and whether it's essential.

## Volume Mounts Analysis

### Essential Data Volumes

| Mount | Purpose | Essential | Security Risk |
|-------|---------|-----------|---------------|
| `./data:/app/data` | Persistent profile history and settings | ✅ Yes | Low - Data only |
| `./logs:/app/logs` | Log file persistence | ✅ Yes | Low - Read-only data |
| `./.env:/app/.env:ro` | Environment configuration | ✅ Yes | Medium - Contains API keys |
| `./VERSION:/VERSION:ro` | Version information for API | ✅ Yes | Low - Read-only |

### Update & Rebuild Infrastructure

| Mount | Purpose | Essential | Security Risk |
|-------|---------|-----------|---------------|
| `/var/run/docker.sock:/var/run/docker.sock` | Container rebuild capability | ⚠️ Yes | **High - Full Docker access** |
| `./update.sh:/app/update.sh:ro` | Trigger updates from API | ✅ Yes | Medium - Script execution |
| `./.update-config.json:/app/.update-config.json:ro` | Update configuration | ✅ Yes | Low - Config only |
| `./docker-compose.yml:/app/docker-compose.yml:ro` | Container rebuild | ✅ Yes | Low - Read-only |
| `./meticai-server:/app/meticai-server:ro` | Source code for rebuild | ✅ Yes | Low - Read-only |
| `./gemini-client:/app/gemini-client:ro` | Source code for rebuild | ✅ Yes | Low - Read-only |

### Signal Files (Host-Side Watcher Communication)

| Mount | Purpose | Essential | Security Risk |
|-------|---------|-----------|---------------|
| `./.rebuild-needed:/app/.rebuild-needed` | Signal container rebuild needed | ✅ Yes | Low - Flag file |
| `./.update-check-requested:/app/.update-check-requested` | Signal update check | ✅ Yes | Low - Flag file |
| `./.update-requested:/app/.update-requested` | Signal full update | ✅ Yes | Low - Flag file |
| `./.restart-requested:/app/.restart-requested` | Signal restart | ✅ Yes | Low - Flag file |
| `./.rebuild-watcher.log:/app/.rebuild-watcher.log:ro` | Watcher status for API | ✅ Yes | Low - Read-only log |

### Version Tracking

| Mount | Purpose | Essential | Security Risk |
|-------|---------|-----------|---------------|
| `./.versions.json:/app/.versions.json` | Track component versions | ✅ Yes | Low - Version data |
| `./.git:/app/.git` | Git repository for version info | ⚠️ Optional | **Medium - Repository access** |

### External Dependencies

| Mount | Purpose | Essential | Security Risk |
|-------|---------|-----------|---------------|
| `./meticulous-source:/app/meticulous-source` | MCP source for updates | ✅ Yes | Low - Dependency code |
| `./meticai-web:/app/meticai-web` | Web app for updates | ✅ Yes | Low - Frontend code |

## Security Recommendations

### High Risk - Requires Justification

**`/var/run/docker.sock`**
- **Risk**: Grants full Docker daemon access (can create/destroy any container, access host)
- **Justification**: Required for container rebuild via update system
- **Mitigation**: 
  - Container runs as non-root
  - Only specific rebuild operations performed
  - Could be replaced with external orchestration (future improvement)

### Medium Risk - Review Recommended

**`./.git`**
- **Risk**: Exposes full git repository history
- **Justification**: Used for version information and update checks
- **Recommendation**: ⚠️ Consider removing and using `VERSION` file only
- **Alternative**: Use shallow git operations or read git info at build time

**`./.env`**
- **Risk**: Contains API keys and sensitive configuration
- **Justification**: Required for runtime configuration
- **Mitigation**: Mounted as read-only (`:ro`)
- **Best Practice**: Ensure `.env` has restrictive permissions (600)

## Mount Categories

### Critical (Cannot run without these)
- `/var/run/docker.sock` - Update system
- `./data` - Persistent data
- `./.env` - Configuration
- `./VERSION` - Version info

### Operational (Needed for full functionality)
- `./logs` - Logging
- `./update.sh` - Updates
- Signal files (`.rebuild-needed`, etc.)
- Dependency mounts (`meticulous-source`, `meticai-web`)

### Optional (Can be removed with minor feature loss)
- `./.git` - Can use VERSION file instead
- `./.rebuild-watcher.log` - Nice to have for status

## Proposed Optimizations

### 1. Remove `.git` Mount
```yaml
# Instead of mounting .git, use VERSION file only
# Update version endpoint to rely solely on VERSION files
```

**Impact**: Loss of git commit information in version endpoint
**Benefit**: Reduced security exposure

### 2. Consolidate Signal Files
```yaml
# Create a signals directory
./signals:/app/signals
  # Contains: rebuild-needed, update-requested, etc.
```

**Impact**: Need to update signal file paths
**Benefit**: Cleaner docker-compose.yml

### 3. Read-Only by Default
All source code mounts are already read-only (`:ro`). This is good practice.

## Current Mount Count

- **Total Mounts**: 20
- **Read-Only**: 9
- **Read-Write**: 11
- **High Risk**: 1 (docker.sock)
- **Medium Risk**: 2 (.env, .git)
- **Low Risk**: 17

## Recommendations Summary

1. ✅ **Keep current structure** - All mounts serve a purpose
2. ⚠️ **Consider removing `.git`** - Use VERSION file only
3. ✅ **Document `.env` permissions** - Should be 600
4. ✅ **Review docker.sock usage** - Consider alternatives for updates
5. ⚠️ **Consider grouping signals** - Single directory for flags

## Best Practices Applied

✅ Read-only mounts where possible (`:ro`)
✅ Explicit mount purposes documented
✅ Security implications identified
✅ Minimal write permissions
✅ No unnecessary host system access

---

**Document Version**: 1.0
**Last Updated**: 2026-02-08
**Review Status**: Initial documentation complete
