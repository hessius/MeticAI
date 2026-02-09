import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CaretLeft,
  Warning,
  ChartLine,
  Clock,
  Drop,
  Gauge,
  Waves,
  ArrowUp,
  ArrowDown,
  Equals,
  Play,
  Pause,
  ArrowCounterClockwise,
  Timer,
  X,
  CheckCircle
} from '@phosphor-icons/react'
import { ShotInfo, ShotData } from '@/hooks/useShotHistory'
import { format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'

// Chart colors for comparison - Shot A (primary) vs Shot B (secondary)
const COMPARISON_COLORS = {
  shotA: {
    pressure: '#4ade80',      // Green
    flow: '#67e8f9',          // Cyan
    weight: '#fbbf24',        // Amber
  },
  shotB: {
    pressure: '#22c55e80',    // Green (dimmer, dashed)
    flow: '#67e8f980',        // Cyan (dimmer, dashed)  
    weight: '#fbbf2480',      // Amber (dimmer, dashed)
  }
}

// Playback speed options
const SPEED_OPTIONS: number[] = [0.5, 1, 2, 3, 5]

interface ShotComparisonViewProps {
  profileName: string
  primaryShot: ShotInfo
  primaryShotData: ShotData
  availableShots: ShotInfo[]
  onBack: () => void
  fetchShotData: (date: string, filename: string) => Promise<ShotData>
}

interface ChartDataPoint {
  time: number
  // Shot A (primary)
  pressureA?: number
  flowA?: number
  weightA?: number
  // Shot B (comparison)
  pressureB?: number
  flowB?: number
  weightB?: number
}

interface ComparisonStats {
  duration: { a: number; b: number; diff: number; diffPercent: number }
  yield: { a: number; b: number; diff: number; diffPercent: number }
  maxPressure: { a: number; b: number; diff: number; diffPercent: number }
  maxFlow: { a: number; b: number; diff: number; diffPercent: number }
}

// Custom tooltip for comparison chart
function ComparisonTooltip({ 
  active, 
  payload, 
  label 
}: { 
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>
  label?: number 
}) {
  if (!active || !payload || !payload.length) return null
  
  return (
    <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg min-w-[180px]">
      <p className="text-xs font-medium text-muted-foreground mb-2 border-b border-border/50 pb-1.5">
        Time: {typeof label === 'number' ? label.toFixed(1) : '0'}s
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <p className="text-[10px] font-semibold text-primary col-span-1">Shot A</p>
        <p className="text-[10px] font-semibold text-muted-foreground col-span-1">Shot B</p>
        {/* Group by metric type */}
        {payload.filter(p => p.dataKey?.endsWith('A')).map((itemA, index) => {
          const metric = itemA.dataKey?.replace('A', '')
          const itemB = payload.find(p => p.dataKey === `${metric}B`)
          return (
            <React.Fragment key={index}>
              <div className="flex items-center gap-1.5 text-xs">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: itemA.color || '#888' }}
                />
                <span className="font-medium">{typeof itemA.value === 'number' ? itemA.value.toFixed(2) : '-'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div 
                  className="w-2 h-2 rounded-full border" 
                  style={{ borderColor: itemB?.color || '#888' }}
                />
                <span>{typeof itemB?.value === 'number' ? itemB.value.toFixed(2) : '-'}</span>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

// Stat comparison card
function StatComparisonCard({ 
  label, 
  icon: Icon, 
  valueA, 
  valueB, 
  unit,
  diff,
  diffPercent,
  higherIsBetter = true
}: { 
  label: string
  icon: React.ElementType
  valueA: number
  valueB: number
  unit: string
  diff: number
  diffPercent: number
  higherIsBetter?: boolean
}) {
  const isPositive = diff > 0
  const isBetter = higherIsBetter ? isPositive : !isPositive
  const isEqual = Math.abs(diffPercent) < 1 // Less than 1% difference
  
  return (
    <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon size={14} weight="bold" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      
      <div className="flex items-end justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">{valueA.toFixed(1)}</span>
            <span className="text-xs text-muted-foreground">vs</span>
            <span className="text-sm font-medium text-muted-foreground">{valueB.toFixed(1)}</span>
          </div>
          <span className="text-[10px] text-muted-foreground/70">{unit}</span>
        </div>
        
        <Badge 
          variant={isEqual ? "secondary" : isBetter ? "default" : "destructive"}
          className="shrink-0 text-[10px] px-1.5 py-0.5"
        >
          {isEqual ? (
            <Equals size={10} weight="bold" className="mr-0.5" />
          ) : isPositive ? (
            <ArrowUp size={10} weight="bold" className="mr-0.5" />
          ) : (
            <ArrowDown size={10} weight="bold" className="mr-0.5" />
          )}
          {Math.abs(diffPercent).toFixed(0)}%
        </Badge>
      </div>
    </div>
  )
}

export function ShotComparisonView({
  profileName,
  primaryShot,
  primaryShotData,
  availableShots,
  onBack,
  fetchShotData
}: ShotComparisonViewProps) {
  // Comparison shot selection
  const [comparisonShot, setComparisonShot] = useState<ShotInfo | null>(null)
  const [comparisonShotData, setComparisonShotData] = useState<ShotData | null>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  
  // Replay state
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [maxTime, setMaxTime] = useState(0)
  const animationRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  // Filter out the primary shot from available shots
  const selectableShots = useMemo(() => 
    availableShots.filter(s => 
      !(s.date === primaryShot.date && s.filename === primaryShot.filename)
    ),
    [availableShots, primaryShot]
  )

  // Transform shot data to chart format (handles multiple data formats)
  const getChartDataFromShot = useCallback((data: ShotData): { time: number; pressure: number; flow: number; weight: number }[] => {
    // Meticulous shot data structure: array of entries with nested 'shot' object
    const dataEntries = data.data as unknown
    
    // Format 1: Array of entries with nested shot object
    if (Array.isArray(dataEntries) && dataEntries.length > 0 && dataEntries[0]?.shot) {
      return dataEntries.map((entry: { shot?: { pressure?: number; flow?: number; weight?: number }; time?: number; profile_time?: number }) => ({
        time: (entry.time || entry.profile_time || 0) / 1000,
        pressure: entry.shot?.pressure || 0,
        flow: entry.shot?.flow || 0,
        weight: entry.shot?.weight || 0
      }))
    }
    
    // Format 2: Object with parallel arrays
    const telemetry = (data.data || data) as Record<string, unknown>
    const timeArray = telemetry.time as number[] | undefined
    const pressureArray = telemetry.pressure as number[] | undefined
    const flowArray = telemetry.flow as number[] | undefined
    const weightArray = telemetry.weight as number[] | undefined
    
    if (Array.isArray(timeArray) && timeArray.length > 0) {
      return timeArray.map((t, i) => ({
        time: t,
        pressure: pressureArray?.[i] || 0,
        flow: flowArray?.[i] || 0,
        weight: weightArray?.[i] || 0
      }))
    }
    
    // Format 3: Log entries array
    const logEntries = (data as Record<string, unknown>).log as Array<Record<string, number>> | undefined
    if (Array.isArray(logEntries) && logEntries.length > 0) {
      return logEntries.map(entry => ({
        time: entry.time || entry.t || 0,
        pressure: entry.pressure || entry.p || 0,
        flow: entry.flow || entry.f || 0,
        weight: entry.weight || entry.w || 0
      }))
    }
    
    return []
  }, [])

  // Extract max values from shot data
  const getMaxValues = useCallback((data: ShotData): { maxPressure: number; maxFlow: number } => {
    const chartData = getChartDataFromShot(data)
    return {
      maxPressure: Math.max(...chartData.map(d => d.pressure || 0)),
      maxFlow: Math.max(...chartData.map(d => d.flow || 0))
    }
  }, [getChartDataFromShot])

  // Build combined chart data
  const combinedChartData = useMemo((): ChartDataPoint[] => {
    const dataA = getChartDataFromShot(primaryShotData)
    
    console.log('[Comparison] Primary shot data points:', dataA.length)
    
    if (!comparisonShotData) {
      // Just show primary shot
      return dataA.map(d => ({
        time: d.time,
        pressureA: d.pressure,
        flowA: d.flow,
        weightA: d.weight
      }))
    }
    
    const dataB = getChartDataFromShot(comparisonShotData)
    
    console.log('[Comparison] Comparison shot data points:', dataB.length)
    
    // If either dataset is empty, just return what we have
    if (dataA.length === 0) {
      return dataB.map(d => ({
        time: d.time,
        pressureB: d.pressure,
        flowB: d.flow,
        weightB: d.weight
      }))
    }
    
    if (dataB.length === 0) {
      return dataA.map(d => ({
        time: d.time,
        pressureA: d.pressure,
        flowA: d.flow,
        weightA: d.weight
      }))
    }
    
    // Use the longer dataset as the base and sample the other one
    // This is simpler than merging all unique timestamps
    const useAAsBase = dataA.length >= dataB.length
    const baseData = useAAsBase ? dataA : dataB
    const otherData = useAAsBase ? dataB : dataA
    
    // Create a function to find the closest point by time
    const findClosestPoint = (time: number, data: typeof dataA): { pressure: number; flow: number; weight: number } | null => {
      if (data.length === 0) return null
      
      // Binary search for closest time
      let left = 0
      let right = data.length - 1
      
      while (left < right) {
        const mid = Math.floor((left + right) / 2)
        if (data[mid].time < time) {
          left = mid + 1
        } else {
          right = mid
        }
      }
      
      // Check if time is out of range
      if (time < data[0].time || time > data[data.length - 1].time) {
        return null
      }
      
      // Find the two closest points and interpolate
      const idx = left
      if (idx === 0 || data[idx].time === time) {
        return data[idx]
      }
      
      const before = data[idx - 1]
      const after = data[idx]
      const t = (time - before.time) / (after.time - before.time)
      
      return {
        pressure: before.pressure + t * (after.pressure - before.pressure),
        flow: before.flow + t * (after.flow - before.flow),
        weight: before.weight + t * (after.weight - before.weight)
      }
    }
    
    // Map base data with interpolated other data
    return baseData.map(basePoint => {
      const otherPoint = findClosestPoint(basePoint.time, otherData)
      
      if (useAAsBase) {
        return {
          time: basePoint.time,
          pressureA: basePoint.pressure,
          flowA: basePoint.flow,
          weightA: basePoint.weight,
          pressureB: otherPoint?.pressure,
          flowB: otherPoint?.flow,
          weightB: otherPoint?.weight
        }
      } else {
        return {
          time: basePoint.time,
          pressureA: otherPoint?.pressure,
          flowA: otherPoint?.flow,
          weightA: otherPoint?.weight,
          pressureB: basePoint.pressure,
          flowB: basePoint.flow,
          weightB: basePoint.weight
        }
      }
    })
  }, [primaryShotData, comparisonShotData, getChartDataFromShot])

  // Calculate comparison stats
  const comparisonStats = useMemo((): ComparisonStats | null => {
    if (!comparisonShot || !comparisonShotData) return null
    
    const durationA = primaryShot.total_time || 0
    const durationB = comparisonShot.total_time || 0
    
    const yieldA = primaryShot.final_weight || 0
    const yieldB = comparisonShot.final_weight || 0
    
    const maxA = getMaxValues(primaryShotData)
    const maxB = getMaxValues(comparisonShotData)
    
    const calcDiff = (a: number, b: number) => ({
      a, b,
      diff: a - b,
      diffPercent: b !== 0 ? ((a - b) / b) * 100 : 0
    })
    
    return {
      duration: calcDiff(durationA, durationB),
      yield: calcDiff(yieldA, yieldB),
      maxPressure: calcDiff(maxA.maxPressure, maxB.maxPressure),
      maxFlow: calcDiff(maxA.maxFlow, maxB.maxFlow)
    }
  }, [primaryShot, comparisonShot, primaryShotData, comparisonShotData, getMaxValues])

  // Calculate max time for chart domain
  useEffect(() => {
    const dataA = getChartDataFromShot(primaryShotData)
    const maxA = dataA.length > 0 ? dataA[dataA.length - 1].time : 0
    
    let maxB = 0
    if (comparisonShotData) {
      const dataB = getChartDataFromShot(comparisonShotData)
      maxB = dataB.length > 0 ? dataB[dataB.length - 1].time : 0
    }
    
    setMaxTime(Math.max(maxA, maxB))
  }, [primaryShotData, comparisonShotData, getChartDataFromShot])

  // Load comparison shot data when selected
  const handleSelectComparisonShot = async (shotKey: string) => {
    const [date, filename] = shotKey.split('|')
    const shot = selectableShots.find(s => s.date === date && s.filename === filename)
    
    if (!shot) return
    
    setComparisonShot(shot)
    setLoadingComparison(true)
    setComparisonError(null)
    
    try {
      const data = await fetchShotData(shot.date, shot.filename)
      setComparisonShotData(data)
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : 'Failed to load shot data')
      setComparisonShot(null)
    } finally {
      setLoadingComparison(false)
    }
  }

  // Clear comparison shot
  const handleClearComparison = () => {
    setComparisonShot(null)
    setComparisonShotData(null)
    setComparisonError(null)
  }

  // Reset replay when shots change
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [comparisonShot])

  // Animation loop for replay
  useEffect(() => {
    if (!isPlaying || maxTime === 0) return

    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp
      }

      const deltaMs = timestamp - lastFrameTimeRef.current
      lastFrameTimeRef.current = timestamp

      const deltaSeconds = (deltaMs / 1000) * playbackSpeed

      setCurrentTime(prev => {
        const next = prev + deltaSeconds
        if (next >= maxTime) {
          setIsPlaying(false)
          return maxTime
        }
        return next
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      lastFrameTimeRef.current = 0
    }
  }, [isPlaying, playbackSpeed, maxTime])

  // Replay controls
  const handlePlayPause = useCallback(() => {
    if (currentTime >= maxTime) {
      setCurrentTime(0)
    }
    setIsPlaying(prev => !prev)
  }, [currentTime, maxTime])

  const handleRestart = useCallback(() => {
    setCurrentTime(0)
    setIsPlaying(false)
  }, [])

  // Format shot time for display
  const formatShotTime = (shot: ShotInfo) => {
    try {
      if (shot.timestamp) {
        const ts = typeof shot.timestamp === 'string' ? parseFloat(shot.timestamp) : shot.timestamp
        if (!isNaN(ts) && ts > 0) {
          return format(new Date(ts * 1000), 'MMM d, HH:mm')
        }
      }
      if (shot.filename) {
        const timeMatch = shot.filename.match(/^(\d{2}):(\d{2}):(\d{2})/)
        if (timeMatch) {
          return `${shot.date || ''} ${timeMatch[0]}`
        }
      }
      return shot.date || 'Unknown'
    } catch {
      return shot.date || 'Unknown'
    }
  }

  // Calculate fixed axis domains
  const chartDomains = useMemo(() => {
    const allData = combinedChartData
    console.log('[Comparison] Combined chart data points:', allData.length)
    if (allData.length > 0) {
      console.log('[Comparison] Sample point:', allData[Math.floor(allData.length / 2)])
    }
    const maxPressure = Math.max(
      ...allData.map(d => Math.max(d.pressureA || 0, d.pressureB || 0)),
      12
    )
    const maxFlow = Math.max(
      ...allData.map(d => Math.max(d.flowA || 0, d.flowB || 0)),
      8
    )
    const maxWeight = Math.max(
      ...allData.map(d => Math.max(d.weightA || 0, d.weightB || 0)),
      50
    )
    
    console.log('[Comparison] Chart domains - left:', Math.ceil(Math.max(maxPressure, maxFlow) * 1.1), 'right:', Math.ceil(maxWeight * 1.1))
    
    return {
      left: Math.ceil(Math.max(maxPressure, maxFlow) * 1.1),
      right: Math.ceil(maxWeight * 1.1)
    }
  }, [combinedChartData])

  // Filter data for replay
  const displayData = useMemo(() => {
    const isReplaying = (isPlaying || currentTime > 0) && currentTime < maxTime
    return isReplaying
      ? combinedChartData.filter(d => d.time <= currentTime)
      : combinedChartData
  }, [combinedChartData, isPlaying, currentTime, maxTime])

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground truncate">
              Shot Comparison
            </h2>
            <p className="text-xs text-muted-foreground/70">
              {profileName}
            </p>
          </div>
        </div>

        {/* Shot Selection */}
        <div className="grid grid-cols-2 gap-3">
          {/* Primary Shot (fixed) */}
          <div className="p-3 bg-primary/10 rounded-xl border border-primary/30">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="default" className="text-[10px] px-1.5 py-0">Shot A</Badge>
              <span className="text-[10px] text-primary font-medium">Primary</span>
            </div>
            <p className="text-sm font-semibold truncate">{formatShotTime(primaryShot)}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              {typeof primaryShot.total_time === 'number' && (
                <span className="flex items-center gap-1">
                  <Clock size={10} weight="bold" />
                  {primaryShot.total_time.toFixed(1)}s
                </span>
              )}
              {typeof primaryShot.final_weight === 'number' && (
                <span className="flex items-center gap-1">
                  <Drop size={10} weight="fill" />
                  {primaryShot.final_weight.toFixed(1)}g
                </span>
              )}
            </div>
          </div>

          {/* Comparison Shot (selectable) */}
          <div className={`p-3 rounded-xl border transition-colors ${
            comparisonShot 
              ? 'bg-secondary/60 border-border/40' 
              : 'bg-secondary/20 border-dashed border-border/30'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Shot B</Badge>
              <span className="text-[10px] text-muted-foreground font-medium">Compare</span>
              {comparisonShot && (
                <button 
                  onClick={handleClearComparison}
                  className="ml-auto p-0.5 hover:bg-destructive/20 rounded-full transition-colors"
                >
                  <X size={12} weight="bold" className="text-muted-foreground" />
                </button>
              )}
            </div>
            
            {loadingComparison ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs text-muted-foreground">Loading...</span>
              </div>
            ) : comparisonShot ? (
              <>
                <p className="text-sm font-semibold truncate">{formatShotTime(comparisonShot)}</p>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                  {typeof comparisonShot.total_time === 'number' && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} weight="bold" />
                      {comparisonShot.total_time.toFixed(1)}s
                    </span>
                  )}
                  {typeof comparisonShot.final_weight === 'number' && (
                    <span className="flex items-center gap-1">
                      <Drop size={10} weight="fill" />
                      {comparisonShot.final_weight.toFixed(1)}g
                    </span>
                  )}
                </div>
              </>
            ) : (
              <Select onValueChange={handleSelectComparisonShot}>
                <SelectTrigger className="h-8 text-xs bg-background/50">
                  <SelectValue placeholder="Select a shot..." />
                </SelectTrigger>
                <SelectContent>
                  {selectableShots.length === 0 ? (
                    <div className="py-3 text-center text-xs text-muted-foreground">
                      No other shots available
                    </div>
                  ) : (
                    selectableShots.map((shot) => (
                      <SelectItem 
                        key={`${shot.date}|${shot.filename}`} 
                        value={`${shot.date}|${shot.filename}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{formatShotTime(shot)}</span>
                          {typeof shot.final_weight === 'number' && (
                            <span className="text-muted-foreground text-[10px]">
                              {shot.final_weight.toFixed(1)}g
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {comparisonError && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
            <Warning size={18} weight="fill" />
            <AlertDescription className="text-sm">{comparisonError}</AlertDescription>
          </Alert>
        )}

        {/* Comparison Stats */}
        <AnimatePresence mode="wait">
          {comparisonStats && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="grid grid-cols-2 gap-2">
                <StatComparisonCard
                  label="Duration"
                  icon={Clock}
                  valueA={comparisonStats.duration.a}
                  valueB={comparisonStats.duration.b}
                  unit="seconds"
                  diff={comparisonStats.duration.diff}
                  diffPercent={comparisonStats.duration.diffPercent}
                  higherIsBetter={false}
                />
                <StatComparisonCard
                  label="Yield"
                  icon={Drop}
                  valueA={comparisonStats.yield.a}
                  valueB={comparisonStats.yield.b}
                  unit="grams"
                  diff={comparisonStats.yield.diff}
                  diffPercent={comparisonStats.yield.diffPercent}
                  higherIsBetter={true}
                />
                <StatComparisonCard
                  label="Max Pressure"
                  icon={Gauge}
                  valueA={comparisonStats.maxPressure.a}
                  valueB={comparisonStats.maxPressure.b}
                  unit="bar"
                  diff={comparisonStats.maxPressure.diff}
                  diffPercent={comparisonStats.maxPressure.diffPercent}
                  higherIsBetter={false}
                />
                <StatComparisonCard
                  label="Max Flow"
                  icon={Waves}
                  valueA={comparisonStats.maxFlow.a}
                  valueB={comparisonStats.maxFlow.b}
                  unit="ml/s"
                  diff={comparisonStats.maxFlow.diff}
                  diffPercent={comparisonStats.maxFlow.diffPercent}
                  higherIsBetter={false}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Comparison Chart */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold tracking-wide text-primary flex items-center gap-2">
              <ChartLine size={16} weight="bold" />
              Extraction Comparison
            </Label>
            {isPlaying && (
              <Badge variant="secondary" className="animate-pulse">
                <Play size={10} weight="fill" className="mr-1" />
                Replaying {playbackSpeed}x
              </Badge>
            )}
          </div>
          
          <div className="p-1 bg-secondary/40 rounded-xl border border-border/20">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={displayData} margin={{ top: 5, right: 0, left: -5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
                  
                  {/* Playhead during replay */}
                  {(isPlaying || currentTime > 0) && currentTime < maxTime && (
                    <ReferenceLine
                      yAxisId="left"
                      x={currentTime}
                      stroke="#fff"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                    />
                  )}
                  
                  <XAxis 
                    dataKey="time" 
                    stroke="#666" 
                    fontSize={10}
                    tickFormatter={(value) => `${Math.round(value)}s`}
                    axisLine={{ stroke: '#444' }}
                    tickLine={{ stroke: '#444' }}
                    domain={[0, maxTime]}
                    type="number"
                    allowDataOverflow={false}
                  />
                  <YAxis 
                    yAxisId="left" 
                    stroke="#666" 
                    fontSize={10}
                    domain={[0, chartDomains.left]}
                    axisLine={{ stroke: '#444' }}
                    tickLine={{ stroke: '#444' }}
                    width={35}
                    allowDataOverflow={false}
                  />
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    stroke="#666" 
                    fontSize={10}
                    domain={[0, chartDomains.right]}
                    axisLine={{ stroke: '#444' }}
                    tickLine={{ stroke: '#444' }}
                    width={35}
                    allowDataOverflow={false}
                  />
                  <Tooltip content={<ComparisonTooltip />} />
                  <Legend 
                    wrapperStyle={{ fontSize: '9px', paddingTop: '8px' }}
                    iconType="circle"
                    iconSize={6}
                  />
                  
                  {/* Shot A (Primary) - Solid lines */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="pressureA"
                    stroke={COMPARISON_COLORS.shotA.pressure}
                    strokeWidth={2}
                    dot={false}
                    name="Pressure A (bar)"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="flowA"
                    stroke={COMPARISON_COLORS.shotA.flow}
                    strokeWidth={2}
                    dot={false}
                    name="Flow A (ml/s)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="weightA"
                    stroke={COMPARISON_COLORS.shotA.weight}
                    strokeWidth={2}
                    dot={false}
                    name="Weight A (g)"
                  />
                  
                  {/* Shot B (Comparison) - Dashed lines, always rendered but only visible when data exists */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="pressureB"
                    stroke={COMPARISON_COLORS.shotA.pressure}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    name="Pressure B (bar)"
                    opacity={0.6}
                    hide={!comparisonShotData}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="flowB"
                    stroke={COMPARISON_COLORS.shotA.flow}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    name="Flow B (ml/s)"
                    opacity={0.6}
                    hide={!comparisonShotData}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="weightB"
                    stroke={COMPARISON_COLORS.shotA.weight}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    name="Weight B (g)"
                    opacity={0.6}
                    hide={!comparisonShotData}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          {/* Chart Legend */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-current rounded" />
              <span>Shot A (solid)</span>
            </div>
            {comparisonShotData && (
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-current rounded border-dashed border-b" style={{ borderStyle: 'dashed' }} />
                <span>Shot B (dashed)</span>
              </div>
            )}
          </div>
        </div>

        {/* Replay Controls */}
        <div className="space-y-4 pt-2 border-t border-border/20">
          <Label className="text-sm font-semibold tracking-wide text-primary flex items-center gap-2">
            <Play size={16} weight="bold" />
            Replay Controls
          </Label>
          
          {/* Progress Bar */}
          {maxTime > 0 && (
            <div className="space-y-2">
              <div 
                className="h-2 bg-secondary/60 rounded-full overflow-hidden cursor-pointer relative group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const x = e.clientX - rect.left
                  const percent = x / rect.width
                  setCurrentTime(percent * maxTime)
                }}
              >
                <motion.div 
                  className="h-full bg-primary rounded-full"
                  initial={false}
                  animate={{ width: `${(currentTime / maxTime) * 100}%` }}
                  transition={{ duration: 0.05 }}
                />
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>{currentTime.toFixed(1)}s</span>
                <span>{maxTime.toFixed(1)}s</span>
              </div>
            </div>
          )}

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={handleRestart}
              className="h-10 w-10 rounded-full"
              title="Restart"
            >
              <ArrowCounterClockwise size={18} weight="bold" />
            </Button>
            
            <Button
              variant={isPlaying ? "secondary" : "default"}
              size="icon"
              onClick={handlePlayPause}
              className="h-14 w-14 rounded-full shadow-lg"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause size={28} weight="fill" />
              ) : (
                <Play size={28} weight="fill" className="ml-1" />
              )}
            </Button>
            
            <Select 
              value={playbackSpeed.toString()} 
              onValueChange={(v) => setPlaybackSpeed(parseFloat(v))}
            >
              <SelectTrigger className="w-24 h-10 rounded-full font-medium">
                <Timer size={14} weight="bold" className="mr-1 shrink-0" />
                <span className="font-mono">{playbackSpeed}x</span>
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((speed) => (
                  <SelectItem key={speed} value={speed.toString()}>
                    <span className="flex items-center gap-1.5">
                      <Timer size={12} weight="bold" />
                      {speed}x
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Empty state when no comparison selected */}
        {!comparisonShot && !loadingComparison && (
          <div className="text-center py-4 text-xs text-muted-foreground/60">
            <CheckCircle size={24} className="mx-auto mb-2 opacity-40" weight="duotone" />
            <p>Select a shot to compare from the dropdown above</p>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
