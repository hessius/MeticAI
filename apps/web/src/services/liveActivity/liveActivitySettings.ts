import { STORAGE_KEYS } from '@/lib/constants'
import type {
  GlanceableConfig,
  HeatingGlanceableStat,
  ShotGlanceableStat,
} from './liveActivityBridge'

const SHOT_VALUES: ShotGlanceableStat[] = ['weight', 'pressure', 'flow', 'temp']
const HEATING_VALUES: HeatingGlanceableStat[] = ['temp', 'estimatedTime']

export type LiveActivitySettings = GlanceableConfig

export function loadLiveActivitySettings(): LiveActivitySettings {
  const shot = localStorage.getItem(STORAGE_KEYS.LA_SHOT_GLANCEABLE) as ShotGlanceableStat | null
  const heating = localStorage.getItem(STORAGE_KEYS.LA_HEATING_GLANCEABLE) as HeatingGlanceableStat | null
  return {
    shotGlanceable: shot && SHOT_VALUES.includes(shot) ? shot : 'weight',
    heatingGlanceable: heating && HEATING_VALUES.includes(heating) ? heating : 'temp',
  }
}

export function saveLiveActivitySettings(settings: LiveActivitySettings): void {
  localStorage.setItem(STORAGE_KEYS.LA_SHOT_GLANCEABLE, settings.shotGlanceable)
  localStorage.setItem(STORAGE_KEYS.LA_HEATING_GLANCEABLE, settings.heatingGlanceable)
}
