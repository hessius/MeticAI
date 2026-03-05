import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, ArrowRight, BookOpen, Scales, Timer, Drop, Pause, Play, Target, CircleNotch, Coffee, CheckCircle, XCircle } from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { tareScale, continueShot, stopShot } from '@/lib/mqttCommands'
import { preparePourOver, cleanupPourOver, forceCleanupPourOver, getPourOverPreferences, savePourOverPreferences } from '@/lib/pourOverApi'
import type { PourOverPreferences } from '@/lib/pourOverApi'
import { getRecipes, prepareRecipe } from '@/lib/pourOverApi'
import type { Recipe, RecipeStepTiming } from '@/types'
import { RecipeBreakdown } from './RecipeBreakdown'

interface PourOverViewProps {
  machineState: MachineState
  onBack: () => void
}

/** Machine integration lifecycle phases */
type MachineLifecycle = 'idle' | 'preparing' | 'ready' | 'brewing' | 'drawdown' | 'purging' | 'done' | 'error'

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

/** Increment/decrement button with hold-to-repeat support */
function IncrementButton({ onIncrement, label }: { onIncrement: () => void; label: string }) {
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const startIncrementing = useCallback(() => {
    onIncrement() // Fire once immediately
    // After 400ms delay, start repeating every 100ms
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(onIncrement, 100)
    }, 400)
  }, [onIncrement])

  const stopIncrementing = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopIncrementing()
  }, [stopIncrementing])

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-10 w-10 shrink-0 text-lg font-semibold select-none"
      onPointerDown={startIncrementing}
      onPointerUp={stopIncrementing}
      onPointerLeave={stopIncrementing}
      onPointerCancel={stopIncrementing}
    >
      {label}
    </Button>
  )
}

// Chart colors matching LiveShotView (from chartConstants.ts)
const CHART_COLORS = {
  weight: '#fbbf24',    // Amber/Yellow
  flow: '#67e8f9',      // Light cyan/blue
  targetLine: '#ef4444', // Red for target weight line
  bloomBackground: 'rgba(251, 191, 36, 0.15)', // Light amber for bloom phase
} as const

interface WeightTrendProps {
  points: WeightPoint[]
  targetWeight: number | null
  mode: 'free' | 'ratio' | 'recipe'
  /** Duration of bloom phase in seconds (0 = no bloom) */
  bloomDurationSeconds?: number
  /** Elapsed seconds at which the machine shot ended (vertical marker line) */
  machineEndTimeSeconds?: number
  recipeTimings?: RecipeStepTiming[]
}

function WeightTrend({ points, targetWeight, mode, bloomDurationSeconds = 0, machineEndTimeSeconds, recipeTimings }: WeightTrendProps) {
  const { t } = useTranslation()
  const width = 360
  // Base height varies by viewport: taller on desktop (h-40 → 160), mobile (h-32 → 128)
  // We use CSS classes for responsive sizing; SVG viewBox uses a fixed height
  const svgHeight = 160

  // X-axis: default to 3 minutes (180s), expand in 30-second increments
  const DEFAULT_X_DURATION = 180  // 3 minutes
  const X_INCREMENT = 30  // 30 second increments
  const lastTime = points.length > 0 ? (points[points.length - 1]?.t ?? 0) : 0
  const recipeTotal = mode === 'recipe' && recipeTimings && recipeTimings.length > 0
    ? recipeTimings[recipeTimings.length - 1]?.endTimeSec ?? 0
    : 0
  const xAxisMin = recipeTotal > DEFAULT_X_DURATION ? recipeTotal : DEFAULT_X_DURATION
  const xAxisMax = lastTime <= xAxisMin
    ? xAxisMin
    : Math.ceil(lastTime / X_INCREMENT) * X_INCREMENT

  // Always show waiting state when no data, on both mobile and desktop
  if (points.length < 2) {
    return (
      <div className="h-32 sm:h-40 rounded-lg border border-border/60 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
        {t('pourOver.waitingForWeight')}
      </div>
    )
  }

  // Weight scale logic:
  // - Free mode: fixed 0-300g scale
  // - Ratio mode: target weight + 25g, with 50g increments when within 10 of max
  const maxPointWeight = Math.max(...points.map(point => point.w), 0.1)
  let yMax: number
  if (mode === 'free') {
    yMax = 300 // Fixed scale for free mode
  } else if (mode === 'recipe') {
    const recipeMaxWeight = recipeTimings && recipeTimings.length > 0
      ? Math.max(...recipeTimings.map(step => step.cumulativeWeight), 0)
      : 0
    const baseMax = Math.max(recipeMaxWeight + 25, maxPointWeight + 25)
    yMax = Math.ceil(baseMax / 50) * 50
    if (yMax < 100) yMax = 100
  } else {
    // Ratio mode: target + 25g, expanding in 50g increments
    const baseMax = (targetWeight ?? 0) + 25
    // If current weight is within 10g of the max, expand by 50g
    if (maxPointWeight > baseMax - 10) {
      yMax = Math.ceil((maxPointWeight + 10) / 50) * 50
    } else {
      yMax = Math.max(baseMax, maxPointWeight + 25)
    }
  }

  // Flow rate axis: fixed 0-35 g/s scale — clamp spikes so they
  // don't blow up the axis (raw scale deltas can spike on tare/pour start)
  const FLOW_SCALE_MAX = 35
  const FLOW_CLAMP = 50  // discard any reading above 50 g/s as noise
  const maxFlow = FLOW_SCALE_MAX

  const toX = (time: number) => (time / xAxisMax) * width
  const toY = (weight: number) => svgHeight - (weight / yMax) * svgHeight
  const toFlowY = (flow: number) => svgHeight - (flow / maxFlow) * svgHeight

  const polyline = points
    .map(point => `${toX(point.t).toFixed(2)},${toY(point.w).toFixed(2)}`)
    .join(' ')

  // Smooth flow data using a wider rolling average and clamp outliers
  const flowPoints = points.filter(point => point.flow !== undefined && point.flow >= 0)
  const SMOOTH_WINDOW = 15  // ~3-5 seconds at typical update rate
  const smoothedFlowPoints = flowPoints.map((point, i) => {
    const windowStart = Math.max(0, i - Math.floor(SMOOTH_WINDOW / 2))
    const windowEnd = Math.min(flowPoints.length, i + Math.ceil(SMOOTH_WINDOW / 2))
    const windowSlice = flowPoints.slice(windowStart, windowEnd)
    const avgFlow = windowSlice.reduce((sum, p) => sum + Math.min(p.flow ?? 0, FLOW_CLAMP), 0) / windowSlice.length
    return { t: point.t, flow: Math.min(avgFlow, FLOW_CLAMP) }
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

  // Generate Y-axis ticks for weight scale
  // Use nice round numbers (e.g., 0, 50, 100, 150, 200, 250, 300)
  const getWeightTicks = () => {
    if (yMax <= 50) return [0, 25, 50]
    if (yMax <= 100) return [0, 50, 100]
    if (yMax <= 150) return [0, 50, 100, 150]
    if (yMax <= 200) return [0, 100, 200]
    if (yMax <= 300) return [0, 100, 200, 300]
    // For larger scales, use 100g increments
    const ticks: number[] = []
    for (let v = 0; v <= yMax; v += 100) {
      ticks.push(v)
    }
    return ticks
  }
  const weightTicks = getWeightTicks()

  // Generate Y-axis ticks for flow scale
  const getFlowTicks = () => {
    if (maxFlow <= 10) return [0, 5, 10]
    if (maxFlow <= 20) return [0, 10, 20]
    if (maxFlow <= 35) return [0, 10, 20, 35]
    return [0, Math.round(maxFlow / 2), Math.round(maxFlow)]
  }
  const flowTicks = getFlowTicks()

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 p-2">
      <div className="flex items-stretch gap-1">
        {/* Y-axis: Weight scale (left) - positioned to match grid lines */}
        <div className="relative text-[9px] w-7 text-right pr-0.5 text-[#fbbf24]">
          {weightTicks.map(tick => (
            <span
              key={`wl-${tick}`}
              className="absolute right-0.5 -translate-y-1/2 leading-none"
              style={{ top: `${(1 - tick / yMax) * 100}%` }}
            >
              {tick}g
            </span>
          ))}
        </div>
        {/* Chart area - responsive height: h-32 (128px) mobile, h-40 (160px) desktop */}
        <svg viewBox={`0 0 ${width} ${svgHeight}`} className="flex-1 h-32 sm:h-40" preserveAspectRatio="none" role="img" aria-label={t('pourOver.weightTrendLabel')}>
          {/* Bloom phase background - amber tinted area */}
          {bloomDurationSeconds > 0 && (
            <rect
              x="0"
              y="0"
              width={toX(bloomDurationSeconds)}
              height={svgHeight}
              fill={CHART_COLORS.bloomBackground}
            />
          )}
          {/* Horizontal grid lines at weight tick positions */}
          {weightTicks.map(tick => (
            <line
              key={`grid-${tick}`}
              x1="0"
              y1={toY(tick)}
              x2={width}
              y2={toY(tick)}
              stroke="currentColor"
              strokeOpacity="0.15"
              strokeWidth="1"
            />
          ))}
          {/* Ratio mode: horizontal target weight line */}
          {mode !== 'recipe' && targetY !== null && (
            <line x1="0" y1={targetY} x2={width} y2={targetY} stroke={CHART_COLORS.targetLine} strokeDasharray="4 3" strokeOpacity="0.8" />
          )}
          {/* Recipe mode: step-function target weight curve */}
          {mode === 'recipe' && recipeTimings && recipeTimings.length > 0 && (() => {
            const pts: string[] = [`${toX(0).toFixed(2)},${toY(0).toFixed(2)}`]
            let prevWeight = 0
            for (const timing of recipeTimings) {
              if (timing.action === 'bloom' || timing.action === 'pour') {
                pts.push(`${toX(timing.startTimeSec).toFixed(2)},${toY(prevWeight).toFixed(2)}`)
                pts.push(`${toX(timing.endTimeSec).toFixed(2)},${toY(timing.cumulativeWeight).toFixed(2)}`)
                prevWeight = timing.cumulativeWeight
              } else {
                pts.push(`${toX(timing.startTimeSec).toFixed(2)},${toY(prevWeight).toFixed(2)}`)
                pts.push(`${toX(timing.endTimeSec).toFixed(2)},${toY(prevWeight).toFixed(2)}`)
              }
            }
            pts.push(`${toX(xAxisMax).toFixed(2)},${toY(prevWeight).toFixed(2)}`)
            return (
              <polyline
                fill="none"
                stroke={CHART_COLORS.targetLine}
                strokeDasharray="4 3"
                strokeOpacity="0.7"
                strokeWidth="1.5"
                points={pts.join(' ')}
              />
            )
          })()}
          {/* Weight line - amber/yellow matching LiveShotView */}
          <polyline fill="none" stroke={CHART_COLORS.weight} strokeWidth="2" points={polyline} />
          {/* Flow line - cyan/blue matching LiveShotView */}
          {flowPolyline && (
            <polyline fill="none" stroke={CHART_COLORS.flow} strokeWidth="1.5" strokeOpacity="0.7" points={flowPolyline} />
          )}
          {/* Machine shot end marker — green dashed vertical line */}
          {machineEndTimeSeconds !== undefined && machineEndTimeSeconds > 0 && (
            <line
              x1={toX(machineEndTimeSeconds)}
              y1={0}
              x2={toX(machineEndTimeSeconds)}
              y2={svgHeight}
              stroke="#22c55e"
              strokeDasharray="3 2"
              strokeWidth="1.5"
              strokeOpacity="0.8"
            />
          )}
        </svg>
        {/* Y-axis: Flow scale (right) - positioned to match grid lines */}
        <div className="relative text-[9px] w-10 text-left pl-0.5 text-[#67e8f9]/80">
          {flowTicks.map(tick => (
            <span
              key={`fl-${tick}`}
              className="absolute left-0.5 -translate-y-1/2 leading-none"
              style={{ top: `${(1 - tick / maxFlow) * 100}%` }}
            >
              {tick} g/s
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
        <span className="w-7" />
        <span>0:00</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-0.5 bg-[#fbbf24] rounded" /> {t('pourOver.weightLegend')}
          <span className="inline-block w-3 h-0.5 bg-[#67e8f9]/70 rounded" /> {t('pourOver.flowLegend')}
        </span>
        <span>{formatAxisTime(xAxisMax)}</span>
        <span className="w-10" />
      </div>
    </div>
  )
}

export function PourOverView({ machineState, onBack }: PourOverViewProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'free' | 'ratio' | 'recipe'>('free')
  const [isRunning, setIsRunning] = useState(false)
  const [baseElapsedMs, setBaseElapsedMs] = useState(0)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [doseGrams, setDoseGrams] = useState('20')
  const [brewRatio, setBrewRatio] = useState('15')
  const [autoStartEnabled, setAutoStartEnabled] = useState(true)
  const [bloomEnabled, setBloomEnabled] = useState(true)
  const [bloomSeconds, setBloomSeconds] = useState('30')
  const [weightTrend, setWeightTrend] = useState<WeightPoint[]>([])
  const [flowRate, setFlowRate] = useState<number>(0)

  // Recipe mode state
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoading, setRecipesLoading] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [recipeCurrentStep, setRecipeCurrentStep] = useState(0)
  const [recipeShowBreakdown, setRecipeShowBreakdown] = useState(false)
  // 'weight': advance pour steps when scale reaches target; 'time': advance all steps by timer
  const [recipeProgressionMode, setRecipeProgressionMode] = useState<'weight' | 'time'>('weight')

  // Machine integration state
  const [meticulousIntegration, setMeticulousIntegration] = useState(false)
  const [machineLifecycle, setMachineLifecycle] = useState<MachineLifecycle>('idle')
  // Elapsed time at which the machine shot ended (for graph marker + timer annotation)
  const [machineEndElapsedMs, setMachineEndElapsedMs] = useState<number | null>(null)
  // Track previous brewing state for transition detection
  const prevBrewingRef = useRef(false)
  // Always-current machine state string for async polling
  const machineStateRef = useRef(machineState.state)

  // ── Server-side preferences persistence ──
  const prefsRef = useRef<PourOverPreferences | null>(null)
  const prefsLoadedRef = useRef(false)

  // Load preferences from server on mount
  useEffect(() => {
    let cancelled = false
    getPourOverPreferences()
      .then((prefs) => {
        if (cancelled) return
        prefsRef.current = prefs
        prefsLoadedRef.current = true
        // Apply the current mode's preferences
        const mp = prefs.free // starts on 'free'
        setAutoStartEnabled(mp.autoStart)
        setBloomEnabled(mp.bloomEnabled)
        setBloomSeconds(String(mp.bloomSeconds))
        setMeticulousIntegration(mp.machineIntegration)
      })
      .catch(() => {
        // Silently keep defaults if server unreachable
        prefsLoadedRef.current = true
      })
    return () => { cancelled = true }
  }, [])

  // Apply stored preferences when mode changes (after initial load)
  const applyModePrefs = useCallback((newMode: 'free' | 'ratio' | 'recipe') => {
    setMode(newMode)
    if (!prefsRef.current) return
    if (newMode === 'recipe') {
      setMeticulousIntegration(prefsRef.current.recipe.machineIntegration)
      setAutoStartEnabled(prefsRef.current.recipe.autoStart ?? true)
      setRecipeProgressionMode(prefsRef.current.recipe.progressionMode ?? 'weight')
    } else {
      const mp = prefsRef.current[newMode]
      setAutoStartEnabled(mp.autoStart)
      setBloomEnabled(mp.bloomEnabled)
      setBloomSeconds(String(mp.bloomSeconds))
      setMeticulousIntegration(mp.machineIntegration)
    }
  }, [])

  // Persist preferences to server (fire-and-forget, debounce-safe via ref)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistPrefs = useCallback(() => {
    if (!prefsLoadedRef.current) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      if (prefsRef.current) {
        savePourOverPreferences(prefsRef.current).catch(() => {})
      }
    }, 500)
  }, [])

  // Helpers that update local state + prefs ref + trigger persist
  const updateAutoStart = useCallback((v: boolean) => {
    setAutoStartEnabled(v)
    if (prefsRef.current) {
      if (mode === 'free' || mode === 'ratio') {
        prefsRef.current[mode].autoStart = v
      } else {
        prefsRef.current.recipe.autoStart = v
      }
      persistPrefs()
    }
  }, [mode, persistPrefs])

  const updateBloomEnabled = useCallback((v: boolean) => {
    setBloomEnabled(v)
    if (prefsRef.current && (mode === 'free' || mode === 'ratio')) {
      prefsRef.current[mode].bloomEnabled = v; persistPrefs()
    }
  }, [mode, persistPrefs])

  const updateBloomSeconds = useCallback((v: string) => {
    setBloomSeconds(v)
    const n = Number(v)
    if (prefsRef.current && !isNaN(n) && n > 0 && (mode === 'free' || mode === 'ratio')) {
      prefsRef.current[mode].bloomSeconds = n
      persistPrefs()
    }
  }, [mode, persistPrefs])

  const updateMachineIntegration = useCallback((v: boolean) => {
    setMeticulousIntegration(v)
    if (prefsRef.current) {
      if (mode === 'recipe') {
        prefsRef.current.recipe.machineIntegration = v
      } else {
        prefsRef.current[mode].machineIntegration = v
      }
      persistPrefs()
    }
  }, [mode, persistPrefs])

  const previousWeightRef = useRef<number | null>(null)
  const previousWeightTimestampRef = useRef<number | null>(null)
  const trendStartTimestampRef = useRef<number | null>(null)
  const justTaredRef = useRef(false)
  // Track continuous flow start time for auto-start confirmation
  const flowStartTimestampRef = useRef<number | null>(null)
  // Require 2000ms of continuous valid flow to trigger auto-start
  // Longer confirmation prevents false starts from adding grounds to the brewer
  const FLOW_CONFIRMATION_MS = 2000

  const { cmd, isBrewing, isConnected, canStart, isClickToPurge } = useMachineActions(machineState)

  // Keep machineStateRef in sync with the latest prop value
  useEffect(() => {
    machineStateRef.current = machineState.state
  }, [machineState.state])

  /**
   * Poll machineStateRef until it matches `target` (case-insensitive),
   * checking every `intervalMs`. Rejects after `timeoutMs`.
   */
  const waitForState = useCallback(
    (target: string, timeoutMs = 8000, intervalMs = 150): Promise<void> =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs
        const check = () => {
          if ((machineStateRef.current ?? '').toLowerCase() === target.toLowerCase()) {
            resolve()
            return
          }
          if (Date.now() >= deadline) {
            reject(new Error(`Timed out waiting for machine state "${target}"`))
            return
          }
          setTimeout(check, intervalMs)
        }
        check()
      }),
    [],
  )

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
    setRecipeCurrentStep(0)
    // Reset graph data when timer is reset
    setWeightTrend([])
    trendStartTimestampRef.current = null
  }

  const weight = machineState.shot_weight ?? 0
  const parsedDose = parsePositiveNumber(doseGrams)
  const parsedRatio = parsePositiveNumber(brewRatio)
  const targetWeight = parsedDose !== null && parsedRatio !== null ? parsedDose * parsedRatio : null
  const remainingWeight = targetWeight !== null ? Math.max(targetWeight - weight, 0) : null
  const ratioProgress = targetWeight !== null && targetWeight > 0 ? Math.min((weight / targetWeight) * 100, 100) : 0

  const recipeTimings = useMemo((): RecipeStepTiming[] => {
    if (!selectedRecipe) return []
    let t = 0, cw = 0
    return selectedRecipe.protocol.map((step, i) => {
      const start = t
      const end = t + step.duration_s
      if (step.action === 'bloom' || step.action === 'pour') cw += step.water_g ?? 0
      let label: string
      if (step.action === 'bloom') label = step.water_g !== undefined ? `Bloom ${step.water_g}g` : 'Bloom'
      else if (step.action === 'pour') label = `Pour to ${cw}g`
      else if (step.action === 'wait') label = `Wait ${step.duration_s}s`
      else label = step.action.charAt(0).toUpperCase() + step.action.slice(1)
      t = end
      return { stepIndex: i, action: step.action, label, startTimeSec: start, endTimeSec: end, cumulativeWeight: cw, notes: step.notes }
    })
  }, [selectedRecipe])

  // ── Machine integration: detect brewing state transitions ──
  useEffect(() => {
    if (!meticulousIntegration) {
      prevBrewingRef.current = isBrewing
      return
    }

    const wasBrewing = prevBrewingRef.current
    prevBrewingRef.current = isBrewing

    // Machine started brewing → transition to brewing phase
    if (!wasBrewing && isBrewing && machineLifecycle === 'ready') {
      setMachineLifecycle('brewing')
      // Auto-start the local timer when machine starts brewing
      startTimer()
    }

    // Machine stopped brewing → transition to drawdown (timer keeps running!)
    if (wasBrewing && !isBrewing && machineLifecycle === 'brewing') {
      // Record the elapsed time for the graph marker and timer annotation
      const endMs = startedAtMs !== null
        ? baseElapsedMs + (Date.now() - startedAtMs)
        : baseElapsedMs
      setMachineEndElapsedMs(endMs)
      setMachineLifecycle('drawdown')
      // Cleanup profile in background — timer continues for drawdown timing
      cleanupPourOver()
        .then(() => {
          toast.success(t('pourOver.integration.cleanupSuccess'))
        })
        .catch(() => {
          // Purge may fail if user manually purged; try force cleanup
          forceCleanupPourOver()
            .then(() => toast.info(t('pourOver.integration.forceCleanupUsed')))
            .catch(() => toast.error(t('pourOver.integration.cleanupFailed')))
        })
    }
  }, [isBrewing, meticulousIntegration, machineLifecycle, t, startTimer, startedAtMs, baseElapsedMs])

  // ── Machine integration: detect click-to-purge state ──
  useEffect(() => {
    if (!meticulousIntegration) return
    if (isClickToPurge && machineLifecycle === 'brewing') {
      // Machine automatically transitioned to purge prompt — shot is done
      const endMs = startedAtMs !== null
        ? baseElapsedMs + (Date.now() - startedAtMs)
        : baseElapsedMs
      setMachineEndElapsedMs(endMs)
      setMachineLifecycle('drawdown')
      // Cleanup profile in background — timer continues for drawdown timing
      cleanupPourOver()
        .then(() => toast.success(t('pourOver.integration.cleanupSuccess')))
        .catch(() => {
          forceCleanupPourOver().catch(() => {})
        })
    }
  }, [isClickToPurge, meticulousIntegration, machineLifecycle, t, startedAtMs, baseElapsedMs])

  // ── Machine integration: handle start on machine ──
  const handleMachineStart = useCallback(async () => {
    if (!meticulousIntegration || machineLifecycle !== 'idle') return

    const parsedTargetWeight = targetWeight
    if (parsedTargetWeight === null || parsedTargetWeight <= 0) {
      toast.error(t('pourOver.integration.invalidWeight'))
      return
    }

    setMachineLifecycle('preparing')
    try {
      await preparePourOver({
        target_weight: parsedTargetWeight,
        bloom_enabled: bloomEnabled,
        bloom_seconds: parsePositiveNumber(bloomSeconds) ?? 30,
        dose_grams: parsePositiveNumber(doseGrams) ?? 20,
        brew_ratio: parsePositiveNumber(brewRatio) ?? 15,
      })
      setMachineLifecycle('ready')
      toast.success(t('pourOver.integration.profileReady'))

      // Auto-start the shot:
      // 1. First continue advances past the temperature control phase.
      // 2. Wait for machine to reach "Click to start" (press-to-start state).
      // 3. Second continue actually begins extraction.
      await cmd(continueShot, 'started')
      try {
        await waitForState('click to start')
      } catch {
        // Timeout — machine may already be past this state; try anyway
      }
      await cmd(continueShot, 'started')
    } catch (err) {
      setMachineLifecycle('error')
      toast.error(
        err instanceof Error
          ? err.message
          : t('pourOver.integration.prepareFailed'),
      )
    }
  }, [meticulousIntegration, machineLifecycle, targetWeight, bloomEnabled, bloomSeconds, doseGrams, brewRatio, t, cmd, waitForState])

  // ── Machine integration: handle abort / stop ──
  const handleMachineStop = useCallback(async () => {
    if (!meticulousIntegration) return

    if (machineLifecycle === 'brewing') {
      // User manually aborted — stop shot, purge, delete
      try {
        await cmd(stopShot, 'stopped')
      } catch {
        // Machine stop may fail (e.g. already stopped) — continue with cleanup
      }
      pauseTimer()
      setMachineLifecycle('purging')
      // Wait for machine to process the stop command before purging
      await new Promise(resolve => setTimeout(resolve, 1500))
      try {
        await cleanupPourOver()
        setMachineLifecycle('done')
        toast.success(t('pourOver.integration.abortCleanupSuccess'))
      } catch {
        try {
          await forceCleanupPourOver()
          setMachineLifecycle('done')
          toast.info(t('pourOver.integration.forceCleanupUsed'))
        } catch {
          setMachineLifecycle('error')
          toast.error(t('pourOver.integration.cleanupFailed'))
        }
      }
    } else if (machineLifecycle === 'drawdown') {
      // Machine shot ended naturally, timer still running for drawdown — just stop it
      pauseTimer()
      setMachineLifecycle('done')
    } else if (machineLifecycle === 'ready' || machineLifecycle === 'preparing') {
      // Haven't started brewing yet, just force-cleanup
      try {
        await forceCleanupPourOver()
      } catch {
        // Ignore — profile might not exist yet
      }
      setMachineLifecycle('idle')
    }
  }, [meticulousIntegration, machineLifecycle, t, cmd, pauseTimer])

  // ── Machine integration: handle start recipe on machine ──
  const handleMachineRecipeStart = useCallback(async () => {
    if (!meticulousIntegration || machineLifecycle !== 'idle' || !selectedRecipe) return
    setMachineLifecycle('preparing')
    try {
      await prepareRecipe(selectedRecipe.slug)
      setMachineLifecycle('ready')
      toast.success(t('pourOver.integration.profileReady'))
      await cmd(continueShot, 'started')
      try {
        await waitForState('click to start')
      } catch {
        // Timeout — machine may already be past this state; try anyway
      }
      await cmd(continueShot, 'started')
    } catch (err) {
      setMachineLifecycle('error')
      toast.error(err instanceof Error ? err.message : t('pourOver.integration.prepareFailed'))
    }
  }, [meticulousIntegration, machineLifecycle, selectedRecipe, t, cmd, waitForState])

  // ── Machine integration: reset lifecycle when toggled off or mode changes ──
  const handleIntegrationToggle = useCallback((enabled: boolean) => {
    if (!enabled && machineLifecycle !== 'idle') {
      // Force cleanup on toggle-off if there's an active profile
      forceCleanupPourOver().catch(() => {})
      setMachineLifecycle('idle')
    }
    updateMachineIntegration(enabled)
    if (enabled) {
      setMachineLifecycle('idle')
      // Disable auto-start when integration is active
      updateAutoStart(false)
    }
  }, [machineLifecycle, updateMachineIntegration, updateAutoStart])

  // Reset machine lifecycle when done (allow starting again)
  // Also tare the scale, reset the timer, and clear the graph
  const resetMachineLifecycle = useCallback(() => {
    setMachineLifecycle('idle')
    setMachineEndElapsedMs(null)
    // Reset timer
    setIsRunning(false)
    setStartedAtMs(null)
    setBaseElapsedMs(0)
    setRecipeCurrentStep(0)
    // Clear graph
    setWeightTrend([])
    trendStartTimestampRef.current = null
    previousWeightRef.current = null
    previousWeightTimestampRef.current = null
    flowStartTimestampRef.current = null
    setFlowRate(0)
    // Tare the scale
    justTaredRef.current = true
    cmd(tareScale, 'tared')
  }, [cmd])

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

    const previousWeight = previousWeightRef.current
    const previousTimestamp = previousWeightTimestampRef.current

    // Compute instantaneous flow rate (g/s)
    let currentFlowRate = 0
    if (previousWeight !== null && previousTimestamp !== null) {
      const deltaSeconds = Math.max((now - previousTimestamp) / 1000, 0.01)
      currentFlowRate = Math.max((currentWeight - previousWeight) / deltaSeconds, 0)
    }
    setFlowRate(currentFlowRate)

    // Only record weight data to the graph when timer is running
    // This prevents the graph from starting before the brew begins (e.g., scale taps)
    if (isRunning) {
      if (trendStartTimestampRef.current === null) {
        trendStartTimestampRef.current = now
      }
      const trendTimeSeconds = (now - trendStartTimestampRef.current) / 1000

      setWeightTrend(prev => {
        const next = [...prev, { t: trendTimeSeconds, w: currentWeight, flow: currentFlowRate }]
        // Keep enough points for a full 5-minute pour-over (~900 points at 3Hz)
        return next.slice(-900)
      })
    }

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
      // Valid pour-over flow: 0.3 to 25 g/s (wider range than espresso)
      // Lower bound filters out scale drift, upper bound allows aggressive pours
      const isValidFlow = gramsPerSecond >= 0.3 && gramsPerSecond <= 25

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

  // ── Load recipes when entering recipe mode ──
  useEffect(() => {
    if (mode !== 'recipe' || recipes.length > 0 || recipesLoading) return
    setRecipesLoading(true)
    getRecipes()
      .then(r => { setRecipes(r); setRecipesLoading(false) })
      .catch(() => setRecipesLoading(false))
  }, [mode, recipes.length, recipesLoading])

  // ── Recipe step auto-advance ──
  useEffect(() => {
    if (mode !== 'recipe' || recipeTimings.length === 0 || !isRunning) return
    if (recipeCurrentStep >= recipeTimings.length - 1) return
    const timing = recipeTimings[recipeCurrentStep]
    if (!timing) return

    // In integrated mode use the machine's elapsed shot timer for time-based advance
    const timeMs = meticulousIntegration
      ? (machineState.shot_timer ?? 0) * 1000
      : elapsedMs

    if (timing.action === 'pour' && recipeProgressionMode === 'weight') {
      // Pour steps: advance on weight with ±5g tolerance
      if (weight >= timing.cumulativeWeight - 5 && timing.cumulativeWeight > 0) {
        setRecipeCurrentStep(prev => Math.min(prev + 1, recipeTimings.length - 1))
      }
    } else {
      // Bloom, wait, swirl, stir (and pour in time mode): advance on elapsed time
      if (timeMs >= timing.endTimeSec * 1000) {
        setRecipeCurrentStep(prev => Math.min(prev + 1, recipeTimings.length - 1))
      }
    }
  }, [mode, recipeTimings, recipeCurrentStep, isRunning, weight, elapsedMs, recipeProgressionMode, meticulousIntegration, machineState.shot_timer])

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

        {/* ── Mode tabs at the top ── */}
        <div className="sticky top-0 -mx-6 px-6 py-3 bg-card border-b border-border/40 z-10">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest text-center mb-2">{t('pourOver.mode')}</p>
          <Tabs value={mode} onValueChange={(value) => applyModePrefs(value as 'free' | 'ratio' | 'recipe')}>
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="free">{t('pourOver.freeMode')}</TabsTrigger>
              <TabsTrigger value="ratio">{t('pourOver.ratioMode')}</TabsTrigger>
              <TabsTrigger value="recipe">{t('pourOver.recipeMode')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* ── Two-column layout for desktop ── */}
        <div className="desktop-two-col">
          {/* Left column: Controls and stats */}
          <div className="space-y-5">
            {/* ── 1. Weight + Timer + Flow rate (always visible) ── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 text-center space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
                  <Scales size={14} weight="bold" />
                  {t('pourOver.weight')}
                </div>
                <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{weight.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">{t('pourOver.unitGrams')}</div>
              </div>

              <div className="rounded-xl border border-border/60 bg-secondary/40 p-4 flex flex-col items-center justify-center gap-1 col-span-2 lg:col-span-1 order-first lg:order-none">
                <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1">
                  <Timer size={14} weight="bold" />
                  {t('pourOver.timer')}
                </div>
                <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">{formatStopwatch(elapsedMs)}</div>
                {/* Bloom indicator: shows during bloom phase or "done" right after */}
                {mode !== 'recipe' && bloomEnabled && (isRunning || baseElapsedMs > 0) && (() => {
                  const bloomDurationMs = (parsePositiveNumber(bloomSeconds) ?? 30) * 1000
                  const bloomRemaining = Math.max(0, bloomDurationMs - elapsedMs)
                  const isInBloom = bloomRemaining > 0
                  const justFinishedBloom = elapsedMs >= bloomDurationMs && elapsedMs < bloomDurationMs + 3000
                  
                  if (isInBloom) {
                    return (
                      <div className="text-xs font-medium text-amber-500 dark:text-amber-400 uppercase tracking-wider animate-pulse">
                        {t('pourOver.bloomIndicator')}: {Math.ceil(bloomRemaining / 1000)}s
                      </div>
                    )
                  } else if (justFinishedBloom) {
                    return (
                      <div className="text-xs font-medium text-green-500 dark:text-green-400 uppercase tracking-wider">
                        {t('pourOver.bloomIndicator')} {t('pourOver.bloomDone')}
                      </div>
                    )
                  }
                  return null
                })()}
                {/* Machine shot end marker in timer — shows during drawdown */}
                {machineEndElapsedMs !== null && isRunning && machineLifecycle === 'drawdown' && (
                  <div className="text-xs font-medium text-green-500 dark:text-green-400 uppercase tracking-wider">
                    {t('pourOver.integration.shotEndedAt')} {formatStopwatch(machineEndElapsedMs)}
                  </div>
                )}
                {!bloomEnabled && <div className="text-xs text-muted-foreground">{t('pourOver.unitTime')}</div>}
                {/* Recipe step indicator */}
                {mode === 'recipe' && selectedRecipe && (isRunning || baseElapsedMs > 0) && recipeTimings.length > 0 && (
                  <div className="text-xs font-medium text-blue-500 dark:text-blue-400 uppercase tracking-wider">
                    Step {recipeCurrentStep + 1}/{recipeTimings.length}: {recipeTimings[recipeCurrentStep]?.action}
                  </div>
                )}
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

            {/* ── 2b. Target + Remaining (recipe mode) ── */}
            {mode === 'recipe' && selectedRecipe && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Target size={12} weight="bold" />
                    {t('pourOver.targetWater')}
                  </p>
                  <p className="text-xl sm:text-2xl font-semibold tabular-nums">
                    {selectedRecipe.ingredients.water_g} g
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('pourOver.remaining')}</p>
                  <p className="text-xl sm:text-2xl font-semibold tabular-nums">
                    {Math.max(0, selectedRecipe.ingredients.water_g - weight).toFixed(1)} g
                  </p>
                </div>
              </div>
            )}

            {/* ── Step guidance card (recipe mode, when running) ── */}
            {mode === 'recipe' && selectedRecipe && isRunning && recipeTimings.length > 0 && recipeCurrentStep < recipeTimings.length && (() => {
              const timing = recipeTimings[recipeCurrentStep]
              const isPourStep = timing.action === 'bloom' || timing.action === 'pour'
              const prevCw = recipeCurrentStep > 0
                ? recipeTimings.slice(0, recipeCurrentStep).filter(step => step.cumulativeWeight > 0).at(-1)?.cumulativeWeight ?? 0
                : 0
              const pourProgress = isPourStep && timing.cumulativeWeight > prevCw
                ? Math.min(100, ((weight - prevCw) / (timing.cumulativeWeight - prevCw)) * 100)
                : 0
              const stepEndMs = timing.endTimeSec * 1000
              const remaining = Math.max(0, stepEndMs - elapsedMs)
              const overallProgress = recipeCurrentStep / recipeTimings.length

              return (
                <div className="p-3 rounded-xl border border-border/60 bg-secondary/40 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      Step {recipeCurrentStep + 1} of {recipeTimings.length}
                    </span>
                    {/* SVG pie showing overall recipe progress */}
                    <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
                      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
                      <circle
                        cx="10" cy="10" r="8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${(overallProgress * 50.27).toFixed(2)} 50.27`}
                        strokeDashoffset="-12.57"
                        strokeLinecap="round"
                        className="text-primary"
                      />
                    </svg>
                  </div>
                  <p className="text-base font-bold text-foreground leading-tight">{timing.label}</p>
                  {timing.notes && <p className="text-xs text-muted-foreground">{timing.notes}</p>}
                  {isPourStep && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t('pourOver.targetWater')}: {timing.cumulativeWeight}g</span>
                        <span>{weight.toFixed(1)}g</span>
                      </div>
                      <Progress value={Math.max(0, pourProgress)} className="h-1.5" />
                    </div>
                  )}
                  {!isPourStep && (
                    <p className="text-sm font-medium text-amber-500 dark:text-amber-400">
                      ⏱ {Math.ceil(remaining / 1000)}s remaining
                    </p>
                  )}
                  {recipeCurrentStep < recipeTimings.length - 1 && (
                    <p className="text-xs text-muted-foreground">Next: {recipeTimings[recipeCurrentStep + 1].label}</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => setRecipeCurrentStep(prev => Math.min(prev + 1, recipeTimings.length - 1))}
                    disabled={recipeCurrentStep >= recipeTimings.length - 1}
                  >
                    {t('pourOver.nextStep')}
                  </Button>
                </div>
              )
            })()}

            {/* ── Graph on mobile only (shows inside left column) ── */}
            <div className="lg:hidden">
              {mode === 'ratio' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('pourOver.progress')}</span>
                    <span>{ratioProgress.toFixed(0)}%</span>
                  </div>
                  <Progress value={ratioProgress} />
                  <WeightTrend points={weightTrend} targetWeight={targetWeight} mode="ratio" bloomDurationSeconds={bloomEnabled ? (parsePositiveNumber(bloomSeconds) ?? 30) : 0} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
                </div>
              )}
              {mode === 'free' && (
                <WeightTrend points={weightTrend} targetWeight={null} mode="free" bloomDurationSeconds={bloomEnabled ? (parsePositiveNumber(bloomSeconds) ?? 30) : 0} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
              )}
              {mode === 'recipe' && (
                <WeightTrend points={weightTrend} targetWeight={null} mode="recipe" recipeTimings={recipeTimings} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
              )}
            </div>

            {/* ── 4. Action buttons (always visible) ── */}
            {meticulousIntegration && (mode === 'ratio' || mode === 'recipe') ? (
              /* Machine integration action buttons */
              <div className="space-y-2.5">
                {/* Machine lifecycle status banner */}
                {machineLifecycle !== 'idle' && (
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    machineLifecycle === 'preparing' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                    machineLifecycle === 'ready' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                    machineLifecycle === 'brewing' ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
                    machineLifecycle === 'drawdown' ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' :
                    machineLifecycle === 'purging' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400' :
                    machineLifecycle === 'done' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                    'bg-red-500/10 text-red-600 dark:text-red-400'
                  }`}>
                    {machineLifecycle === 'preparing' && <CircleNotch size={16} weight="bold" className="animate-spin" />}
                    {machineLifecycle === 'ready' && <Coffee size={16} weight="fill" />}
                    {machineLifecycle === 'brewing' && <Coffee size={16} weight="fill" className="animate-pulse" />}
                    {machineLifecycle === 'drawdown' && <Drop size={16} weight="fill" />}
                    {machineLifecycle === 'purging' && <CircleNotch size={16} weight="bold" className="animate-spin" />}
                    {machineLifecycle === 'done' && <CheckCircle size={16} weight="fill" />}
                    {machineLifecycle === 'error' && <XCircle size={16} weight="fill" />}
                    <span>{t(`pourOver.integration.status.${machineLifecycle}`)}</span>
                  </div>
                )}

                {/* Start / Stop / New shot — own row for mobile readability */}
                {machineLifecycle === 'idle' ? (
                  <Button
                    onClick={mode === 'recipe' ? handleMachineRecipeStart : handleMachineStart}
                    variant="default"
                    className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={
                      !isConnected || !canStart ||
                      (mode === 'ratio' ? (targetWeight === null || targetWeight <= 0) : !selectedRecipe)
                    }
                  >
                    <Coffee size={18} weight="fill" className="mr-1.5" />
                    {t('pourOver.integration.startOnMachine')}
                  </Button>
                ) : machineLifecycle === 'done' || machineLifecycle === 'error' ? (
                  <Button
                    onClick={resetMachineLifecycle}
                    variant="default"
                    className="w-full h-11 rounded-xl"
                  >
                    <Play size={18} weight="fill" className="mr-1.5" />
                    {t('pourOver.integration.newShot')}
                  </Button>
                ) : (
                  <Button
                    onClick={handleMachineStop}
                    variant="destructive"
                    className="w-full h-11 rounded-xl"
                    disabled={machineLifecycle === 'purging'}
                  >
                    <Pause size={18} weight="fill" className="mr-1.5" />
                    {t('pourOver.integration.stop')}
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    onClick={resetTimer}
                    variant="outline"
                    className="h-11"
                  >
                    <Timer size={18} weight="bold" className="mr-1.5" />
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
              </div>
            ) : (
              /* Standard timer action buttons */
              <div className="grid grid-cols-3 gap-2.5">
                <Button
                  onClick={startOrPause}
                  variant={autoStartEnabled ? "outline" : "default"}
                  className={`h-11 rounded-xl ${!autoStartEnabled && !isRunning ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''}`}
                >
                  {isRunning ? <Pause size={18} weight="fill" className="mr-1.5" /> : <Play size={18} weight="fill" className="mr-1.5" />}
                  {isRunning ? t('pourOver.pause') : t('pourOver.start')}
                </Button>

                <Button
                  onClick={resetTimer}
                  variant="outline"
                  className="h-11"
                >
                  <Timer size={18} weight="bold" className="mr-1.5" />
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
            )}

            {/* ── 5. Dose + ratio inputs (ratio mode — set once before brewing) ── */}
            {mode === 'ratio' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Dose */}
                  <div className="space-y-1.5">
                    <Label htmlFor="pour-over-dose">{t('pourOver.doseLabel')}</Label>
                    <div className="flex items-center gap-1.5">
                      <IncrementButton
                        onIncrement={() => setDoseGrams(prev => String(Math.max(1, (parseFloat(prev) || 0) - 1)))}
                        label="−"
                      />
                      <Input
                        id="pour-over-dose"
                        inputMode="decimal"
                        value={doseGrams}
                        onChange={(event) => setDoseGrams(event.target.value)}
                        placeholder="20"
                        className="w-16 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
                      />
                      <IncrementButton
                        onIncrement={() => setDoseGrams(prev => String((parseFloat(prev) || 0) + 1))}
                        label="+"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-9 gap-1.5"
                      disabled={!machineState.connected || weight <= 0}
                      onClick={() => { setDoseGrams(weight.toFixed(1)); handleTare(); }}
                      title={t('pourOver.weighFromScaleTitle')}
                      aria-label={t('pourOver.weighFromScale')}
                    >
                      <Scales size={16} weight="bold" />
                      <span className="text-xs">{t('pourOver.weighFromScaleShort')}</span>
                    </Button>
                  </div>
                  {/* Ratio */}
                  <div className="space-y-1.5">
                    <Label htmlFor="pour-over-ratio">{t('pourOver.ratioLabel')}</Label>
                    <div className="flex items-center gap-1.5">
                      <IncrementButton
                        onIncrement={() => setBrewRatio(prev => String(Math.max(1, (parseFloat(prev) || 0) - 1)))}
                        label="−"
                      />
                      <Input
                        id="pour-over-ratio"
                        inputMode="decimal"
                        value={brewRatio}
                        onChange={(event) => setBrewRatio(event.target.value)}
                        placeholder="15"
                        className="w-16 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
                      />
                      <IncrementButton
                        onIncrement={() => setBrewRatio(prev => String((parseFloat(prev) || 0) + 1))}
                        label="+"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Recipe mode: selector or step guidance ── */}
            {mode === 'recipe' && (
              <div className="space-y-3">
                {!selectedRecipe ? (
                  /* Recipe selection list */
                  <div className="space-y-2">
                    {recipesLoading && (
                      <p className="text-sm text-muted-foreground text-center py-2">{t('common.loading')}</p>
                    )}
                    {!recipesLoading && recipes.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-2">{t('pourOver.noRecipes')}</p>
                    )}
                    {recipes.map(recipe => (
                      <button
                        key={recipe.slug}
                        onClick={() => { setSelectedRecipe(recipe); setRecipeCurrentStep(0); setRecipeShowBreakdown(false) }}
                        className="w-full text-left p-3 rounded-xl border border-border/60 bg-secondary/40 hover:bg-secondary/60 transition-colors space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-foreground leading-tight">{recipe.metadata.name}</p>
                            {recipe.metadata.author && (
                              <p className="text-xs text-muted-foreground">by {recipe.metadata.author}</p>
                            )}
                          </div>
                          <ArrowRight size={16} className="shrink-0 text-muted-foreground mt-0.5" />
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{recipe.equipment.dripper.model}</span>
                          <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{recipe.ingredients.coffee_g}g / {recipe.ingredients.water_g}g</span>
                          <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{recipe.protocol.length} steps</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  /* Recipe active: header + step guidance */
                  <div className="space-y-3">
                    {/* Recipe header */}
                    <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-border/60 bg-secondary/40">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-foreground leading-tight truncate">{selectedRecipe.metadata.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedRecipe.ingredients.coffee_g}g / {selectedRecipe.ingredients.water_g}g · {selectedRecipe.equipment.dripper.model}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs shrink-0"
                        onClick={() => { setSelectedRecipe(null); setRecipeCurrentStep(0); setRecipeShowBreakdown(false) }}
                      >
                        {t('pourOver.changeRecipe')}
                      </Button>
                    </div>

                    {/* Recipe breakdown toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={() => setRecipeShowBreakdown(v => !v)}
                    >
                      <BookOpen size={14} className="mr-1.5" />
                      {recipeShowBreakdown ? t('pourOver.hideRecipeDetails') : t('pourOver.viewRecipeDetails')}
                    </Button>
                    {recipeShowBreakdown && <RecipeBreakdown recipe={selectedRecipe} compact />}
                  </div>
                )}
              </div>
            )}

            {/* ── Settings (auto-start, bloom, integration) ── */}
            <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-3">
              {/* Machine integration toggle — only in ratio or recipe mode */}
              {(mode === 'ratio' || mode === 'recipe') && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t('pourOver.integration.toggle')}</p>
                    <p className="text-xs text-muted-foreground">{t('pourOver.integration.toggleDescription')}</p>
                  </div>
                  <Switch
                    checked={meticulousIntegration}
                    onCheckedChange={handleIntegrationToggle}
                    disabled={!isConnected}
                    className="shrink-0"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t('pourOver.autoStartTimer')}</p>
                  <p className="text-xs text-muted-foreground">{t('pourOver.autoStartDescription')}</p>
                </div>
                <Switch
                  checked={autoStartEnabled}
                  onCheckedChange={updateAutoStart}
                  disabled={meticulousIntegration}
                  className="shrink-0"
                />
              </div>

              {/* Progression mode toggle — recipe mode only, standalone */}
              {mode === 'recipe' && !meticulousIntegration && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t('pourOver.followWeight')}</p>
                    <p className="text-xs text-muted-foreground">{t('pourOver.followWeightDescription')}</p>
                  </div>
                  <Switch
                    checked={recipeProgressionMode === 'weight'}
                    onCheckedChange={(v) => {
                      const next: 'weight' | 'time' = v ? 'weight' : 'time'
                      setRecipeProgressionMode(next)
                      if (prefsRef.current) {
                        prefsRef.current.recipe.progressionMode = next
                        persistPrefs()
                      }
                    }}
                    className="shrink-0"
                  />
                </div>
              )}

              {mode !== 'recipe' && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t('pourOver.bloomIndicator')}</p>
                  <p className="text-xs text-muted-foreground">{t('pourOver.bloomDescription')}</p>
                </div>
                <Switch checked={bloomEnabled} onCheckedChange={updateBloomEnabled} className="shrink-0" />
              </div>
              )}

              {mode !== 'recipe' && bloomEnabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="pour-over-bloom">{t('pourOver.bloomDuration')}</Label>
                  <div className="flex items-center gap-1.5">
                    <IncrementButton
                      onIncrement={() => updateBloomSeconds(String(Math.max(0, (parseInt(bloomSeconds) || 0) - 5)))}
                      label="−"
                    />
                    <Input
                      id="pour-over-bloom"
                      inputMode="numeric"
                      value={bloomSeconds}
                      onChange={(event) => updateBloomSeconds(event.target.value)}
                      placeholder="30"
                      className="w-16 text-center bg-slate-300 dark:bg-[rgba(0,0,0,0.3)]"
                    />
                    <IncrementButton
                      onIncrement={() => updateBloomSeconds(String((parseInt(bloomSeconds) || 0) + 5))}
                      label="+"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>{/* End left column */}

          {/* Right column: Graph (desktop only) */}
          <div className="hidden lg:block space-y-4">
            {mode === 'ratio' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('pourOver.progress')}</span>
                  <span>{ratioProgress.toFixed(0)}%</span>
                </div>
                <Progress value={ratioProgress} />
                <WeightTrend points={weightTrend} targetWeight={targetWeight} mode="ratio" bloomDurationSeconds={bloomEnabled ? (parsePositiveNumber(bloomSeconds) ?? 30) : 0} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
              </div>
            )}
            {mode === 'free' && (
              <WeightTrend points={weightTrend} targetWeight={null} mode="free" bloomDurationSeconds={bloomEnabled ? (parsePositiveNumber(bloomSeconds) ?? 30) : 0} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
            )}
            {mode === 'recipe' && (
              <WeightTrend points={weightTrend} targetWeight={null} mode="recipe" recipeTimings={recipeTimings} machineEndTimeSeconds={machineEndElapsedMs !== null ? machineEndElapsedMs / 1000 : undefined} />
            )}
          </div>{/* End right column */}
        </div>{/* End two-column layout */}

        {!machineState.connected && (
          <p className="text-xs text-center text-muted-foreground">
            {t('pourOver.offlineNotice')}
          </p>
        )}

      </Card>
    </motion.div>
  )
}
