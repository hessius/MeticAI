import { useState, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

interface TriggerUpdateResponse {
  status: 'success' | 'error'
  output?: string
  message?: string
  error?: string
}

interface StatusResponse {
  update_available: boolean
  last_check?: string
}

interface UseUpdateTriggerReturn {
  triggerUpdate: () => Promise<void>
  isUpdating: boolean
  updateError: string | null
  updateSuccess: boolean
}

// Poll for update completion every 3 seconds
const UPDATE_CHECK_INTERVAL = 3000
// Maximum number of checks (120 checks * 3 seconds = 6 minutes max wait)
const MAX_UPDATE_CHECKS = 120
// Wait before starting to poll to give time for update to start
const INITIAL_UPDATE_WAIT = 5000

export function useUpdateTrigger(): UseUpdateTriggerReturn {
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateSuccess, setUpdateSuccess] = useState(false)

  const checkUpdateStatus = useCallback(async (serverUrl: string): Promise<{ isUp: boolean; updateComplete: boolean }> => {
    try {
      const response = await fetch(`${serverUrl}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      })
      if (!response.ok) {
        return { isUp: false, updateComplete: false }
      }
      const data: StatusResponse = await response.json()
      // Update is complete when server is up AND update_available is false
      return { isUp: true, updateComplete: !data.update_available }
    } catch {
      return { isUp: false, updateComplete: false }
    }
  }, [])

  const waitForUpdateComplete = useCallback(async (serverUrl: string): Promise<boolean> => {
    let checks = 0
    let serverWentDown = false
    
    // Wait a bit for the update process to start
    await new Promise(resolve => setTimeout(resolve, INITIAL_UPDATE_WAIT))

    // Poll until update is complete (server is up and update_available is false)
    while (checks < MAX_UPDATE_CHECKS) {
      const status = await checkUpdateStatus(serverUrl)
      
      // Track if server went down (indicates rebuild is happening)
      if (!status.isUp) {
        serverWentDown = true
      }
      
      if (status.isUp && status.updateComplete) {
        // Give server a moment to stabilize after coming back up
        if (serverWentDown) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
        return true
      }

      checks++
      await new Promise(resolve => setTimeout(resolve, UPDATE_CHECK_INTERVAL))
    }

    return false
  }, [checkUpdateStatus])

  const triggerUpdate = useCallback(async () => {
    setIsUpdating(true)
    setUpdateError(null)
    setUpdateSuccess(false)

    try {
      const serverUrl = await getServerUrl()
      
      // Trigger the update
      const response = await fetch(`${serverUrl}/api/trigger-update`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(
          errorData?.detail?.message || 
          errorData?.message || 
          `Update failed with status ${response.status}`
        )
      }

      const data: TriggerUpdateResponse = await response.json()

      if (data.status === 'error') {
        throw new Error(data.error || data.message || 'Update failed')
      }

      // Wait for update to complete (server comes back up with update_available: false)
      const updateComplete = await waitForUpdateComplete(serverUrl)

      if (!updateComplete) {
        throw new Error('Update did not complete within expected time. Please refresh manually.')
      }

      setUpdateSuccess(true)
      
      // Reload the page to get the new version
      window.location.reload()
    } catch (err) {
      console.error('Error triggering update:', err)
      setUpdateError(err instanceof Error ? err.message : 'Failed to trigger update')
      setIsUpdating(false)
    }
  }, [waitForUpdateComplete])

  return {
    triggerUpdate,
    isUpdating,
    updateError,
    updateSuccess,
  }
}
