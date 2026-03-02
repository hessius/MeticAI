import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Scales, Timer, Drop, Pause, Play, ArrowClockwise, Target } from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { tareScale } from '@/lib/mqttCommands'

interface PourOverViewProps {
  machineState: MachineState
  onBack: () => void
}

function formatStopwatch(totalMs: number): string {
  const totalSeconds = Math.floor(totalMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centiseconds = Math.floor((totalMs % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

interface WeightPoint {
  t: number
  w: number
  flow?: number // g/s flow rate at this point
}

function WeightTrend({ points, targetWeight }: { points: WeightPoint[]; targetWeight: number | null }) {
  const { t } = useTranslation()
  const width = 360
  const height = 96

  // X-axis: default to 3 minutes (180s), expand in 30-second increments
  const DEFAULT_X_DURATION = 180  // 3 minutes
  const X_INCREMENT = 30  // 30 second increments
  const lastTime = points.length > 0 ? (points[points.length - 1]?.t ?? 0) : 0
  const xAxisMax = lastTime <= DEFAULT_X_DURATION
    ? DEFAULT_X_DURATION
    : Math.ceil(lastTime / X_INCREMENT) * X_INCREMENT

  if (points.length < 2) {
    return (
      <div className="h-24 rounded-lg border border-border/60 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
        {t('pourOver.waitingForWeight')}
      </div>
    )
  }

  const maxPointWeight = Math.max(...points.map(point => point.w), 0.1)
  const yMax = Math.max(maxPointWeight, targetWeight ?? 0, 1)

  // Flow rate axis: independent scale
  const flowValues = points.map(p => p.flow ?? 0).filter(f => f >= 0)
  const maxFlow = Math.max(...flowValues, 1)

  const toX = (time: number) => (time / xAxisMax) * width
  const toY = (weight: number) => height - (weight / yMax) * height
  const toFlowY = (flow: number) => height - (flow / maxFlow) * height

  const polyline = points
    .map(point => `${toX(point.t).toFixed(2)},${toY(point.w).toFixed(2)}`)
    .join(' ')

  // Smooth flow data using a simple moving average
  const flowPoints = points.filter(point => point.flow !== undefined && point.flow >= 0)
  const SMOOTH_WINDOW = 5
  const smoothedFlowPoints = flowPoints.map((point, i) => {
    const windowStart = Math.max(0, i - Math.floor(SMOOTH_WINDOW / 2))
    const windowEnd = Math.min(flowPoints.length, i + Math.ceil(SMOOTH_WINDOW / 2))
    const windowSlice = flowPoints.slice(windowStart, windowEnd)
    const avgFlow = windowSlice.reduce((sum, p) => sum + (p.flow ?? 0), 0) / windowSlice.length
    return { t: point.t, flow: avgFlow }
  })

  const flowPolyline = smoothedFlowPoints
    .map(point => `${toX(point.t).toFixed(2)},${toFlowY(point.flow).toFixed(2)}`)
    .join(' ')

  const targetY = targetWeight !== null ? toY(targetWeight) : null

  // Format time for display (e.g., 180s -> "3:00", 210s -> "3:30")
  const formatAxisTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 p-2">
      <div className="flex items-stretch gap-1">
        {/* Y-axis: Weight scale (left) */}
        <div className="flex flex-col justify-between text-[9px] text-muted-foreground w-6 text-right pr-0.5">
          <span>{Math.round(yMax)}g</span>
          <span>0g</span>
        </div>
        {/* Chart area */}
        <svg viewBox={`0 0 ${width} ${height}`} className="flex-1 h-20" preserveAspectRatio="none" role="img" aria-label={t('pourOver.weightTrendLabel')}>
          {targetY !== null && (
            <line x1="0" y1={targetY} x2={width} y2={targetY} stroke="currentColor" strokeDasharray="4 3" className="text-primary/60" />
          )}
          <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground" points={polyline} />
          {flowPolyline && (
            <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" className="text-primary" points={flowPolyline} />
          )}
        </svg>
        {/* Y-axis: Flow scale (right) */}
        <div className="flex flex-col justify-between text-[9px] text-primary/60 w-7 text-left pl-0.5">
          <span>{maxFlow.toFixed(1)}</span>
          <span>0</span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
        <span className="w-6" />
        <span>0:00</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-0.5 bg-foreground rounded" /> {t('pourOver.weightLegend')}
          <span className="inline-block w-3 h-0.5 bg-primary/50 rounded" /> {t('pourOver.flowLegend')}
        </span>
        <span>{formatAxisTime(xAxisMax)}</span>
        <span className="w-7" />
      </div>
    </div>
  )
}

export function PourOverView({ machineState, onBack }: PourOverViewProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'free' | 'ratio'>('free')
  const [isRunning, setIsRunning] = useState(false)
  const [baseElapsedMs, setBaseElapsedMs] = useState(0)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [doseGrams, setDoseGrams] = useState('20')
  const [brewRatio, setBrewRatio] = useState('15')
  const [autoStartEnabled, setAutoStartEnabled] = useState(true)
  const [bloomEnabled, setBloomEnabled] = useState(false)
  const [bloomSeconds, setBloomSeconds] = useState('30')
  const [weightTrend, setWeightTrend] = useState<WeightPoint[]>([])
  const [flowRate, setFlowRate] = useState<number>(0)

  const previousWeightRef = useRef<number | null>(null)
  const previousWeightTimestampRef = useRef<number | null>(null)
  const trendStartTimestampRef = useRef<number | null>(null)
  const justTaredRef = useRef(false)
  // Track continuous flow start time for auto-start confirmation
  const flowStartTimestampRef = useRef<number | null>(null)
  const FLOW_CONFIRMATION_MS = 2000 // Require 2 seconds of continuous flow

  const { cmd } = useMachineActions(machineState)

  const handleTare = useCallback(() => {
    // Mark that we just tared so the next weight update doesn't auto-start
    justTaredRef.current = true
    // Reset graph and refs
    setWeightTrend([])
    previousWeightRef.current = null
    previousWeightTimestampRef.current = null
    trendStartTimestampRef.current = null
    flowStartTimestampRef.current = null
    setFlowRate(0)
    // Send tare command
    cmd(tareScale, 'tared')
  }, [cmd])

  useEffect(() => {
    if (!isRunning) return
    const id = window.setInterval(() => setTick(prev => prev + 1), 50)
    return () => window.clearInterval(id)
  }, [isRunning])

  const elapsedMs = useMemo(() => {
    if (!isRunning || startedAtMs === null) {
      return baseElapsedMs
    }
    return baseElapsedMs + (Date.now() - startedAtMs)
  }, [baseElapsedMs, isRunning, startedAtMs, tick])

  const startTimer = useCallback((backdateMs = 0) => {
    // backdateMs: how far back to set the timer (for auto-start confirmation delay)
    setStartedAtMs(Date.now() - backdateMs)
    setIsRunning(true)
  }, [])

  const pauseTimer = useCallback(() => {
    if (startedAtMs !== null) {
      setBaseElapsedMs(prev => prev + (Date.now() - startedAtMs))
    }
    setStartedAtMs(null)
    setIsRunning(false)
  }, [startedAtMs])

  const startOrPause = () => {
    if (isRunning) {
      pauseTimer()
      return
    }

    startTimer()
  }

  const resetTimer = () => {
    setIsRunning(false)
    setStartedAtMs(null)
    setBaseElapsedMs(0)
  }

  const weight = machineState.shot_weight ?? 0
  const parsedDose = parsePositiveNumber(doseGrams)
  const parsedRatio = parsePositiveNumber(brewRatio)
  const targetWeight = parsedDose !== null && parsedRatio !== null ? parsedDose * parsedRatio : null
  const remainingWeight = targetWeight !== null ? Math.max(targetWeight - weight, 0) : null
  const ratioProgress = targetWeight !== null && targetWeight > 0 ? Math.min((weight / targetWeight) * 100, 100) : 0

  useEffect(() => {
    const currentWeight = machineState.shot_weight
    if (currentWeight === null || currentWeight === undefined) {
      return
    }

    // Skip auto-start logic immediately after tare
    const wasTare = justTaredRef.current
    if (wasTare) {
      justTaredRef.current = false
      // Don't record this weight for auto-start detection
      previousWeightRef.current = currentWeight
      previousWeightTimestampRef.current = Date.now()
      return
    }

    const now = Date.now()

    if (trendStartTimestampRef.current === null) {
      trendStartTimestampRef.current = now
    }
    const trendTimeSeconds = (now - trendStartTimestampRef.current) / 1000

    const previousWeight = previousWeightRef.current
    const previousTimestamp = previousWeightTimestampRef.current

    // Compute instantaneous flow rate (g/s)
    let currentFlowRate = 0
    if (previousWeight !== null && previousTimestamp !== null) {
      const deltaSeconds = Math.max((now - previousTimestamp) / 1000, 0.01)
      currentFlowRate = Math.max((currentWeight - previousWeight) / deltaSeconds, 0)
    }
    setFlowRate(currentFlowRate)

    setWeightTrend(prev => {
      const next = [...prev, { t: trendTimeSeconds, w: currentWeight, flow: currentFlowRate }]
      // Keep enough points for a full 5-minute pour-over (~900 points at 3Hz)
      return next.slice(-900)
    })

    if (
      autoStartEnabled
      && !isRunning
      && previousWeight !== null
      && previousTimestamp !== null
      && currentWeight > previousWeight
      && currentWeight >= 1 // Require at least 1g to avoid false starts from taring
    ) {
      const deltaSeconds = Math.max((now - previousTimestamp) / 1000, 0.01)
      const gramsPerSecond = (currentWeight - previousWeight) / deltaSeconds
      const isValidFlow = gramsPerSecond >= 0.5 && gramsPerSecond <= 14.5

      if (isValidFlow) {
        // Track when continuous flow started
        if (flowStartTimestampRef.current === null) {
          flowStartTimestampRef.current = now
        }
        // Check if we've had continuous flow for the confirmation period
        const flowDuration = now - flowStartTimestampRef.current
        if (flowDuration >= FLOW_CONFIRMATION_MS) {
          // Start timer, backdated to when flow actually started
          startTimer(flowDuration)
          flowStartTimestampRef.current = null
        }
      } else {
        // Flow stopped or out of range, reset confirmation
        flowStartTimestampRef.current = null
      }
    } else if (!isRunning) {
      // No valid flow condition, reset confirmation
      flowStartTimestampRef.current = null
    }

    previousWeightRef.current = currentWeight
    previousWeightTimestampRef.current = now
  }, [autoStartEnabled, isRunning, machineState.shot_weight, startTimer])

  return (
    <motion.div
      key="pour-over"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="p-6 space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 -mt-1 -mx-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={22} weight="bold" />
          </Button>
          <h2 className="text-lg font-bold tracking-tight">{t('pourOver.title')}</h2>
        </div>

        {/* ── 1. Weight + Timer + Flow rate (always visible) ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Scales size={14} weight="bold" />
              {t('pourOver.weight')}
            </div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{weight.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">{t('pourOver.unitGrams')}</div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1 col-span-2 sm:col-span-1 order-first sm:order-none">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Timer size={14} weight="bold" />
              {t('pourOver.timer')}
            </div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{formatStopwatch(elapsedMs)}</div>
            <div className="text-xs text-muted-foreground">{t('pourOver.unitTime')}</div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Drop size={14} weight="bold" />
              {t('pourOver.flow')}
            </div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{flowRate.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">{t('pourOver.unitFlowRate')}</div>
          </div>
        </div>

        {/* ── 2. Target + Remaining (ratio mode only) ── */}
        {mode === 'ratio' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Target size={12} weight="bold" />
                {t('pourOver.targetWater')}
              </p>
              <p className="text-xl sm:text-2xl font-semibold tabular-nums">
                {targetWeight !== null ? `${targetWeight.toFixed(1)} g` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('pourOver.remaining')}</p>
              <p className="text-xl sm:text-2xl font-semibold tabular-nums">
                {remainingWeight !== null ? `${remainingWeight.toFixed(1)} g` : '—'}
              </p>
            </div>
          </div>
        )}

        {/* ── 3. Graph + Progress (ratio mode only) ── */}
        {mode === 'ratio' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('pourOver.progress')}</span>
              <span>{ratioProgress.toFixed(0)}%</span>
            </div>
            <Progress value={ratioProgress} />
            <WeightTrend points={weightTrend} targetWeight={targetWeight} />
          </div>
        )}

        {/* ── Free mode: weight trend chart ── */}
        {mode === 'free' && (
          <WeightTrend points={weightTrend} targetWeight={null} />
        )}

        {/* ── 4. Action buttons (always visible) ── */}
        <div className="grid grid-cols-3 gap-2.5">
          <Button
            onClick={startOrPause}
            variant="dark-brew"
            className="h-11 rounded-xl"
          >
            {isRunning ? <Pause size={18} weight="fill" className="mr-1.5" /> : <Play size={18} weight="fill" className="mr-1.5" />}
            {isRunning ? t('pourOver.pause') : t('pourOver.start')}
          </Button>

          <Button
            onClick={resetTimer}
            variant="outline"
            className="h-11"
          >
            <ArrowClockwise size={18} weight="bold" className="mr-1.5" />
            {t('pourOver.reset')}
          </Button>

          <Button
            onClick={handleTare}
            variant="outline"
            className="h-11"
            disabled={!machineState.connected}
          >
            <Drop size={18} weight="duotone" className="mr-1.5" />
            {t('pourOver.tare')}
          </Button>
        </div>

        {/* ── 5. Dose + ratio inputs (ratio mode — set once before brewing) ── */}
        {mode === 'ratio' && (
          <div className="space-y-3">
            {/* Dose row */}
            <div className="space-y-1.5">
              <Label htmlFor="pour-over-dose">{t('pourOver.doseLabel')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pour-over-dose"
                  inputMode="decimal"
                  value={doseGrams}
                  onChange={(event) => setDoseGrams(event.target.value)}
                  placeholder="20"
                  className="w-20 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-10 px-3"
                  disabled={!machineState.connected || weight <= 0}
                  onClick={() => setDoseGrams(weight.toFixed(1))}
                  title={t('pourOver.weighFromScaleTitle')}
                >
                  <Scales size={16} weight="bold" className="mr-1.5" />
                  {t('pourOver.weighFromScale')}
                </Button>
              </div>
            </div>
            {/* Ratio row */}
            <div className="space-y-1.5">
              <Label htmlFor="pour-over-ratio">{t('pourOver.ratioLabel')}</Label>
              <Input
                id="pour-over-ratio"
                inputMode="decimal"
                value={brewRatio}
                onChange={(event) => setBrewRatio(event.target.value)}
                placeholder="15"
                className="w-20 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
              />
            </div>
          </div>
        )}

        {/* ── Settings (auto-start, bloom) ── */}
        <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t('pourOver.autoStartTimer')}</p>
              <p className="text-xs text-muted-foreground">{t('pourOver.autoStartDescription')}</p>
            </div>
            <Switch checked={autoStartEnabled} onCheckedChange={setAutoStartEnabled} className="shrink-0" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{t('pourOver.bloomIndicator')}</p>
              <p className="text-xs text-muted-foreground">{t('pourOver.bloomDescription')}</p>
            </div>
            <Switch checked={bloomEnabled} onCheckedChange={setBloomEnabled} className="shrink-0" />
          </div>

          {bloomEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="pour-over-bloom">{t('pourOver.bloomDuration')}</Label>
              <Input
                id="pour-over-bloom"
                inputMode="numeric"
                value={bloomSeconds}
                onChange={(event) => setBloomSeconds(event.target.value)}
                placeholder="30"
                className="w-16 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
              />
            </div>
          )}
        </div>

        {!machineState.connected && (
          <p className="text-xs text-center text-muted-foreground">
            {t('pourOver.offlineNotice')}
          </p>
        )}

        {/* ── 6. Mode tabs at the bottom ── */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'free' | 'ratio')}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="free">{t('pourOver.freeMode')}</TabsTrigger>
            <TabsTrigger value="ratio">{t('pourOver.ratioMode')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>
    </motion.div>
  )
}
