import { useEffect, useState } from 'react'
import { STORAGE_KEYS } from '@/lib/constants'
import { getDefaultMachineUrl } from '@/lib/machineMode'
import { getMachineUrlFallback, MACHINE_URL_CHANGED, resolveMachineUrl } from './machineUrl'

export function useResolvedMachineUrl(enabled: boolean): string {
  const [machineUrl, setMachineUrl] = useState<string>(() =>
    enabled ? getMachineUrlFallback() : getDefaultMachineUrl()
  )

  useEffect(() => {
    let cancelled = false

    const loadMachineUrl = async () => {
      if (!enabled) {
        if (!cancelled) setMachineUrl(getDefaultMachineUrl())
        return
      }

      try {
        const resolved = await resolveMachineUrl()
        if (!cancelled) setMachineUrl(resolved)
      } catch (err) {
        console.warn('[MachineService] Failed to resolve machine URL:', err)
        if (!cancelled) setMachineUrl(getMachineUrlFallback())
      }
    }

    void loadMachineUrl()

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true
      }
    }

    const handler = () => {
      void loadMachineUrl()
    }
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.MACHINE_URL) handler()
    }

    window.addEventListener(MACHINE_URL_CHANGED, handler)
    window.addEventListener('storage', storageHandler)

    return () => {
      cancelled = true
      window.removeEventListener(MACHINE_URL_CHANGED, handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [enabled])

  return machineUrl
}
