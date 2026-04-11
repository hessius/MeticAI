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
import { useRef, useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWakeLock } from '@/hooks/useWakeLock'
import { useHaptics } from '@/hooks/useHaptics'
import { useBrewNotifications } from '@/hooks/useBrewNotifications'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Play,
  Stop,
  XCircle,
  ArrowLeft,
  Timer,
  Scales,
  Thermometer,
  ChartLine,
  Drop,
  Coffee,
  Gauge,
  Lightning,
  Fire,
} from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { useMachineService } from '@/hooks/useMachineService'
import { EspressoChart } from '@/components/charts'
import type { ChartDataPoint, ProfileTargetPoint } from '@/components/charts/chartConstants'
import { extractStageRanges, STAGE_COLORS, STAGE_BORDER_COLORS } from '@/components/charts/chartConstants'
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
import { isDirectMode } from '@/lib/machineMode'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveShotViewProps {
  machineState: MachineState
  onBack: () => void
  /** Navigate to shot history for the given profile */
  onAnalyzeShot?: (profileName: string) => void
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

export function LiveShotView({ machineState, onBack, onAnalyzeShot }: LiveShotViewProps) {
  const { t } = useTranslation()
  const chartDataRef = useRef<ChartDataPoint[]>([])
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [shotComplete, setShotComplete] = useState(false)
  const renderFrameRef = useRef<number | null>(null)
  const [targetCurves, setTargetCurves] = useState<ProfileTargetPoint[] | undefined>()
  const fetchedProfileRef = useRef<string | null>(null)
  const [profileStages, setProfileStages] = useState<ProfileStageInfo[]>([])
  const [profileImgUrl, setProfileImgUrl] = useState<string | null>(null)

  // Keep screen awake during live shot view
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock()
  useEffect(() => { requestWakeLock(); return () => { releaseWakeLock() } }, [requestWakeLock, releaseWakeLock])

  // Haptic + notification hooks
  const { notification: hapticsNotification } = useHaptics()
  const { notifyBrewComplete } = useBrewNotifications()

  // Summary stats (computed once when shot completes via brewing-detection cleanup)
  const [summary, setSummary] = useState<{
    totalTime: number
    finalWeight: number
    avgPressure: number
    avgFlow: number
  } | null>(null)

  // Use machine state from props directly
  const ms = machineState

  // Fetch target curves and profile info for the active profile
  useEffect(() => {
    const profileName = ms.active_profile
    if (!profileName || fetchedProfileRef.current === profileName) return
    fetchedProfileRef.current = profileName

    const fetchData = async () => {
      const base = await getServerUrl()

      // Build profile image URL (not available in direct mode)
      if (!isDirectMode()) {
        setProfileImgUrl(`${base}/api/profile/${encodeURIComponent(profileName!)}/image-proxy`)
      }

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
  useEffect(() => {
    if (!ms.brewing) return
    // Brewing is active — return cleanup that fires when it stops
    return () => {
      setShotComplete(true)
      const data = chartDataRef.current
      if (data.length > 0) {
        const totalTime = data[data.length - 1].time
        const finalWeight = data[data.length - 1].weight ?? 0
        const avgPressure =
          data.reduce((s, p) => s + (p.pressure ?? 0), 0) / data.length
        const avgFlow =
          data.reduce((s, p) => s + (p.flow ?? 0), 0) / data.length
        setSummary({ totalTime, finalWeight, avgPressure, avgFlow })
      }
    }
  }, [ms.brewing])

  // Haptic + notification on brew completion
  useEffect(() => {
    if (!shotComplete) return
    hapticsNotification('success')
    notifyBrewComplete(ms.active_profile ?? 'Espresso')
  }, [shotComplete, hapticsNotification, notifyBrewComplete, ms.active_profile])

  // Accumulate data from WebSocket frames — push + rAF for O(1) per frame
  useEffect(() => {
    if (!ms.brewing) return

    const point: ChartDataPoint = {
      time: ms.shot_timer ?? 0,
      pressure: ms.pressure ?? 0,
      flow: Math.max(0, ms.flow_rate ?? 0),
      weight: ms.shot_weight ?? 0,
      power: ms.power ?? 0,
      stage: ms.state ?? undefined,
    }

    // O(1) push instead of O(n) spread copy
    chartDataRef.current.push(point)

    // Coalesce rapid WebSocket bursts — render on next animation frame
    if (renderFrameRef.current === null) {
      renderFrameRef.current = requestAnimationFrame(() => {
        const data = chartDataRef.current
        setChartData(
          data.length > MAX_VISIBLE_POINTS
            ? downsample(data, MAX_VISIBLE_POINTS)
            : data.slice(),  // cheap copy when small
        )
        renderFrameRef.current = null
      })
    }
  }, [
    ms.brewing,
    ms.shot_timer,
    ms.pressure,
    ms.flow_rate,
    ms.power,
    ms.shot_weight,
    ms.state,
  ])

  // Clean up any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current)
      }
    }
  }, [])

  // Command helper from shared hook
  const { cmd } = useMachineActions(machineState)
  const machine = useMachineService()

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
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
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
          {/* Pre-shot empty state — gauges, deactivated chart, heating/ready prominence */}
          {!ms.brewing && chartData.length === 0 && (() => {
            const stateLC = (ms.state ?? '').toLowerCase()
            const isHeating = stateLC === 'heating' || stateLC === 'preheating'
            const isReady = stateLC === 'click to start'
            const temp = ms.brew_head_temperature
            const targetTemp = ms.target_temperature

            return (
              <>
                {/* Prominent READY banner */}
                {isReady && (() => {
                  // "Lance's standard" easter egg: when temp is within 2.3°C of target, show enhanced display
                  const isLancesStandard = temp != null && targetTemp != null && Math.abs(temp - targetTemp) <= 2.3
                  return (
                  <Card className={`p-4 ${isLancesStandard ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.4)] dark:shadow-[0_0_40px_rgba(16,185,129,0.5)]' : 'border-emerald-500/50 bg-emerald-500/10'}`}>
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`relative flex ${isLancesStandard ? 'h-4 w-4' : 'h-3 w-3'}`}>
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isLancesStandard ? 'bg-emerald-300' : 'bg-emerald-400'} opacity-75`} />
                          <span className={`relative inline-flex rounded-full ${isLancesStandard ? 'h-4 w-4' : 'h-3 w-3'} bg-emerald-500`} />
                        </span>
                        <span className={`font-bold ${isLancesStandard ? 'text-xl text-emerald-600 dark:text-emerald-300' : 'text-lg text-emerald-700 dark:text-emerald-400'}`}>
                          {t('controlCenter.states.ready')}
                        </span>
                      </div>
                      {temp != null && (
                        <span className={`font-bold tabular-nums ${isLancesStandard ? 'text-4xl text-emerald-600 dark:text-emerald-300 animate-pulse' : 'text-3xl text-emerald-700 dark:text-emerald-400'}`}>
                          {temp.toFixed(1)}°C
                        </span>
                      )}
                      {/* Lance's standard subtitle */}
                      {isLancesStandard && (
                        <span className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 italic">
                          {t('controlCenter.states.lancesStandard')}
                        </span>
                      )}
                    </div>
                  </Card>
                  )
                })()}

                {/* Prominent HEATING display */}
                {isHeating && (
                  <Card className="p-4 border-orange-500/40 bg-orange-500/10">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Fire size={20} weight="fill" className="text-orange-500 animate-pulse" />
                        <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                          {t('controlCenter.states.heating')}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold tabular-nums text-foreground">
                          {temp != null ? temp.toFixed(1) : '—'}
                        </span>
                        <span className="text-lg text-muted-foreground">°C</span>
                        {targetTemp != null && (
                          <span className="text-sm text-muted-foreground ml-1">
                            / {targetTemp.toFixed(0)}°C
                          </span>
                        )}
                      </div>
                      {/* Progress bar toward target temp */}
                      {temp != null && targetTemp != null && targetTemp > 0 && (
                        <div className="w-full max-w-xs">
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-orange-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, (temp / targetTemp) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {/* Preheat countdown */}
                      {ms.preheat_countdown != null && ms.preheat_countdown > 0 && (() => {
                        const secs = Math.ceil(ms.preheat_countdown)
                        const mm = Math.floor(secs / 60)
                        const ss = String(secs % 60).padStart(2, '0')
                        return (
                          <span className="text-xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
                            {mm}:{ss}
                          </span>
                        )
                      })()}
                    </div>
                  </Card>
                )}

                {/* Metric tiles (same layout as active shot) */}
                <div className="space-y-2">
                  {/* Full-width profile & stage card — hidden on desktop where the right column shows this */}
                  <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-3 lg:hidden">
                    {profileImgUrl && (
                      <img
                        src={profileImgUrl}
                        alt={ms.active_profile ?? ''}
                        className="w-8 h-8 rounded-md object-cover shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {ms.active_profile && (
                        <div className="text-xs font-semibold text-foreground truncate">{ms.active_profile}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground truncate">
                        {ms.state || '—'}
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
                  {/* Row 2: Weight, Temperature */}
                  <div className="grid grid-cols-2 gap-2">
                    <MetricTile
                      icon={<Scales size={14} />}
                      value={ms.shot_weight?.toFixed(1) ?? '0.0'}
                      unit={ms.target_weight != null ? `/${ms.target_weight.toFixed(0)}g` : 'g'}
                      label={t('controlCenter.metrics.weight')}
                      onClick={() => cmd(() => machine.tareScale(), 'tared')}
                    />
                    <MetricTile
                      icon={<Thermometer size={14} />}
                      value={ms.brew_head_temperature?.toFixed(1) ?? '—'}
                      unit="°C"
                      label={t('controlCenter.metrics.temp', 'Temp')}
                    />
                  </div>
                </div>

                {/* Deactivated chart placeholder */}
                <Card className="p-4 opacity-40">
                  <EspressoChart
                    data={[]}
                    stages={[]}
                    heightClass="h-[25vh] lg:h-[30vh] max-h-[250px]"
                    showWeight
                    targetCurves={targetCurves}
                    xMax={liveXMax}
                  />
                </Card>

                {/* Action buttons */}
                <div className="flex gap-3 justify-center flex-wrap">
                  {ms.connected && (
                    <>
                      <Button
                        variant="default"
                        className="h-11 px-6"
                        onClick={() => cmd(() => machine.continueShot(), 'startingShot')}
                      >
                        <Play size={18} weight="fill" className="mr-2" />
                        {t('controlCenter.actions.start')}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" className="h-11 px-6">
                            <XCircle size={18} weight="fill" className="mr-2" />
                            {t('controlCenter.actions.abort')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('controlCenter.confirm.abortTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('controlCenter.confirm.abortDesc')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => cmd(() => machine.abortShot(), 'warmupCancelled')}>{t('common.confirm')}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              </>
            )
          })()}

          {/* ── Horizontal metrics — two rows ─────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <div className="space-y-2">
              {/* Full-width profile & stage card — hidden on desktop where the right column shows this */}
              <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-3 lg:hidden">
                {profileImgUrl && (
                  <img
                    src={profileImgUrl}
                    alt={ms.active_profile ?? ''}
                    className="w-8 h-8 rounded-md object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  {ms.active_profile && (
                    <div className="text-xs font-semibold text-foreground truncate">{ms.active_profile}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground truncate">
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
              {/* Row 2: Weight, Temperature */}
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  icon={<Scales size={14} />}
                  value={ms.shot_weight?.toFixed(1) ?? '0.0'}
                  unit={ms.target_weight != null ? `/${ms.target_weight.toFixed(0)}g` : 'g'}
                  label={t('controlCenter.metrics.weight')}
                  progress={ms.target_weight != null && ms.target_weight > 0
                    ? Math.min(100, ((ms.shot_weight ?? 0) / ms.target_weight) * 100)
                    : undefined}
                />
                <MetricTile
                  icon={<Thermometer size={14} />}
                  value={ms.brew_head_temperature?.toFixed(1) ?? '—'}
                  unit="°C"
                  label={t('controlCenter.metrics.temp', 'Temp')}
                />
              </div>
            </div>
          )}

          {/* ── Chart ────────────────────────────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <Card className="p-4">
              <EspressoChart
                data={chartData}
                stages={stages}
                heightClass="h-[40vh] lg:h-[50vh] max-h-[400px]"
                liveMode
                showWeight
                targetCurves={adjustedTargetCurves}
                xMax={liveXMax}
              />
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
                    <AlertDialogAction onClick={() => cmd(() => machine.stopShot(), 'stopping')}>{t('common.confirm')}</AlertDialogAction>
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
                <Button variant="default" className="h-11 px-6" onClick={onBack}>
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

function MetricTile({ icon, value, unit, label, progress, onClick }: {
  icon?: React.ReactNode
  value: string
  unit: string
  label: string
  progress?: number
  onClick?: () => void
}) {
  return (
    <div
      className={`bg-muted/50 rounded-lg px-3 py-2 text-center ${onClick ? 'cursor-pointer hover:bg-muted/75 active:bg-muted transition-colors select-none' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="text-lg font-bold tabular-nums text-foreground flex items-center justify-center gap-1">
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
