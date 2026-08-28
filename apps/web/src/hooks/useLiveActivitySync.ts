import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import type { MachineState } from '@/hooks/useWebSocket'
import { LiveActivity } from '@/services/liveActivity/liveActivityBridge'
import {
  deriveLiveActivityCommand,
  type LiveActivityLifecycle,
} from '@/services/liveActivity/deriveLiveActivityCommand'
import { loadLiveActivitySettings } from '@/services/liveActivity/liveActivitySettings'
import { resolveMachineUrl, MACHINE_URL_CHANGED } from '@/services/machine/machineUrl'

const TEMP_ON_TARGET_THRESHOLD = 1.5

/**
 * iOS-only: mirror the current shot into a Live Activity. Native code drives the
 * live telemetry updates; this hook only starts/stops the activity in step with
 * the machine's lifecycle. No-op on web/Android.
 */
export function useLiveActivitySync(ms: MachineState, hasChartData = false) {
  const { t } = useTranslation()
  const lifecycle = useRef<LiveActivityLifecycle>({ active: false })
  const machineUrl = useRef<string | null>(null)

  // Keep the resolved machine URL current (native only).
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    let cancelled = false
    const refresh = () => {
      void resolveMachineUrl().then((url) => {
        if (!cancelled) machineUrl.current = url
      })
    }
    refresh()
    window.addEventListener(MACHINE_URL_CHANGED, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(MACHINE_URL_CHANGED, refresh)
    }
  }, [])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return

    const stateLC = (ms.state ?? '').toLowerCase()
    const { command, next } = deriveLiveActivityCommand(lifecycle.current, {
      stateLC,
      brewing: !!ms.brewing,
      hasChartData,
    })
    if (command === 'none') return

    if (command === 'start') {
      const url = machineUrl.current
      if (!url) return
      lifecycle.current = next
      const settings = loadLiveActivitySettings()
      const target = ms.target_temperature ?? undefined
      void LiveActivity.start({
        profileName: ms.active_profile ?? 'Espresso',
        machineUrl: url,
        targetWeightG: ms.target_weight ?? undefined,
        setTempC: target,
        readyCutoffC: target != null ? target - TEMP_ON_TARGET_THRESHOLD : undefined,
        shotGlanceable: settings.shotGlanceable,
        heatingGlanceable: settings.heatingGlanceable,
        strings: {
          brewChamber: t('settings.liveActivity.widget.brewChamber'),
          brewHead: t('settings.liveActivity.widget.brewHead'),
          ready: t('settings.liveActivity.widget.ready'),
          start: t('settings.liveActivity.widget.start'),
          weight: t('settings.liveActivity.widget.weight'),
          pressure: t('settings.liveActivity.widget.pressure'),
          flow: t('settings.liveActivity.widget.flow'),
          time: t('settings.liveActivity.widget.time'),
          shotComplete: t('settings.liveActivity.widget.shotComplete'),
          ratio: t('settings.liveActivity.widget.ratio'),
          avgTemp: t('settings.liveActivity.widget.avgTemp'),
          done: t('settings.liveActivity.widget.done'),
          resumeHint: t('settings.liveActivity.widget.resumeHint'),
        },
      }).catch(() => {
        lifecycle.current = { active: false }
      })
    } else if (command === 'stop') {
      lifecycle.current = next
      void LiveActivity.stop().catch(() => {})
    }
  }, [ms, hasChartData, t])
}
