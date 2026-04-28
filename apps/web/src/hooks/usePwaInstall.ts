import { useCallback, useEffect, useState } from 'react'
import { hasFeature } from '@/lib/featureFlags'

type InstallOutcome = 'accepted' | 'dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>
}

export interface PwaInstallChoice {
  outcome: InstallOutcome
  platform: string
}

interface UsePwaInstallReturn {
  canInstall: boolean
  install: () => Promise<PwaInstallChoice | null>
  dismiss: () => void
  isInstalled: boolean
}

function getBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return navigatorWithStandalone.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export async function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!hasFeature('pwaInstall')) return null
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  const baseUrl = getBaseUrl()
  try {
    return await navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl })
  } catch (err) {
    console.warn('[PWA] Service worker registration failed:', err)
    return null
  }
}

export function usePwaInstall(): UsePwaInstallReturn {
  const pwaInstallEnabled = hasFeature('pwaInstall')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplayMode())

  useEffect(() => {
    if (!pwaInstallEnabled || isInstalled || typeof window === 'undefined') return

    void registerPwaServiceWorker()

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [isInstalled, pwaInstallEnabled])

  const install = useCallback(async (): Promise<PwaInstallChoice | null> => {
    if (!deferredPrompt) return null

    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return choice
  }, [deferredPrompt])

  const dismiss = useCallback(() => {
    setDeferredPrompt(null)
  }, [])

  return {
    canInstall: pwaInstallEnabled && !isInstalled && deferredPrompt !== null,
    install,
    dismiss,
    isInstalled,
  }
}
