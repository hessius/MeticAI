import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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
  const width = 360
  const height = 96

  if (points.length < 2) {
    return (
      <div className="h-24 rounded-lg border border-border/60 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
        Waiting for weight updates…
      </div>
    )
  }

  const maxX = points[points.length - 1]?.t ?? 1
  const maxPointWeight = Math.max(...points.map(point => point.w), 0.1)
  const yMax = Math.max(maxPointWeight, targetWeight ?? 0, 1)

  // Flow rate axis: independent scale
  const flowValues = points.map(p => p.flow ?? 0).filter(f => f >= 0)
  const maxFlow = Math.max(...flowValues, 1)

  const toX = (time: number) => (time / maxX) * width
  const toY = (weight: number) => height - (weight / yMax) * height
  const toFlowY = (flow: number) => height - (flow / maxFlow) * height

  const polyline = points
    .map(point => `${toX(point.t).toFixed(2)},${toY(point.w).toFixed(2)}`)
    .join(' ')

  const flowPolyline = points
    .filter(point => point.flow !== undefined && point.flow >= 0)
    .map(point => `${toX(point.t).toFixed(2)},${toFlowY(point.flow!).toFixed(2)}`)
    .join(' ')

  const targetY = targetWeight !== null ? toY(targetWeight) : null

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20" preserveAspectRatio="none" role="img" aria-label="Weight trend">
        {targetY !== null && (
          <line x1="0" y1={targetY} x2={width} y2={targetY} stroke="currentColor" strokeDasharray="4 3" className="text-primary/60" />
        )}
        <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground" points={polyline} />
        {flowPolyline && (
          <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" className="text-primary" points={flowPolyline} />
        )}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
        <span>0s</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-0.5 bg-foreground rounded" /> weight
          <span className="inline-block w-3 h-0.5 bg-primary/50 rounded" /> flow
        </span>
        <span>{Math.round(maxX)}s</span>
      </div>
    </div>
  )
}

export function PourOverView({ machineState, onBack }: PourOverViewProps) {
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

  const { cmd } = useMachineActions(machineState)

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

  const startTimer = useCallback(() => {
    setStartedAtMs(Date.now())
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
  const parsedBloomSeconds = parsePositiveNumber(bloomSeconds)
  const targetWeight = parsedDose !== null && parsedRatio !== null ? parsedDose * parsedRatio : null
  const remainingWeight = targetWeight !== null ? Math.max(targetWeight - weight, 0) : null
  const ratioProgress = targetWeight !== null && targetWeight > 0 ? Math.min((weight / targetWeight) * 100, 100) : 0
  const bloomRemainingSeconds = bloomEnabled && parsedBloomSeconds !== null
    ? Math.max(Math.ceil((parsedBloomSeconds * 1000 - elapsedMs) / 1000), 0)
    : 0

  useEffect(() => {
    const currentWeight = machineState.shot_weight
    if (currentWeight === null || currentWeight === undefined) {
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
      return next.slice(-90)
    })

    if (
      autoStartEnabled
      && !isRunning
      && previousWeight !== null
      && previousTimestamp !== null
      && currentWeight > previousWeight
    ) {
      const deltaSeconds = Math.max((now - previousTimestamp) / 1000, 0.01)
      const gramsPerSecond = (currentWeight - previousWeight) / deltaSeconds
      if (gramsPerSecond >= 0.5 && gramsPerSecond <= 14.5) {
        startTimer()
      }
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
            aria-label="Back"
          >
            <ArrowLeft size={22} weight="bold" />
          </Button>
          <h2 className="text-lg font-bold tracking-tight">Pour-over</h2>
        </div>

        {/* ── 1. Weight + Timer + Flow rate (always visible) ── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Scales size={14} weight="bold" />
              Weight
            </div>
            <div className="text-3xl font-bold tabular-nums text-foreground">{weight.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">g</div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Timer size={14} weight="bold" />
              Timer
            </div>
            <div className="text-3xl font-bold tabular-nums text-foreground">{formatStopwatch(elapsedMs)}</div>
            <div className="text-xs text-muted-foreground">mm:ss</div>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
              <Drop size={14} weight="bold" />
              Flow
            </div>
            <div className="text-3xl font-bold tabular-nums text-foreground">{flowRate.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">g/s</div>
          </div>
        </div>

        {/* ── 2. Target + Remaining (ratio mode only) ── */}
        {mode === 'ratio' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Target size={12} weight="bold" />
                Target water
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {targetWeight !== null ? `${targetWeight.toFixed(1)} g` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Remaining</p>
              <p className="text-2xl font-semibold tabular-nums">
                {remainingWeight !== null ? `${remainingWeight.toFixed(1)} g` : '—'}
              </p>
            </div>
          </div>
        )}

        {/* ── 3. Graph + Progress (ratio mode only) ── */}
        {mode === 'ratio' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{ratioProgress.toFixed(0)}%</span>
            </div>
            <Progress value={ratioProgress} />
            <WeightTrend points={weightTrend} targetWeight={targetWeight} />
          </div>
        )}

        {/* ── Free mode: weight trend chart ── */}
        {mode === 'free' && weightTrend.length >= 2 && (
          <WeightTrend points={weightTrend} targetWeight={null} />
        )}

        {/* ── 4. Action buttons (always visible) ── */}
        <div className="grid grid-cols-3 gap-2.5">
          <Button
            onClick={startOrPause}
            variant="dark-brew"
            className="h-11"
          >
            {isRunning ? <Pause size={18} weight="fill" className="mr-1.5" /> : <Play size={18} weight="fill" className="mr-1.5" />}
            {isRunning ? 'Pause' : 'Start'}
          </Button>

          <Button
            onClick={resetTimer}
            variant="outline"
            className="h-11"
          >
            <ArrowClockwise size={18} weight="bold" className="mr-1.5" />
            Reset
          </Button>

          <Button
            onClick={() => cmd(tareScale, 'tared')}
            variant="outline"
            className="h-11"
            disabled={!machineState.connected}
          >
            <Drop size={18} weight="duotone" className="mr-1.5" />
            Tare
          </Button>
        </div>

        {/* ── 5. Dose + ratio inputs (ratio mode — set once before brewing) ── */}
        {mode === 'ratio' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pour-over-dose">Dose (g)</Label>
              <div className="flex gap-1.5">
                <Input
                  id="pour-over-dose"
                  inputMode="decimal"
                  value={doseGrams}
                  onChange={(event) => setDoseGrams(event.target.value)}
                  placeholder="20"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 h-10 w-10"
                  disabled={!machineState.connected || weight <= 0}
                  onClick={() => setDoseGrams(weight.toFixed(1))}
                  title="Capture current scale weight as dose"
                  aria-label="Weigh from scale"
                >
                  <Scales size={16} weight="bold" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pour-over-ratio">Ratio (1:x)</Label>
              <Input
                id="pour-over-ratio"
                inputMode="decimal"
                value={brewRatio}
                onChange={(event) => setBrewRatio(event.target.value)}
                placeholder="15"
              />
            </div>
          </div>
        )}

        {/* ── Settings (auto-start, bloom) ── */}
        <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto-start timer</p>
              <p className="text-xs text-muted-foreground">Starts when pour is detected, but ignores fast grounds-style spikes.</p>
            </div>
            <Switch checked={autoStartEnabled} onCheckedChange={setAutoStartEnabled} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Bloom indicator</p>
              <p className="text-xs text-muted-foreground">Shows a bloom countdown during the first seconds of brewing.</p>
            </div>
            <Switch checked={bloomEnabled} onCheckedChange={setBloomEnabled} />
          </div>

          {bloomEnabled && (
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="pour-over-bloom">Bloom duration (sec)</Label>
                <Input
                  id="pour-over-bloom"
                  inputMode="numeric"
                  value={bloomSeconds}
                  onChange={(event) => setBloomSeconds(event.target.value)}
                  placeholder="30"
                />
              </div>
              <div className="text-sm tabular-nums text-muted-foreground min-w-16 text-right pb-2">
                {bloomRemainingSeconds > 0 ? formatSeconds(bloomRemainingSeconds) : 'done'}
              </div>
            </div>
          )}
        </div>

        {!machineState.connected && (
          <p className="text-xs text-center text-muted-foreground">
            Machine is offline. Scale actions are disabled until connection is restored.
          </p>
        )}

        {/* ── 6. Mode tabs at the bottom ── */}
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'free' | 'ratio')}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="free">Free mode</TabsTrigger>
            <TabsTrigger value="ratio">Ratio mode</TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>
    </motion.div>
  )
}
