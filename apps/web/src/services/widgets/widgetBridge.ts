import { registerPlugin } from '@capacitor/core'
import type { Favourite } from '@/services/favourites/favouritesStore'

export interface WidgetBridgePlugin {
  setFavourites(options: { favourites: Favourite[] }): Promise<void>
  setMachineUrl(options: { url: string }): Promise<void>
  setOpenAppOnStart(options: { enabled: boolean }): Promise<void>
  reloadWidgets(): Promise<void>
}

/**
 * On iOS the native `WidgetBridge` plugin (registered in
 * MeticulousViewController) mirrors favourites / machine URL / settings into
 * the shared App Group and reloads widget timelines. On web/Android the
 * methods reject; callers gate usage behind an iOS platform check.
 */
export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')
