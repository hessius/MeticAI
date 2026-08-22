import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { WidgetBridge } from '@/services/widgets/widgetBridge'
import { loadFavourites } from '@/services/favourites/favouritesStore'
import { resolveMachineUrl, MACHINE_URL_CHANGED } from '@/services/machine/machineUrl'
import { rehostMachineImageUrl } from '@/hooks/useProfileImageSrc'
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
      const [favourites, machineUrl] = await Promise.all([
        loadFavourites(),
        resolveMachineUrl(),
      ])
      if (cancelled) return
      // Re-host machine profile images onto the current machine base so widget
      // images survive an address/port change (e.g. firmware :8080 -> :80).
      const rehosted = favourites.map(fav => ({
        ...fav,
        imageUrl: rehostMachineImageUrl(fav.imageUrl, machineUrl),
      }))
      await WidgetBridge.setFavourites({ favourites: rehosted })
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
    // A machine address/port change also invalidates cached widget images, so
    // re-push favourites to re-cache them from the new base.
    window.addEventListener(MACHINE_URL_CHANGED, pushFavourites)
    return () => {
      cancelled = true
      window.removeEventListener(FAVOURITES_CHANGED, pushFavourites)
      window.removeEventListener(MACHINE_URL_CHANGED, pushMachineUrl)
      window.removeEventListener(MACHINE_URL_CHANGED, pushFavourites)
    }
  }, [openAppOnStart])
}
