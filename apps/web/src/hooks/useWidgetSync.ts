import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { WidgetBridge } from '@/services/widgets/widgetBridge'
import { loadFavourites } from '@/services/favourites/favouritesStore'
import { resolveMachineUrl, MACHINE_URL_CHANGED } from '@/services/machine/machineUrl'
import { FAVOURITES_CHANGED } from '@/lib/constants'

interface Options {
  openAppOnStart: boolean
}

/**
 * Mirrors favourites, the machine URL, and the openAppOnStart setting into the
 * native widget bridge (App Group) whenever they change. iOS-only; a no-op on
 * every other platform.
 */
export function useWidgetSync({ openAppOnStart }: Options): void {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return

    let cancelled = false

    const pushFavourites = async () => {
      const favourites = await loadFavourites()
      if (cancelled) return
      await WidgetBridge.setFavourites({ favourites })
      await WidgetBridge.reloadWidgets()
    }

    const pushMachineUrl = async () => {
      const url = await resolveMachineUrl()
      if (cancelled) return
      await WidgetBridge.setMachineUrl({ url })
      await WidgetBridge.reloadWidgets()
    }

    // Initial mirror.
    void pushFavourites()
    void pushMachineUrl()
    void WidgetBridge.setOpenAppOnStart({ enabled: openAppOnStart }).catch(() => {})

    window.addEventListener(FAVOURITES_CHANGED, pushFavourites)
    window.addEventListener(MACHINE_URL_CHANGED, pushMachineUrl)
    return () => {
      cancelled = true
      window.removeEventListener(FAVOURITES_CHANGED, pushFavourites)
      window.removeEventListener(MACHINE_URL_CHANGED, pushMachineUrl)
    }
  }, [openAppOnStart])
}
