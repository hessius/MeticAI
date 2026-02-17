/**
 * LiveShotView — full-screen real-time chart view shown during
 * an active shot.  Accumulates WebSocket frames into a ChartDataPoint[]
 * and renders via the shared EspressoChart component.
 *
 * On shot completion (brewing flips false), shows a summary card
 * with CTAs to analyse or go home.
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'
import { continueShot, stopShot, abortShot, purge } from '@/lib/mqttCommands'
import { SensorGauge } from '@/components/SensorGauge'
import { EspressoChart } from '@/components/charts'
import type { ChartDataPoint, ProfileTargetPoint } from '@/components/charts/chartConstants'
import { extractStageRanges } from '@/components/charts/chartConstants'
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveShotViewProps {
  machineState: MachineState
  onBack: () => void
  onAnalyze?: () => void
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
// Component
// ---------------------------------------------------------------------------

export function LiveShotView({ machineState, onBack, onAnalyze }: LiveShotViewProps) {
  const { t } = useTranslation()
  const chartDataRef = useRef<ChartDataPoint[]>([])
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [shotComplete, setShotComplete] = useState(false)
  const wasBrewingRef = useRef(machineState.brewing)
  const [targetCurves, setTargetCurves] = useState<ProfileTargetPoint[] | undefined>()
  const fetchedProfileRef = useRef<string | null>(null)

  // Fetch target curves for the active profile when a shot starts
  useEffect(() => {
    const profileName = machineState.active_profile
    if (!profileName || fetchedProfileRef.current === profileName) return
    fetchedProfileRef.current = profileName

    const base = (window as any).__RUNTIME_CONFIG__?.serverUrl || ''
    fetch(`${base}/api/profile/${encodeURIComponent(profileName)}/target-curves`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.target_curves) setTargetCurves(data.target_curves)
      })
      .catch(() => { /* non-critical — live view works without targets */ })
  }, [machineState.active_profile])

  // Accumulate data from WebSocket frames
  useEffect(() => {
    if (!machineState.brewing) {
      // Shot just ended
      if (wasBrewingRef.current) {
        setShotComplete(true)
      }
      wasBrewingRef.current = false
      return
    }
    wasBrewingRef.current = true

    const point: ChartDataPoint = {
      time: machineState.shot_timer ?? 0,
      pressure: machineState.pressure ?? 0,
      flow: machineState.flow_rate ?? 0,
      weight: machineState.shot_weight ?? 0,
      stage: machineState.state ?? undefined,
    }

    chartDataRef.current = [...chartDataRef.current, point]
    setChartData(downsample(chartDataRef.current, MAX_VISIBLE_POINTS))
  }, [
    machineState.brewing,
    machineState.shot_timer,
    machineState.pressure,
    machineState.flow_rate,
    machineState.shot_weight,
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
          {/* Pre-shot waiting indicator with Start + Abort controls */}
          {!machineState.brewing && chartData.length === 0 && (
            <Card className="p-6 text-center space-y-4">
              <div className="text-muted-foreground space-y-2">
                <Coffee size={32} weight="duotone" className="mx-auto text-primary animate-pulse" />
                <p className="text-sm font-medium">{t('controlCenter.liveShot.waitingForShot')}</p>
                <p className="text-xs text-muted-foreground/70">{t('controlCenter.liveShot.waitingDesc')}</p>
              </div>
              {/* Action buttons — Start + Abort during warmup/ready */}
              {machineState.connected && (
                <div className="flex gap-3 justify-center">
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
                </div>
              )}
            </Card>
          )}

          {/* Sticky mobile metrics bar */}
          <div className="grid grid-cols-4 gap-2 lg:hidden">
            <MetricTile
              icon={<Timer size={14} />}
              value={machineState.shot_timer?.toFixed(1) ?? '0.0'}
              label="s"
            />
            <MetricTile
              icon={<Scales size={14} />}
              value={machineState.shot_weight?.toFixed(1) ?? '0.0'}
              label="g"
            />
            <MetricTile
              value={machineState.pressure?.toFixed(1) ?? '0.0'}
              label="bar"
            />
            <MetricTile
              value={machineState.flow_rate?.toFixed(1) ?? '0.0'}
              label="ml/s"
            />
          </div>

          {/* Desktop: two-column — chart + sidebar gauges */}
          <div className="lg:grid lg:grid-cols-[1fr_200px] lg:gap-4 lg:items-start">
            {/* Chart */}
            <Card className="p-4">
              <EspressoChart
                data={chartData}
                stages={stages}
                heightClass="h-[45vh] lg:h-[55vh]"
                liveMode
                showWeight
                targetCurves={targetCurves}
                xMax={liveXMax}
              />
            </Card>

            {/* Desktop sidebar gauges — vertically aligned with chart card */}
            <Card className="hidden lg:flex lg:flex-col lg:gap-3 lg:items-center p-3">
              {/* Timer */}
              <div className="text-center">
                <div className="text-3xl font-bold tabular-nums text-foreground">
                  {machineState.shot_timer?.toFixed(1) ?? '0.0'}
                </div>
                <div className="text-xs text-muted-foreground">{t('controlCenter.metrics.time')}</div>
              </div>

              <SensorGauge
                value={machineState.pressure}
                min={0}
                max={15}
                unit="bar"
                label={t('controlCenter.metrics.pressureLabel')}
                size={130}
                stale={machineState._stale}
              />

              <SensorGauge
                value={machineState.flow_rate}
                min={0}
                max={8}
                unit="ml/s"
                label={t('controlCenter.metrics.flowLabel')}
                size={130}
                stale={machineState._stale}
              />

              {/* Weight bar */}
              <div className="w-full text-center space-y-1">
                <div className="text-lg font-bold tabular-nums">
                  {machineState.shot_weight?.toFixed(1) ?? '0.0'}
                  {machineState.target_weight != null && (
                    <span className="text-xs text-muted-foreground font-normal">
                      /{machineState.target_weight.toFixed(0)}g
                    </span>
                  )}
                </div>
                {machineState.target_weight != null && machineState.target_weight > 0 && (
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-200"
                      style={{
                        width: `${Math.min(100, ((machineState.shot_weight ?? 0) / machineState.target_weight) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{t('controlCenter.metrics.weight')}</div>
              </div>

              {/* Temperature */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Thermometer size={14} weight="duotone" />
                {machineState.brew_head_temperature?.toFixed(1) ?? '—'}°C
              </div>
            </Card>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center">
            {/* Stop — confirm */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="h-11 px-6">
                  <Stop size={18} weight="fill" className="mr-2" />
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

            {/* Abort — confirm */}
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
                  <AlertDialogAction onClick={() => cmd(abortShot, 'aborting')}>{t('common.confirm')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
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
                {onAnalyze && (
                  <Button variant="dark-brew" className="h-11 px-6" onClick={onAnalyze}>
                    {t('controlCenter.liveShot.analyzeShot')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-11 px-6"
                  onClick={() => cmd(purge, 'purging')}
                >
                  <Drop size={16} weight="fill" className="mr-2" />
                  {t('controlCenter.liveShot.purgeAfterShot')}
                </Button>
                <Button variant="outline" className="h-11 px-6" onClick={onBack}>
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

function MetricTile({ icon, value, label }: { icon?: React.ReactNode; value: string; label: string }) {
  return (
    <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
      <div className="text-sm font-bold tabular-nums text-foreground flex items-center justify-center gap-1">
        {icon}
        {value}
      </div>
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
