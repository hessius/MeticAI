import { STORAGE_KEYS } from '@/lib/constants'
import { getDefaultMachineUrl } from '@/lib/machineMode'
import { capacitorStorage } from '@/services/storage/CapacitorStorage'

export const MACHINE_URL_CHANGED = 'machine-url-changed'

function isNativeRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined
  return !!cap?.isNativePlatform?.()
}

export function getMachineUrlFallback(): string {
  if (typeof window !== 'undefined' && window.location.port === '8080') {
    return `${window.location.protocol}//${window.location.hostname}:8080`
  }
  return 'http://meticulous.local:8080'
}

export async function getStoredMachineUrl(): Promise<string | null> {
  return capacitorStorage.get(STORAGE_KEYS.MACHINE_URL)
}

export async function resolveMachineUrl(): Promise<string> {
  const envUrl = import.meta.env.VITE_DEFAULT_MACHINE_URL
  if (envUrl) return envUrl

  const stored = await getStoredMachineUrl()
  if (stored) return stored

  if (isNativeRuntime()) return getMachineUrlFallback()

  return getDefaultMachineUrl()
}

export async function persistMachineUrl(url: string): Promise<void> {
  await capacitorStorage.set(STORAGE_KEYS.MACHINE_URL, url)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MACHINE_URL_CHANGED))
  }
}
