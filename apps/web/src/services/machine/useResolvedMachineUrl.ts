import { useEffect, useState } from 'react'
import { STORAGE_KEYS } from '@/lib/constants'
import { getDefaultMachineUrl } from '@/lib/machineMode'
import { MACHINE_URL_CHANGED, persistMachineUrl, resolveMachineUrl } from './machineUrl'
import { resolveReachableMachineUrl } from './discovery'

/**
 * Reactive hook that tracks the machine URL.
 *
 * Uses synchronous localStorage reads (same as base branch) for instant
 * reactivity, plus an async Capacitor Preferences check on mount so
 * native apps pick up URLs persisted across reinstalls.
 */
export function useResolvedMachineUrl(enabled: boolean): string {
  const [machineUrl, setMachineUrl] = useState<string>(getDefaultMachineUrl)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    // On mount, also check Capacitor Preferences (may have URL not in localStorage)
    resolveMachineUrl()
      .then(async (url) => {
        setMachineUrl(url)
        // Cheap self-heal: if the stored port no longer answers (e.g. a firmware
        // update moved the API :8080 → :80), adopt the reachable port. Bounded
        // to a quick probe of the same host — full rediscovery (IP change) is
        // handled on sustained connection failure by the provider, not here.
        try {
          const reachable = await resolveReachableMachineUrl(url)
          if (reachable && reachable !== url) {
            await persistMachineUrl(reachable)
            setMachineUrl(reachable)
          }
        } catch { /* keep the stored url; a later retry will recover */ }
      })
      .catch(() => {})

    // Sync handler — reads localStorage directly, exactly like the base branch.
    // setMachineUrl() in machineMode.ts writes here before firing the event,
    // so the value is always available synchronously.
    const handler = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEYS.MACHINE_URL)
        if (stored && stored !== machineUrl) setMachineUrl(stored)
      } catch { /* noop */ }
    }
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.MACHINE_URL) handler()
    }

    window.addEventListener(MACHINE_URL_CHANGED, handler)
    window.addEventListener('storage', storageHandler)
    return () => {
      window.removeEventListener(MACHINE_URL_CHANGED, handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [enabled, machineUrl])

  return machineUrl
}
