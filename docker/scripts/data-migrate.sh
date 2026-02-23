#!/bin/sh
# ==============================================================================
# MeticAI — Legacy Data Migration (v1.x → v2.0)
# ==============================================================================
# Called by the s6-rc data-migrate oneshot on container boot.
# If /legacy-data contains files from a v1.x host-directory install,
# they are copied into the Docker-managed /data volume.
#
# Idempotent: skips files that already exist in /data.
# ==============================================================================

LEGACY="/legacy-data"
TARGET="/data"
MARKER="$TARGET/.migrated-from-v1"

# --- Guard: nothing to do ---------------------------------------------------
if [ ! -d "$LEGACY" ]; then
    echo "data-migrate: /legacy-data not mounted — nothing to do"
    exit 0
fi

# Check if there are any real files (not just empty dir Docker creates)
file_count=$(find "$LEGACY" -maxdepth 1 \( -type f -o -type d -mindepth 1 \) 2>/dev/null | wc -l)
if [ "$file_count" -eq 0 ]; then
    echo "data-migrate: /legacy-data is empty — nothing to do"
    exit 0
fi

# If we already migrated, skip
if [ -f "$MARKER" ]; then
    echo "data-migrate: already migrated — skipping"
    exit 0
fi

# --- Migrate -----------------------------------------------------------------
echo "data-migrate: found legacy v1.x data — migrating to Docker volume..."

migrated=0
skipped=0

for src in "$LEGACY"/*; do
    [ -e "$src" ] || continue
    name=$(basename "$src")

    # Skip files/dirs that are not useful
    case "$name" in
        __pycache__|*.pyc|*.log|.DS_Store) continue ;;
    esac

    dst="$TARGET/$name"

    if [ -e "$dst" ]; then
        skipped=$((skipped + 1))
    else
        if cp -a "$src" "$dst" 2>/dev/null; then
            migrated=$((migrated + 1))
            echo "data-migrate:   copied $name"
        else
            echo "data-migrate:   WARN: failed to copy $name"
        fi
    fi
done

echo "data-migrate: complete — migrated=$migrated skipped=$skipped"

# Leave a breadcrumb so we don't re-run
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$MARKER"
