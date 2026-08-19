/**
 * LiveShotView — full-screen real-time chart view shown during
 * an active shot.  Accumulates WebSocket frames into a ChartDataPoint[]
 * and renders via the shared EspressoChart component.
 *
 * On shot completion (brewing flips false), shows a summary card
 * with CTAs to analyse or go home.
 *
 * Features:
 *  • Horizontal gauge layout — compact two-row indicators
 *  • Live profile breakdown — stages with current-stage highlight
 */
import { useRef, useEffect, useState, useMemo, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWakeLock } from '@/hooks/useWakeLock'
import { useHaptics } from '@/hooks/useHaptics'
import { useSoundEffects } from '@/hooks/useSoundEffects'
import { useBrewNotifications } from '@/hooks/useBrewNotifications'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Stop,
  ArrowLeft,
  Timer,
  Scales,
  Thermometer,
  ChartLine,
  Drop,
  Coffee,
  Gauge,
  Lightning,
} from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { useMachineService } from '@/hooks/useMachineService'
import { EspressoChart, MetricPanels, ChartLayoutToggle, type MetricPanelDef } from '@/components/charts'
import type { ChartDataPoint, ProfileTargetPoint } from '@/components/charts/chartConstants'
import { extractStageRanges, STAGE_COLORS, STAGE_BORDER_COLORS, CHART_COLORS } from '@/components/charts/chartConstants'
import { useChartLayout } from '@/hooks/useChartLayout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { getServerUrl } from '@/lib/config'
import { getActiveShotOverride } from '@/lib/activeShotOverride'
import { useProfileImageSrc } from '@/hooks/useProfileImageSrc'
import { HeatingDashboard } from './LiveShotView/HeatingDashboard'
import { useAutoStart } from '@/hooks/useAutoStart'
import {
  subscribe as subscribeShotTelemetry,
  getSnapshot as getShotTelemetrySnapshot,
} from '@/lib/shotTelemetryRecorder'
import type { ProfileData } from '@/components/ProfileBreakdown'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveShotViewProps {
  machineState: MachineState
  onBack: () => void
  /** Navigate to shot history for the given profile */
  onAnalyzeShot?: (profileName: string) => void
  /** Full active-profile data (stages/variables) for the heating breakdown */
  profileData?: ProfileData | null
  /** Optional profile description for the heating-view collapsible disclosure */
  profileDescription?: string
  /** Auto-start on stable temperature (#588) — shared with the Run Shot menu. */
  autoStartEnabled?: boolean
  onAutoStartChange?: (enabled: boolean) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE_POINTS = 300

function downsample(data: ChartDataPoint[], max: number): ChartDataPoint[] {
  if (data.length <= max) return data
  const step = data.length / max
  const result: ChartDataPoint[] = []
  for (let i = 0; i < max; i++) {
    result.push(data[Math.floor(i * step)])
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1])
  }
  return result
}

// ---------------------------------------------------------------------------
// Profile stage types for the live breakdown
// ---------------------------------------------------------------------------

interface ProfileStageInfo {
  name: string
  type: string // 'pressure' | 'flow' | 'power'
  key?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * On-target temperature threshold (°C). The brew head is considered "on target"
 * when |current − target| is within this value. Shared by the delta tile color
 * (#482) and the "Lance's standard" ready-banner easter egg so the two stay in
 * lockstep — change it here and both update.
 */
export const TEMP_ON_TARGET_THRESHOLD = 2.3

/**
 * Auto-start dwell (#588): how long both temps must stay within the on-target
 * band before auto-start fires the shot.
 */
export const AUTO_START_DWELL_MS = 30_000

export function LiveShotView({ machineState, onBack, onAnalyzeShot, profileData, profileDescription, autoStartEnabled = false, onAutoStartChange }: LiveShotViewProps) {
  const { t } = useTranslation()
  // The persistent recorder (fed at App level) is the single source of live-shot
  // + heating history, so opening this view late or navigating in/out no longer
  // loses graphed data (issue #582). This view is a reader/renderer only.
  const telemetry = useSyncExternalStore(
    subscribeShotTelemetry,
    getShotTelemetrySnapshot,
    getShotTelemetrySnapshot,
  )
  // Frozen copy of the shot chart captured on completion, so the currently-open
  // completed view keeps its graph even after the recorder clears on idle.
  const [frozenChart, setFrozenChart] = useState<ChartDataPoint[] | null>(null)
  const latestShotRef = useRef<ChartDataPoint[]>([])
  const [shotComplete, setShotComplete] = useState(false)
  const [targetCurves, setTargetCurves] = useState<ProfileTargetPoint[] | undefined>()
  const fetchedProfileRef = useRef<string | null>(null)
  const [profileStages, setProfileStages] = useState<ProfileStageInfo[]>([])

  // Use machine state from props directly
  const ms = machineState

  // Derived render buffers from the recorder. Downsample the live shot chart for
  // performance; the completed view renders the frozen snapshot when present.
  const liveChart = useMemo(
    () =>
      telemetry.shotSamples.length > MAX_VISIBLE_POINTS
        ? downsample(telemetry.shotSamples, MAX_VISIBLE_POINTS)
        : telemetry.shotSamples,
    [telemetry.shotSamples],
  )
  const chartData = frozenChart ?? liveChart
  const heatingSamples = telemetry.heatingSamples

  // Keep the latest recorded shot samples in a ref so the brewing-completion
  // cleanup (which closes over stale render values) can freeze a fresh snapshot.
  useEffect(() => {
    latestShotRef.current = telemetry.shotSamples
  }, [telemetry.shotSamples])

  // Resolve profile image URL (works in both proxy and direct/Capacitor modes)
  const profileImgUrl = useProfileImageSrc(ms.active_profile)

  // Keep screen awake during live shot view
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock()
  useEffect(() => { requestWakeLock(); return () => { releaseWakeLock() } }, [requestWakeLock, releaseWakeLock])

  // Haptic + sound + notification hooks
  const { notification: hapticsNotification } = useHaptics()
  const { shotComplete: playShotComplete } = useSoundEffects()
  const { notifyBrewComplete } = useBrewNotifications()

  // Prefer the temporary override weight target (when this shot was started
  // with variable overrides) so the live tile reflects what's actually brewing.
  const override = getActiveShotOverride()
  const effectiveTargetWeight =
    override && override.profileName === ms.active_profile && override.finalWeight != null
      ? override.finalWeight
      : ms.target_weight

  // Summary stats (computed once when shot completes via brewing-detection cleanup)
  const [summary, setSummary] = useState<{
    totalTime: number
    finalWeight: number
    avgPressure: number
    avgFlow: number
  } | null>(null)

  // Fetch target curves and profile info for the active profile
  useEffect(() => {
    const profileName = ms.active_profile
    if (!profileName || fetchedProfileRef.current === profileName) return
    fetchedProfileRef.current = profileName

    const fetchData = async () => {
      const base = await getServerUrl()

      // Fetch target curves
      try {
        const r = await fetch(`${base}/api/profile/${encodeURIComponent(profileName)}/target-curves`)
        if (r.ok) {
          const data = await r.json()
          if (data?.target_curves) setTargetCurves(data.target_curves)
        }
      } catch { /* non-critical */ }

      // Fetch profile stages
      try {
        const r = await fetch(`${base}/api/profile/${encodeURIComponent(profileName)}`)
        if (r.ok) {
          const data = await r.json()
          if (data?.stages) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setProfileStages(data.stages.map((s: any) => ({
              name: s.name,
              type: s.type ?? 'pressure',
              key: s.key,
            })))
          }
        }
      } catch { /* non-critical */ }
    }
    fetchData()
  }, [ms.active_profile])

  // Detect shot completion: when ms.brewing transitions from true→false,
  // the cleanup fires to mark the shot complete and compute summary stats.
  // It also freezes the recorded shot chart so the completed view survives the
  // recorder clearing its buffers once the machine returns to idle.
  useEffect(() => {
    if (!ms.brewing) return
    // A new shot is in progress — discard any previously frozen completed shot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrozenChart(null)
    // Brewing is active — return cleanup that fires when it stops
    return () => {
      setShotComplete(true)
      const data = latestShotRef.current
      if (data.length > 0) {
        const totalTime = data[data.length - 1].time
        const finalWeight = data[data.length - 1].weight ?? 0
        const avgPressure =
          data.reduce((s, p) => s + (p.pressure ?? 0), 0) / data.length
        const avgFlow =
          data.reduce((s, p) => s + (p.flow ?? 0), 0) / data.length
        setSummary({ totalTime, finalWeight, avgPressure, avgFlow })
        setFrozenChart(data.slice())
      }
    }
  }, [ms.brewing])

  // Haptic + sound + notification on brew completion
  useEffect(() => {
    if (!shotComplete) return
    hapticsNotification('success')
    playShotComplete()
    notifyBrewComplete(ms.active_profile ?? 'Espresso')
  }, [shotComplete, hapticsNotification, playShotComplete, notifyBrewComplete, ms.active_profile])

  // Command helper from shared hook
  const { cmd } = useMachineActions(machineState)
  const machine = useMachineService()

  // Heating-phase derivation (#494): before a shot starts and before any chart
  // data has arrived, the live view becomes a heating dashboard.
  const stateLC = (ms.state ?? '').toLowerCase()
  const isHeatingPhase = !ms.brewing && chartData.length === 0
  const isReadyState = stateLC === 'click to start'
  const isActivelyHeating = stateLC === 'heating' || stateLC === 'preheating'
  const headTempVal = ms.brew_head_temperature
  const chamberTempVal = ms.boiler_temperature
  const targetTempVal = ms.target_temperature
  const lanceReadyCutoff =
    targetTempVal != null ? targetTempVal - TEMP_ON_TARGET_THRESHOLD : 0
  // "Lance's standard" easter egg: brew-head temp sits within the on-target
  // threshold while the machine reports ready.
  const isLancesStandard =
    isReadyState &&
    headTempVal != null &&
    targetTempVal != null &&
    Math.abs(headTempVal - targetTempVal) <= TEMP_ON_TARGET_THRESHOLD

  // Auto-start on stable temperature (#588): when enabled, press "Start" for the
  // user once the machine is parked at the ready gate and both temps have held
  // within the on-target band for a sustained dwell (30s). Never fires from idle.
  const autoStartStatus = useAutoStart(
    {
      enabled: autoStartEnabled && isHeatingPhase,
      isReady: isReadyState,
      headTemp: headTempVal,
      chamberTemp: chamberTempVal,
      targetTemp: targetTempVal,
      band: TEMP_ON_TARGET_THRESHOLD,
      dwellMs: AUTO_START_DWELL_MS,
    },
    () => cmd(() => machine.continueShot(), 'startingShot'),
  )

  // Compute stage ranges from data
  const stages = useMemo(
    () => extractStageRanges(chartData),
    [chartData],
  )

  // Realign target curves to match actual stage timings.
  // The original target curves use *estimated* stage durations from
  // exit-trigger values.  When a stage exits prematurely (or late),
  // the targets for that stage and all subsequent stages would be
  // misaligned with the actual chart data.
  //
  // Strategy: group original target points by stage_name, then for each
  // stage that has an actual StageRange, scale the points to the actual
  // duration and shift all subsequent stages accordingly.
  const adjustedTargetCurves = useMemo(() => {
    if (!targetCurves || targetCurves.length === 0 || stages.length === 0) return targetCurves

    // Group original target points by stage_name (preserving order)
    const stageGroups: { name: string; points: ProfileTargetPoint[] }[] = []
    let currentGroup: { name: string; points: ProfileTargetPoint[] } | null = null
    for (const pt of targetCurves) {
      if (!currentGroup || currentGroup.name !== pt.stage_name) {
        currentGroup = { name: pt.stage_name, points: [] }
        stageGroups.push(currentGroup)
      }
      currentGroup.points.push(pt)
    }

    // Build a map of actual stage ranges by name
    const actualByName = new Map<string, { startTime: number; endTime: number }>()
    for (const s of stages) {
      // First occurrence wins (in case of duplicates)
      if (!actualByName.has(s.name)) {
        actualByName.set(s.name, { startTime: s.startTime, endTime: s.endTime })
      }
    }

    const adjusted: ProfileTargetPoint[] = []
    let timeOffset = 0 // cumulative shift applied to all subsequent stages

    for (const group of stageGroups) {
      const pts = group.points
      if (pts.length === 0) continue

      const origStart = pts[0].time
      const origEnd = pts[pts.length - 1].time
      const origDuration = origEnd - origStart

      const actual = actualByName.get(group.name)
      if (actual) {
        // This stage has started (and possibly completed) — align to actual
        const actualStart = actual.startTime
        const actualEnd = actual.endTime
        const actualDuration = actualEnd - actualStart

        // Scale factor: maps estimated duration → actual duration
        const scale = origDuration > 0 ? actualDuration / origDuration : 1

        for (const pt of pts) {
          const relTime = pt.time - origStart
          adjusted.push({
            ...pt,
            time: Math.round((actualStart + relTime * scale) * 100) / 100,
          })
        }

        // Update offset for subsequent stages
        timeOffset = (actualEnd) - (origEnd)
      } else {
        // Stage hasn't started yet — shift by accumulated offset
        for (const pt of pts) {
          adjusted.push({
            ...pt,
            time: Math.round((pt.time + timeOffset) * 100) / 100,
          })
        }
      }
    }

    return adjusted
  }, [targetCurves, stages])

  // Compute initial X-axis scale from profile target curves or default to 45s.
  // Cap at 60s — the chart auto-extends as actual data exceeds xMax.
  const LIVE_XMAX_CAP = 60
  const liveXMax = useMemo(() => {
    if (targetCurves && targetCurves.length > 0) {
      const maxTargetTime = Math.max(...targetCurves.map(p => p.time))
      return Math.min(Math.ceil(maxTargetTime * 1.1), LIVE_XMAX_CAP)
    }
    return 45 // Default 45 seconds if no profile info available
  }, [targetCurves])

  // Current stage name (from latest data point)
  const currentStageName = ms.state ?? null

  // Chart layout preference (#589): combined single chart vs. per-metric panels.
  const { canSeparate, pref, setPref, layout } = useChartLayout()
  const livePanels: MetricPanelDef[] = useMemo(
    () => [
      { key: 'pressure', labelKey: 'charts.metric.pressure', color: CHART_COLORS.pressure, targetKey: 'target_pressure' },
      { key: 'flow', labelKey: 'charts.metric.flow', color: CHART_COLORS.flow, overlayKey: 'gravimetricFlow', targetKey: 'target_flow' },
      { key: 'weight', labelKey: 'charts.metric.weight', color: CHART_COLORS.weight },
      { key: 'temperature', labelKey: 'charts.metric.temperature', color: CHART_COLORS.temperature },
    ],
    [],
  )

  return (
    <motion.div
      key="live-shot"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" data-sound="back" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft size={16} className="mr-1" />
          {t('common.back')}
        </Button>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ChartLine size={20} weight="duotone" />
          {t('controlCenter.liveShot.title')}
        </h2>
        <div className="w-16" /> {/* spacer for centering */}
      </div>

      {/* ── ACTIVE SHOT / WAITING ─────────────────────────────── */}
      {!shotComplete && (
        <>
          {/* Pre-shot heating dashboard (#494): temps, hero countdown, profile breakdown */}
          {isHeatingPhase && (
            <HeatingDashboard
              isReady={isReadyState}
              isHeating={isActivelyHeating}
              lancesStandard={isLancesStandard}
              profileName={ms.active_profile ?? ''}
              profileImageUrl={profileImgUrl}
              setTemp={targetTempVal ?? 0}
              chamberTemp={chamberTempVal ?? 0}
              headTemp={headTempVal ?? 0}
              lanceReadyCutoff={lanceReadyCutoff}
              samples={heatingSamples}
              profile={profileData ?? null}
              description={profileDescription}
              startDisabled={!ms.connected}
              onStart={() => cmd(() => machine.continueShot(), 'startingShot')}
              onAbort={() => { cmd(() => machine.abortShot(), 'warmupCancelled'); onBack() }}
              autoStartEnabled={autoStartEnabled}
              onAutoStartChange={onAutoStartChange}
              autoStartArmed={autoStartStatus.armed}
              autoStartRemainingMs={autoStartStatus.remainingMs}
            />
          )}

          {/* ── Horizontal metrics — two rows ─────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <div className="space-y-2">
              {/* Full-width profile & stage card — hidden on desktop where the right column shows this */}
              <div className="bg-muted/50 rounded-lg px-3 py-2.5 flex items-center gap-3 lg:hidden">
                {profileImgUrl && (
                  <img
                    src={profileImgUrl}
                    alt={ms.active_profile ?? ''}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  {ms.active_profile && (
                    <div className="text-sm font-semibold text-foreground truncate">{ms.active_profile}</div>
                  )}
                  <div className="text-xs text-muted-foreground truncate">
                    {currentStageName || '—'}
                  </div>
                </div>
              </div>

              {/* Row 1: Time, Pressure, Flow */}
              <div className="grid grid-cols-3 gap-2">
                <MetricTile
                  icon={<Timer size={14} />}
                  value={ms.shot_timer?.toFixed(1) ?? '0.0'}
                  unit="s"
                  label={t('controlCenter.metrics.time')}
                />
                <MetricTile
                  icon={<Gauge size={14} />}
                  value={ms.pressure?.toFixed(1) ?? '0.0'}
                  unit="bar"
                  label={t('controlCenter.metrics.pressure')}
                />
                <MetricTile
                  icon={<Drop size={14} />}
                  value={ms.flow_rate?.toFixed(1) ?? '0.0'}
                  unit="ml/s"
                  label={t('controlCenter.metrics.flow')}
                />
              </div>
              {/* Row 2 (during shot): Brew Head, Brew Chamber, Weight — the
                  target Δ slot is replaced by weight once brewing starts */}
              <div className="grid grid-cols-3 gap-2">
                <MetricTile
                  icon={<Thermometer size={14} />}
                  value={ms.brew_head_temperature?.toFixed(1) ?? '—'}
                  unit="°C"
                  label={t('controlCenter.metrics.brewTemp', 'Brew Head')}
                />
                <MetricTile
                  icon={<Thermometer size={14} />}
                  value={ms.boiler_temperature?.toFixed(1) ?? '—'}
                  unit="°C"
                  label={t('controlCenter.metrics.boilerTemp', 'Brew Chamber')}
                />
                <MetricTile
                  icon={<Scales size={14} />}
                  value={ms.shot_weight?.toFixed(1) ?? '0.0'}
                  unit={effectiveTargetWeight != null ? `/${effectiveTargetWeight.toFixed(0)}g` : 'g'}
                  label={t('controlCenter.metrics.weight')}
                  progress={effectiveTargetWeight != null && effectiveTargetWeight > 0
                    ? Math.min(100, ((ms.shot_weight ?? 0) / effectiveTargetWeight) * 100)
                    : undefined}
                />
              </div>
            </div>
          )}

          {/* ── Chart ────────────────────────────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <Card className="p-4">
              {canSeparate && (
                <div className="mb-2 flex justify-end">
                  <ChartLayoutToggle pref={pref} onChange={setPref} />
                </div>
              )}
              {layout === 'combined' ? (
                <EspressoChart
                  data={chartData}
                  stages={stages}
                  heightClass="h-[40vh] lg:h-[50vh] max-h-[400px]"
                  liveMode
                  showWeight
                  targetCurves={adjustedTargetCurves}
                  xMax={liveXMax}
                />
              ) : (
                <MetricPanels
                  data={chartData}
                  panels={livePanels}
                  layout={layout}
                  heightClass="h-[60vh] max-h-[560px]"
                  xMax={liveXMax}
                  targetCurves={adjustedTargetCurves}
                />
              )}
            </Card>
          )}

          {/* ── Profile stage breakdown — mobile only (full breakdown in right column on desktop) ───── */}
          {(ms.brewing || chartData.length > 0) && profileStages.length > 0 && (
            <div className="md:hidden">
              <LiveStageBreakdown
                stages={profileStages}
                currentStage={currentStageName}
                completedStages={stages.map(s => s.name)}
              />
            </div>
          )}

          {/* ── Action button during brewing ── */}
          {ms.brewing && (
            <div className="flex gap-3 justify-center">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-9 px-4 text-xs">
                    <Stop size={14} weight="fill" className="mr-1" />
                    {t('controlCenter.actions.stop')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('controlCenter.confirm.stopTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('controlCenter.confirm.stopDesc')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { cmd(() => machine.stopShot(), 'stopping'); onBack() }}>{t('common.confirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

        </>
      )}

      {/* ── SHOT COMPLETE ───────────────────────────── */}
      <AnimatePresence>
        {shotComplete && summary && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Final chart (frozen) */}
            <Card className="p-4 mb-4">
              <EspressoChart
                data={chartData}
                stages={stages}
                heightClass="h-[35vh] lg:h-[45vh] max-h-[360px]"
                showWeight
                targetCurves={adjustedTargetCurves}
              />
            </Card>

            {/* Summary card */}
            <Card className="p-6">
              <h3 className="text-lg font-bold text-foreground mb-4 text-center">
                {t('controlCenter.liveShot.shotComplete')}
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <SummaryItem label={t('controlCenter.liveShot.totalTime')} value={`${summary.totalTime.toFixed(1)}s`} />
                <SummaryItem label={t('controlCenter.liveShot.finalWeight')} value={`${summary.finalWeight.toFixed(1)}g`} />
                <SummaryItem label={t('controlCenter.liveShot.avgPressure')} value={`${summary.avgPressure.toFixed(1)} bar`} />
                <SummaryItem label={t('controlCenter.liveShot.avgFlow')} value={`${summary.avgFlow.toFixed(1)} ml/s`} />
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                <Button
                  variant="outline"
                  className="h-11 px-6"
                  onClick={() => cmd(() => machine.purge(), 'purging')}
                >
                  <Drop size={16} weight="fill" className="mr-2" />
                  {t('controlCenter.liveShot.purgeAfterShot')}
                </Button>
                {ms.active_profile && onAnalyzeShot && (
                  <Button
                    variant="outline"
                    className="h-11 px-6"
                    onClick={() => onAnalyzeShot(ms.active_profile!)}
                  >
                    <ChartLine size={16} weight="duotone" className="mr-2" />
                    {t('controlCenter.liveShot.analyzeShot', 'Analyze Shot')}
                  </Button>
                )}
                <Button variant="default" className="h-11 px-6" data-sound="back" onClick={onBack}>
                  {t('controlCenter.liveShot.backHome')}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Brew Head temperature display — tap to cycle current / target / delta (#482)
// ---------------------------------------------------------------------------

export type TempDisplayMode = 'current' | 'target' | 'delta'

export interface TempTileDisplay {
  value: string
  unit: string
  label: string
  valueClassName?: string
}

/**
 * Pure formatter for the Brew Head temperature tile.
 *
 * Returns the value/unit/label (and an optional color class for the delta) for
 * the given display mode. Kept free of React/DOM so it can be unit-tested
 * without rendering the (large) LiveShotView.
 */
export function getTempTileDisplay(
  mode: TempDisplayMode,
  current: number | null,
  target: number | null,
  t: (key: string, fallback?: string) => string,
): TempTileDisplay {
  const unit = '°C'

  if (mode === 'target') {
    return {
      value: target != null ? target.toFixed(1) : '—',
      unit,
      label: t('controlCenter.metrics.targetTemp', 'Target'),
    }
  }

  if (mode === 'delta') {
    if (current == null || target == null) {
      return { value: '—', unit, label: t('controlCenter.metrics.tempDelta', 'Δ Target') }
    }
    const d = current - target
    const valueClassName = Math.abs(d) <= TEMP_ON_TARGET_THRESHOLD
      ? 'text-emerald-600 dark:text-emerald-400'
      : d > 0
        ? 'text-orange-600 dark:text-orange-400'
        : 'text-blue-600 dark:text-blue-400'
    return {
      value: `${d >= 0 ? '+' : ''}${d.toFixed(1)}`,
      unit,
      label: t('controlCenter.metrics.tempDelta', 'Δ Target'),
      valueClassName,
    }
  }

  // current
  return {
    value: current != null ? current.toFixed(1) : '—',
    unit,
    label: t('controlCenter.metrics.brewTemp', 'Brew Head'),
  }
}

function MetricTile({ icon, value, unit, label, progress, onClick, valueClassName }: {
  icon?: React.ReactNode
  value: string
  unit: string
  label: string
  progress?: number
  onClick?: () => void
  valueClassName?: string
}) {
  return (
    <div
      className={`bg-muted/50 rounded-lg px-3 py-2 text-center ${onClick ? 'cursor-pointer hover:bg-muted/75 active:bg-muted transition-colors select-none' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className={`text-lg font-bold tabular-nums flex items-center justify-center gap-1 ${valueClassName ?? 'text-foreground'}`}>
        {icon}
        {value}
        <span className="text-[10px] text-muted-foreground font-normal">{unit}</span>
      </div>
      {progress != null && (
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-1 mb-0.5">
          <div
            className="h-full bg-primary rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live Stage Breakdown — shows profile stages with current-stage highlight
// ---------------------------------------------------------------------------

const STAGE_TYPE_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  pressure: { icon: <Gauge size={12} weight="duotone" />, color: 'text-amber-600 dark:text-amber-400' },
  flow: { icon: <Drop size={12} weight="duotone" />, color: 'text-blue-600 dark:text-blue-400' },
  power: { icon: <Lightning size={12} weight="duotone" />, color: 'text-red-600 dark:text-red-400' },
}

function LiveStageBreakdown({ stages, currentStage, completedStages }: {
  stages: ProfileStageInfo[]
  currentStage: string | null
  completedStages: string[]
}) {
  const { t } = useTranslation()
  const currentIdx = stages.findIndex(s => s.name === currentStage)

  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Coffee size={14} weight="duotone" className="text-primary" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t('controlCenter.liveShot.stages')}
        </span>
      </div>
      <div className="space-y-1">
        {stages.map((stage, idx) => {
          const isCurrent = stage.name === currentStage
          const isDone = currentIdx > idx || (!isCurrent && completedStages.includes(stage.name))
          const isFuture = !isCurrent && !isDone
          const typeInfo = STAGE_TYPE_ICONS[stage.type] ?? STAGE_TYPE_ICONS.pressure
          const colorIdx = idx % STAGE_COLORS.length

          return (
            <div
              key={stage.key ?? stage.name}
              className={`
                flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-all duration-300
                ${isCurrent ? 'ring-1 ring-primary/50 shadow-sm' : ''}
                ${isFuture ? 'opacity-40' : ''}
              `}
              style={{
                backgroundColor: isCurrent ? STAGE_COLORS[colorIdx] : isDone ? STAGE_COLORS[colorIdx] : undefined,
                borderLeft: `3px solid ${STAGE_BORDER_COLORS[colorIdx]}`,
              }}
            >
              {/* Stage number */}
              <span className={`
                w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                ${isCurrent ? 'bg-primary text-primary-foreground animate-pulse' : isDone ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}
              `}>
                {isDone ? '✓' : idx + 1}
              </span>

              {/* Stage name */}
              <span className={`flex-1 truncate font-medium ${isCurrent ? 'text-foreground' : isDone ? 'text-foreground/80' : 'text-muted-foreground'}`}>
                {stage.name}
              </span>

              {/* Type badge */}
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${typeInfo.color} border-current/30`}>
                <span className="mr-0.5">{typeInfo.icon}</span>
                {stage.type}
              </Badge>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
