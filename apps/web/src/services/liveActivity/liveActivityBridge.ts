import { registerPlugin } from '@capacitor/core'

export type ShotGlanceableStat = 'weight' | 'pressure' | 'flow' | 'temp'
export type HeatingGlanceableStat = 'temp' | 'estimatedTime'

export interface GlanceableConfig {
  shotGlanceable: ShotGlanceableStat
  heatingGlanceable: HeatingGlanceableStat
}

export interface ShotWidgetStrings {
  brewChamber: string
  brewHead: string
  ready: string
  start: string
  weight: string
  pressure: string
  flow: string
  time: string
  shotComplete: string
  ratio: string
  avgTemp: string
  done: string
  resumeHint: string
}

export interface StartLiveActivityOptions extends GlanceableConfig {
  profileName: string
  machineUrl: string
  targetWeightG?: number
  doseG?: number
  setTempC?: number
  readyCutoffC?: number
  strings?: ShotWidgetStrings
}

export interface LiveActivityPlugin {
  isSupported(): Promise<{ supported: boolean }>
  areActivitiesEnabled(): Promise<{ enabled: boolean }>
  start(options: StartLiveActivityOptions): Promise<void>
  updateConfig(options: GlanceableConfig): Promise<void>
  stop(): Promise<void>
}

/**
 * iOS-only Live Activity bridge. On web/Android the native plugin is absent and
 * calls reject; callers gate usage behind `Capacitor.getPlatform() === 'ios'`.
 */
export const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity')
