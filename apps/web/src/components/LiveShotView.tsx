/**
 * LiveShotView — full-screen real-time chart view shown during
 * an active shot.  Accumulates WebSocket frames into a ChartDataPoint[]
 * and renders via the shared EspressoChart component.
 *
 * On shot completion (brewing flips false), shows a summary card
 * with CTAs to analyse or go home.
 *
 * Features:
 *  • Simulation mode — replay target curves for UI testing
 *  • Horizontal gauge layout — compact two-row indicators
 *  • Live profile breakdown — stages with current-stage highlight
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'
import { continueShot, stopShot, abortShot, purge } from '@/lib/mqttCommands'
import { useSimulatedShot } from '@/hooks/useSimulatedShot'
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveShotViewProps {
  machineState: MachineState
  onBack: () => void
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

export function LiveShotView({ machineState, onBack }: LiveShotViewProps) {
  const { t } = useTranslation()
  const chartDataRef = useRef<ChartDataPoint[]>([])
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [shotComplete, setShotComplete] = useState(false)
  const wasBrewingRef = useRef(machineState.brewing)
  const [targetCurves, setTargetCurves] = useState<ProfileTargetPoint[] | undefined>()
  const fetchedProfileRef = useRef<string | null>(null)
  const [profileStages, setProfileStages] = useState<ProfileStageInfo[]>([])

  // Simulation mode
  const sim = useSimulatedShot(machineState.active_profile ?? undefined)

  // The effective machine state — uses simulation overlay when active
  const ms: MachineState = sim.active
    ? { ...machineState, ...sim.state } as MachineState
    : machineState

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

  // Accumulate data from WebSocket frames
  useEffect(() => {
    if (!ms.brewing) {
      // Shot just ended
      if (wasBrewingRef.current) {
        setShotComplete(true)
        if (sim.active) sim.stop()
      }
      wasBrewingRef.current = false
      return
    }
    wasBrewingRef.current = true

    const point: ChartDataPoint = {
      time: ms.shot_timer ?? 0,
      pressure: ms.pressure ?? 0,
      flow: ms.flow_rate ?? 0,
      weight: ms.shot_weight ?? 0,
      stage: ms.state ?? undefined,
    }

    chartDataRef.current = [...chartDataRef.current, point]
    setChartData(downsample(chartDataRef.current, MAX_VISIBLE_POINTS))
  }, [
    ms.brewing,
    ms.shot_timer,
    ms.pressure,
    ms.flow_rate,
    ms.shot_weight,
    ms.state,
  ])

  // Command helpers
  const cmd = useCallback(
    async (fn: () => Promise<{ success: boolean; message?: string }>, successKey: string) => {
      const res = await fn()
      if (res.success) {
        toast.success(t(`controlCenter.toasts.${successKey}`))
      } else {
        toast.error(res.message ?? t('controlCenter.toasts.error'))
      }
    },
    [t],
  )

  // Compute stage ranges from data
  const stages = useMemo(
    () => extractStageRanges(chartData),
    [chartData],
  )

  // Compute initial X-axis scale from profile target curves or default to 45s
  const liveXMax = useMemo(() => {
    if (targetCurves && targetCurves.length > 0) {
      const maxTargetTime = Math.max(...targetCurves.map(p => p.time))
      return Math.ceil(maxTargetTime * 1.1) // 10% padding beyond last target point
    }
    return 45 // Default 45 seconds if no profile info available
  }, [targetCurves])

  // Current stage name (from latest data point)
  const currentStageName = ms.state ?? null

  // Summary stats (computed once when shot completes)
  const summary = useMemo(() => {
    if (!shotComplete || chartDataRef.current.length === 0) return null
    const data = chartDataRef.current
    const totalTime = data[data.length - 1].time
    const finalWeight = data[data.length - 1].weight ?? 0
    const avgPressure =
      data.reduce((s, p) => s + (p.pressure ?? 0), 0) / data.length
    const avgFlow =
      data.reduce((s, p) => s + (p.flow ?? 0), 0) / data.length
    return { totalTime, finalWeight, avgPressure, avgFlow }
  }, [shotComplete])

  // Handle simulation start
  const handleSimulate = useCallback(() => {
    chartDataRef.current = []
    setChartData([])
    setShotComplete(false)
    wasBrewingRef.current = false
    sim.start()
    toast.success('Simulation started')
  }, [sim])

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
        <Button variant="ghost" size="sm" onClick={() => { if (sim.active) sim.stop(); onBack() }} className="text-muted-foreground">
          <ArrowLeft size={16} className="mr-1" />
          {t('common.back')}
        </Button>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ChartLine size={20} weight="duotone" />
          {t('controlCenter.liveShot.title')}
          {sim.active && (
            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400 ml-1">
              SIM
            </Badge>
          )}
        </h2>
        <div className="w-16" /> {/* spacer for centering */}
      </div>

      {/* ── ACTIVE SHOT / WAITING ─────────────────────────────── */}
      {!shotComplete && (
        <>
          {/* Pre-shot waiting indicator with Start + Abort + Simulate controls */}
          {!ms.brewing && chartData.length === 0 && (
            <Card className="p-6 text-center space-y-4">
              <div className="text-muted-foreground space-y-2">
                <Coffee size={32} weight="duotone" className="mx-auto text-primary animate-pulse" />
                <p className="text-sm font-medium">{t('controlCenter.liveShot.waitingForShot')}</p>
                <p className="text-xs text-muted-foreground/70">{t('controlCenter.liveShot.waitingDesc')}</p>
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                {ms.connected && (
                  <>
                    <Button
                      variant="default"
                      className="h-11 px-6"
                      onClick={() => cmd(continueShot, 'startingShot')}
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
                          <AlertDialogAction onClick={() => cmd(abortShot, 'warmupCancelled')}>{t('common.confirm')}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
                {/* Simulate button — replays a real recorded shot */}
                {sim.ready && (
                  <Button
                    variant="outline"
                    className="h-11 px-6 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                    onClick={handleSimulate}
                  >
                    <Lightning size={18} weight="fill" className="mr-2" />
                    Simulate
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* ── Horizontal metrics — two rows ─────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <div className="space-y-2">
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
              {/* Row 2: Weight, Temperature, Stage */}
              <div className="grid grid-cols-3 gap-2">
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
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-center flex flex-col justify-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">{t('controlCenter.labels.status', 'Stage')}</div>
                  <div className="text-xs font-medium text-foreground truncate">
                    {currentStageName || '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Chart ────────────────────────────────────── */}
          {(ms.brewing || chartData.length > 0) && (
            <Card className="p-4">
              <EspressoChart
                data={chartData}
                stages={stages}
                heightClass="h-[40vh] lg:h-[50vh]"
                liveMode
                showWeight
                targetCurves={targetCurves}
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

          {/* ── Action buttons (only during real brewing, not simulation) ── */}
          {ms.brewing && !sim.active && (
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
                    <AlertDialogAction onClick={() => cmd(stopShot, 'stopping')}>{t('common.confirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="h-9 px-4 text-xs">
                    <XCircle size={14} weight="fill" className="mr-1" />
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
                    <AlertDialogAction onClick={() => cmd(abortShot, 'aborting')}>{t('common.confirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* Simulation stop button */}
          {sim.active && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 text-xs border-amber-500/50 text-amber-600 dark:text-amber-400"
                onClick={() => sim.stop()}
              >
                <Stop size={14} weight="fill" className="mr-1" />
                Stop Simulation
              </Button>
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
                heightClass="h-[35vh] lg:h-[45vh]"
                showWeight
                targetCurves={targetCurves}
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
                {!sim.active && (
                  <Button
                    variant="outline"
                    className="h-11 px-6"
                    onClick={() => cmd(purge, 'purging')}
                  >
                    <Drop size={16} weight="fill" className="mr-2" />
                    {t('controlCenter.liveShot.purgeAfterShot')}
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

function MetricTile({ icon, value, unit, label, progress }: {
  icon?: React.ReactNode
  value: string
  unit: string
  label: string
  progress?: number
}) {
  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
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
  const currentIdx = stages.findIndex(s => s.name === currentStage)

  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Coffee size={14} weight="duotone" className="text-primary" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Stages
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
