# Testing the Update Functionality

This document describes how to test the update functionality implemented in this PR.

## Prerequisites

To fully test the update functionality, you need:

1. A running MeticAI backend server with the `/status` and `/api/trigger-update` endpoints
2. The MeticAI-web frontend running and connected to the backend

## Automatic Update Detection

The app automatically checks for updates:

1. **On Load**: When the app first loads, it checks for updates
2. **Periodic**: Every 5 minutes, it polls the `/status` endpoint

To see this in action:
- Open the browser console
- Look for requests to `http://localhost:5000/status` (or your configured server URL)
- If the backend returns `{ "update_available": true }`, the update banner will appear

## Update Banner States

### 1. Update Available State

When an update is available, you'll see a **green banner** at the top with:
- Green download icon
- "Update Available" heading
- "A new version of MeticAI is ready to install" description
- **"Update Now"** button (green)
- Dismiss button (X)

**To test manually:**
- Configure your backend to return `{ "update_available": true }` from `/status`
- Reload the app
- The banner should appear within 5 seconds

### 2. Updating State

When the update is in progress, the banner shows:
- Spinning refresh icon
- "Updating MeticAI..." heading
- Progress bar (0-95%)
- Status messages that change as progress increases:
  - "Starting update..." (0-30%)
  - "Pulling latest updates..." (30-60%)
  - "Rebuilding containers..." (60-80%)
  - "Restarting services..." (80%+)
- Informational text about automatic refresh

**To test manually:**
- Click "Update Now" when update is available
- The banner transitions to updating state
- Progress bar animates over ~3 minutes (or until server restarts)
- Server health is polled every 3 seconds

### 3. Error State

If the update fails, the banner shows:
- Red warning icon
- "Update Failed" heading
- Error message details
- **"Retry"** button
- **"Dismiss"** button

**To test manually:**
- Configure backend to return an error from `/api/trigger-update`
- Click "Update Now"
- Error banner should appear with details

## Update Process Flow

1. **User clicks "Update Now"**
   - POST request sent to `/api/trigger-update`
   - Banner transitions to "Updating" state
   - Progress bar starts animating

2. **Backend processes update**
   - Runs `update.sh --auto` on the server
   - Pulls latest code
   - Rebuilds containers
   - Restarts services

3. **Frontend monitors server health**
   - Waits 2 seconds for server to start shutdown
   - Polls `/status` endpoint every 3 seconds
   - Max 60 attempts (3 minutes total)

4. **Server restarts**
   - When `/status` returns 200 OK, server is back
   - Frontend waits 1 more second for stability
   - Page automatically reloads

5. **User sees new version**
   - Fresh page load with updated code
   - Update banner no longer appears (unless another update is available)

## Toast Notifications

Throughout the process, toast notifications appear:
- "Starting update process..." when update begins
- "Update notification dismissed" when user dismisses banner
- Error toasts if something goes wrong

## Configuration

The update check interval and timeouts can be adjusted in:

- `src/hooks/useUpdateStatus.ts`:
  - `CHECK_INTERVAL_MINUTES`: How often to check for updates (default: 5 minutes)

- `src/hooks/useUpdateTrigger.ts`:
  - `HEALTH_CHECK_INTERVAL`: How often to poll server health (default: 3 seconds)
  - `MAX_HEALTH_CHECKS`: Maximum health check attempts (default: 60 = 3 minutes)
  - `INITIAL_SHUTDOWN_WAIT`: Wait before starting health checks (default: 2 seconds)
  - `SERVER_STABILIZATION_WAIT`: Wait after server is back (default: 1 second)

- `src/components/UpdateBanner.tsx`:
  - `MAX_UPDATE_DURATION`: Maximum expected update time for progress bar (default: 3 minutes)
  - `PROGRESS_UPDATE_INTERVAL`: Progress bar update frequency (default: 500ms)

## Backend Requirements

Your backend must implement:

1. **GET /status** - Returns update status:
   ```json
   {
     "update_available": true,
     "last_check": "2026-01-14T21:00:00Z",
     "repositories": {
       "meticai": { "current_hash": "abc123..." },
       "meticulous-mcp": { "current_hash": "def456..." },
       "meticai-web": { "current_hash": "ghi789..." }
     }
   }
   ```

2. **POST /api/trigger-update** - Triggers update process:
   - Success response:
     ```json
     {
       "status": "success",
       "output": "... script output ...",
       "message": "Update script completed successfully"
     }
     ```
   - Error response (500):
     ```json
     {
       "detail": {
         "status": "error",
         "error": "... error message ...",
         "message": "Update script failed"
       }
     }
     ```

## Error Handling

The implementation gracefully handles:

- **Backend not available**: No banner shown, errors logged to console
- **Network errors during update check**: Silent failure, retries on next interval
- **Update trigger fails**: Error banner with retry option
- **Server doesn't restart in time**: Error message tells user to refresh manually
- **User dismisses banner**: Banner hidden until next check cycle (5 minutes)

## Manual Testing Checklist

- [ ] App loads without errors
- [ ] Update check runs on load (check console)
- [ ] Update banner appears when update is available
- [ ] "Update Now" button triggers update process
- [ ] Progress bar animates during update
- [ ] Status messages change as progress increases
- [ ] Server health polling occurs every 3 seconds
- [ ] Page auto-refreshes when server is back
- [ ] Error state displays correctly when update fails
- [ ] Retry button works in error state
- [ ] Dismiss button hides the banner
- [ ] Toast notifications appear at appropriate times
- [ ] No console errors during any state

## Notes

- The update banner is positioned at the top of the viewport with `fixed` positioning
- It animates smoothly with framer-motion
- The component is responsive and works on mobile devices
- All timing values use named constants for easy adjustment
- No magic numbers in the code (all values are named constants with comments)
