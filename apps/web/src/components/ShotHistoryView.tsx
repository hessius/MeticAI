import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  CaretLeft,
  Warning,
  ChartLine,
  Clock,
  Drop,
  Thermometer,
  Gauge,
  ArrowsCounterClockwise,
  Play,
  Pause,
  ArrowCounterClockwise,
  GitDiff,
  MagnifyingGlass,
  Timer,
  Waves,
  ArrowUp,
  ArrowDown,
  Equals,
  X,
  DownloadSimple,
  Info,
  Brain
} from '@phosphor-icons/react'
import { domToPng } from 'modern-screenshot'
import { useShotHistory, ShotInfo, ShotData } from '@/hooks/useShotHistory'
import { ExpertAnalysisView } from '@/components/ExpertAnalysisView'
import { getServerUrl } from '@/lib/config'
import { formatDistanceToNow, format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Customized
} from 'recharts'

// Chart colors matching Meticulous app style (muted to fit dark theme)
const CHART_COLORS = {
  pressure: '#4ade80',      // Green (muted)
  flow: '#67e8f9',          // Light cyan/blue (muted)
  weight: '#fbbf24',        // Amber/Yellow (muted)
  gravimetricFlow: '#c2855a', // Brown-orange (muted to fit dark theme)
  // Profile target curves (lighter/dashed versions of main colors)
  targetPressure: '#86efac',  // Lighter green for target pressure
  targetFlow: '#a5f3fc'       // Lighter cyan for target flow
}

// Stage colors for background areas (matching tag colors)
const STAGE_COLORS = [
  'rgba(239, 68, 68, 0.25)',   // Red
  'rgba(249, 115, 22, 0.25)',  // Orange  
  'rgba(234, 179, 8, 0.25)',   // Yellow
  'rgba(34, 197, 94, 0.25)',   // Green
  'rgba(59, 130, 246, 0.25)',  // Blue
  'rgba(168, 85, 247, 0.25)',  // Purple
  'rgba(236, 72, 153, 0.25)',  // Pink
  'rgba(20, 184, 166, 0.25)',  // Teal
]

const STAGE_BORDER_COLORS = [
  'rgba(239, 68, 68, 0.5)',
  'rgba(249, 115, 22, 0.5)',
  'rgba(234, 179, 8, 0.5)',
  'rgba(34, 197, 94, 0.5)',
  'rgba(59, 130, 246, 0.5)',
  'rgba(168, 85, 247, 0.5)',
  'rgba(236, 72, 153, 0.5)',
  'rgba(20, 184, 166, 0.5)',
]

// Darker text colors for stage pills — legible on both light and dark backgrounds
const STAGE_TEXT_COLORS_LIGHT = [
  'rgb(153, 27, 27)',    // Red-800
  'rgb(154, 52, 18)',    // Orange-800
  'rgb(133, 77, 14)',    // Yellow-800
  'rgb(22, 101, 52)',    // Green-800
  'rgb(30, 64, 175)',    // Blue-800
  'rgb(107, 33, 168)',   // Purple-800
  'rgb(157, 23, 77)',    // Pink-800
  'rgb(17, 94, 89)',     // Teal-800
]
const STAGE_TEXT_COLORS_DARK = [
  'rgb(252, 165, 165)',  // Red-300
  'rgb(253, 186, 116)',  // Orange-300
  'rgb(253, 224, 71)',   // Yellow-300
  'rgb(134, 239, 172)',  // Green-300
  'rgb(147, 197, 253)',  // Blue-300
  'rgb(216, 180, 254)',  // Purple-300
  'rgb(249, 168, 212)',  // Pink-300
  'rgb(94, 234, 212)',   // Teal-300
]

// Playback speed options - defined outside component to avoid re-creation
const SPEED_OPTIONS: number[] = [0.5, 1, 2, 3, 5]

// Comparison chart colors
const COMPARISON_COLORS = {
  pressure: '#4ade80',
  flow: '#67e8f9',
  weight: '#fbbf24'
}

interface ShotHistoryViewProps {
  profileName: string
  onBack: () => void
}

// Analysis result types (local analysis)
interface ExitTrigger {
  type: string
  value: number
  comparison: string
  description: string
}

interface ExitTriggerResult {
  triggered: {
    type: string
    target: number
    actual: number
    description: string
  } | null
  not_triggered: {
    type: string
    target: number
    actual: number
    description: string
  }[]
}

interface LimitHit {
  type: string
  limit_value: number
  actual_value: number
  description: string
}

interface StageExecutionData {
  duration: number
  weight_gain: number
  start_weight: number
  end_weight: number
  start_pressure: number
  end_pressure: number
  avg_pressure: number
  max_pressure: number
  min_pressure: number
  start_flow: number
  end_flow: number
  avg_flow: number
  max_flow: number
  description?: string
}

interface StageAssessment {
  status: 'reached_goal' | 'hit_limit' | 'not_reached' | 'failed' | 'incomplete' | 'executed'
  message: string
}

interface StageAnalysisLocal {
  stage_name: string
  stage_key: string
  stage_type: string
  profile_target: string  // Human-readable description of what the stage should do
  exit_triggers: ExitTrigger[]
  limits: { type: string; value: number; description: string }[]
  executed: boolean
  execution_data: StageExecutionData | null
  exit_trigger_result: ExitTriggerResult | null
  limit_hit: LimitHit | null
  assessment: StageAssessment | null
}

interface WeightAnalysisLocal {
  status: 'on_target' | 'under' | 'over'
  target: number | null
  actual: number
  deviation_percent: number
}

interface PreinfusionIssue {
  type: string
  severity: 'warning' | 'concern'
  message: string
  detail: string
}

interface PreinfusionSummary {
  stages: string[]
  total_time: number
  proportion_of_shot: number
  weight_accumulated: number
  weight_percent_of_total: number
  issues: PreinfusionIssue[]
  recommendations: string[]
}

interface ShotSummary {
  final_weight: number
  target_weight: number | null
  total_time: number
  max_pressure: number
  max_flow: number
}

interface ProfileInfo {
  name: string
  temperature: number | null
  stage_count: number
}

interface ProfileTargetPoint {
  time: number
  target_pressure?: number
  target_flow?: number
  stage_name: string
}

interface LocalAnalysisResult {
  shot_summary: ShotSummary
  weight_analysis: WeightAnalysisLocal
  stage_analyses: StageAnalysisLocal[]
  unreached_stages: string[]
  preinfusion_summary: PreinfusionSummary
  profile_info: ProfileInfo
  profile_target_curves?: ProfileTargetPoint[]
}

interface ChartDataPoint {
  time: number
  pressure?: number
  flow?: number
  weight?: number
  gravimetricFlow?: number
  stage?: string
}

interface StageRange {
  name: string
  startTime: number
  endTime: number
  colorIndex: number
}

// Custom tooltip payload type (extends Recharts default)
interface TooltipPayloadItem {
  name: string
  value: number
  color: string
  dataKey: string
  payload?: ChartDataPoint
}

// Custom tooltip for the chart
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: number }) {
  if (!active || !payload || !payload.length) return null
  
  // Find stage from the first payload item if available
  const stageData = payload[0]?.payload
  const stageName = stageData?.stage
  
  return (
    <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1.5">
        Time: {typeof label === 'number' ? label.toFixed(1) : '0'}s
      </p>
      {stageName && typeof stageName === 'string' && (
        <p className="text-xs font-medium text-primary mb-1.5">
          Stage: {stageName}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div 
              className="w-2 h-2 rounded-full" 
              style={{ backgroundColor: item.color || '#888' }}
            />
            <span className="capitalize">{typeof item.name === 'string' ? item.name : 'Value'}:</span>
            <span className="font-medium">{typeof item.value === 'number' ? item.value.toFixed(2) : '-'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Shot-related quotes for the loader
const SHOT_QUOTES = [
  { quote: "You Miss 100% of the Shots You Don't Take", author: "Wayne Gretzky", meta: "— Michael Scott" },
  { quote: "I'm not throwing away my shot", author: "Lin-Manuel Miranda" },
  { quote: "Take your best shot", author: "Common saying" },
  { quote: "Give it your best shot", author: "English proverb" },
  { quote: "One shot, one opportunity", author: "Eminem" },
  { quote: "A shot in the dark", author: "Ozzy Osbourne" },
  { quote: "Shoot for the moon", author: "Les Brown" },
]

// Progress loader component with fake progress
function SearchingLoader({ estimatedSeconds = 60 }: { estimatedSeconds?: number }) {
  const [progress, setProgress] = useState(0)
  const [showQuote, setShowQuote] = useState(false)
  const [currentQuote] = useState(() => SHOT_QUOTES[Math.floor(Math.random() * SHOT_QUOTES.length)])
  const startTimeRef = useRef(Date.now())
  
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      // Use an easing function that slows down as it approaches 95%
      // Never reaches 100% until actually complete
      const newProgress = Math.min(95, (1 - Math.exp(-elapsed / (estimatedSeconds / 3))) * 100)
      setProgress(newProgress)
    }, 100)
    
    return () => clearInterval(interval)
  }, [estimatedSeconds])

  // Show quote after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowQuote(true), 3000)
    return () => clearTimeout(timer)
  }, [])
  
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="w-full max-w-xs space-y-2">
        <Progress value={progress} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Searching machine history...</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
      <AnimatePresence mode="wait">
        {!showQuote ? (
          <motion.p
            key="scanning"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-xs text-muted-foreground/60 text-center max-w-[200px]"
          >
            Scanning shot logs from your Meticulous machine
          </motion.p>
        ) : (
          <motion.div
            key="quote"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-[280px] space-y-1"
          >
            <p className="text-xs text-muted-foreground/80 italic">
              "{currentQuote.quote}"
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              — {currentQuote.author}{currentQuote.meta ? ` ${currentQuote.meta}` : ''}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ShotHistoryView({ profileName, onBack }: ShotHistoryViewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const { shots, isLoading, isBackgroundRefreshing, error, lastFetched, fetchShotsByProfile, backgroundRefresh, fetchShotData } = useShotHistory()
  const [selectedShot, setSelectedShot] = useState<ShotInfo | null>(null)
  const [shotData, setShotData] = useState<ShotData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  
  // Comparison state (embedded in Compare tab)
  const [comparisonShot, setComparisonShot] = useState<ShotInfo | null>(null)
  const [comparisonShotData, setComparisonShotData] = useState<ShotData | null>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  
  // Comparison replay state
  const [comparisonIsPlaying, setComparisonIsPlaying] = useState(false)
  const [comparisonPlaybackSpeed, setComparisonPlaybackSpeed] = useState(1)
  const [comparisonCurrentTime, setComparisonCurrentTime] = useState(0)
  const [comparisonMaxTime, setComparisonMaxTime] = useState(0)
  const comparisonAnimationRef = useRef<number | null>(null)
  const comparisonLastFrameTimeRef = useRef<number>(0)
  
  // Action tab state
  const [activeAction, setActiveAction] = useState<'replay' | 'compare' | 'analyze'>('replay')
  
  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<LocalAnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [isExportingAnalysis, setIsExportingAnalysis] = useState(false)
  const analysisCardRef = useRef<HTMLDivElement>(null)
  
  // LLM Analysis state
  const [llmAnalysisResult, setLlmAnalysisResult] = useState<string | null>(null)
  const [isLlmAnalyzing, setIsLlmAnalyzing] = useState(false)
  const [llmAnalysisError, setLlmAnalysisError] = useState<string | null>(null)
  const [showLlmView, setShowLlmView] = useState(false)
  const [isLlmCached, setIsLlmCached] = useState(false)
  
  // Debug: Log when showLlmView state changes
  useEffect(() => {
    console.log('[ShotHistoryView] *** showLlmView STATE CHANGED TO:', showLlmView)
  }, [showLlmView])
  
  // Check server-side LLM analysis cache when shot changes
  useEffect(() => {
    console.log('[ShotHistoryView] Cache useEffect triggered - selectedShot:', selectedShot?.filename, 'profileName:', profileName)
    
    if (!selectedShot) {
      console.log('[ShotHistoryView] No selectedShot - clearing cache state')
      setLlmAnalysisResult(null)
      setIsLlmCached(false)
      return
    }
    
    // Check server-side cache
    const checkServerCache = async () => {
      try {
        const serverUrl = await getServerUrl()
        const params = new URLSearchParams({
          profile_name: profileName,
          shot_date: selectedShot.date,
          shot_filename: selectedShot.filename
        })
        
        const response = await fetch(`${serverUrl}/api/shots/llm-analysis-cache?${params}`)
        if (response.ok) {
          const data = await response.json()
          if (data.cached && data.analysis) {
            console.log('[ShotHistoryView] Server cache HIT - using cached analysis')
            setLlmAnalysisResult(data.analysis)
            setIsLlmCached(true)
            return
          }
        }
        console.log('[ShotHistoryView] Server cache MISS')
        setLlmAnalysisResult(null)
        setIsLlmCached(false)
      } catch (e) {
        console.log('[ShotHistoryView] Error checking server cache:', e)
        setLlmAnalysisResult(null)
        setIsLlmCached(false)
      }
    }
    
    checkServerCache()
  }, [selectedShot, profileName])

  // Replay state
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [maxTime, setMaxTime] = useState(0)
  const animationRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  // Reset replay state when shot changes
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [selectedShot])

  // Animation loop for replay
  useEffect(() => {
    if (!isPlaying || maxTime === 0) return

    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp
      }

      const deltaMs = timestamp - lastFrameTimeRef.current
      lastFrameTimeRef.current = timestamp

      // Convert to seconds and apply playback speed
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

  // Replay control functions
  const handlePlayPause = useCallback(() => {
    if (currentTime >= maxTime) {
      // If at end, restart from beginning
      setCurrentTime(0)
    }
    setIsPlaying(prev => !prev)
  }, [currentTime, maxTime])

  const handleRestart = useCallback(() => {
    setCurrentTime(0)
    setIsPlaying(false)
  }, [])

  // Comparison replay animation loop
  useEffect(() => {
    if (!comparisonIsPlaying || comparisonMaxTime === 0) return

    const animate = (timestamp: number) => {
      if (comparisonLastFrameTimeRef.current === 0) {
        comparisonLastFrameTimeRef.current = timestamp
      }

      const deltaMs = timestamp - comparisonLastFrameTimeRef.current
      comparisonLastFrameTimeRef.current = timestamp
      const deltaSeconds = (deltaMs / 1000) * comparisonPlaybackSpeed

      setComparisonCurrentTime(prev => {
        const next = prev + deltaSeconds
        if (next >= comparisonMaxTime) {
          setComparisonIsPlaying(false)
          return comparisonMaxTime
        }
        return next
      })

      comparisonAnimationRef.current = requestAnimationFrame(animate)
    }

    comparisonAnimationRef.current = requestAnimationFrame(animate)

    return () => {
      if (comparisonAnimationRef.current) {
        cancelAnimationFrame(comparisonAnimationRef.current)
        comparisonAnimationRef.current = null
      }
      comparisonLastFrameTimeRef.current = 0
    }
  }, [comparisonIsPlaying, comparisonPlaybackSpeed, comparisonMaxTime])

  // Reset comparison replay when comparison shot changes
  useEffect(() => {
    setComparisonIsPlaying(false)
    setComparisonCurrentTime(0)
    if (comparisonAnimationRef.current) {
      cancelAnimationFrame(comparisonAnimationRef.current)
      comparisonAnimationRef.current = null
    }
  }, [comparisonShot])

  // Comparison replay control functions
  const handleComparisonPlayPause = useCallback(() => {
    if (comparisonCurrentTime >= comparisonMaxTime) {
      setComparisonCurrentTime(0)
    }
    setComparisonIsPlaying(prev => !prev)
  }, [comparisonCurrentTime, comparisonMaxTime])

  const handleComparisonRestart = useCallback(() => {
    setComparisonCurrentTime(0)
    setComparisonIsPlaying(false)
  }, [])

  // Calculate max time when shot data changes
  useEffect(() => {
    if (shotData) {
      // Extract time data from shot data
      const dataEntries = (shotData.data as unknown as Array<{
        shot?: { pressure?: number };
        time?: number;
        profile_time?: number;
      }>) || []
      
      if (Array.isArray(dataEntries) && dataEntries.length > 0) {
        // Get the last entry's time
        const lastEntry = dataEntries[dataEntries.length - 1]
        const lastTime = (lastEntry?.time || lastEntry?.profile_time || 0) / 1000
        if (lastTime > 0) {
          setMaxTime(lastTime)
        }
      }
    }
  }, [shotData])

  // Fetch shots with stale-while-revalidate pattern
  useEffect(() => {
    const loadShots = async () => {
      try {
        const result = await fetchShotsByProfile(profileName, { limit: 20, includeData: false })
        
        // If server returned stale data, trigger background refresh
        if (result.is_stale) {
          console.log('Cache is stale, refreshing in background...')
          backgroundRefresh(profileName, { limit: 20 })
        }
      } catch (err) {
        console.error('Failed to fetch shots:', err)
      }
    }
    
    loadShots()
  }, [profileName, fetchShotsByProfile, backgroundRefresh])

  const handleSelectShot = async (shot: ShotInfo) => {
    setSelectedShot(shot)
    setLoadingData(true)
    setDataError(null)
    setShotData(null)

    try {
      const data = await fetchShotData(shot.date, shot.filename)
      setShotData(data)
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load shot data')
    } finally {
      setLoadingData(false)
    }
  }

  const handleBack = () => {
    if (selectedShot) {
      setSelectedShot(null)
      setShotData(null)
      setDataError(null)
    } else {
      onBack()
    }
  }

  const handleRefresh = () => {
    // Use background refresh to keep showing cached data while fetching
    backgroundRefresh(profileName, { limit: 20 })
  }

  // Analyze the current shot against its profile
  const handleAnalyze = async () => {
    if (!selectedShot || !shotData) return
    
    setIsAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    
    try {
      const serverUrl = await getServerUrl()
      
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('shot_date', selectedShot.date)
      formData.append('shot_filename', selectedShot.filename)
      
      // Optional: pass profile description if available from shot data
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) {
        formData.append('profile_description', profileDesc)
      }
      
      const response = await fetch(`${serverUrl}/api/shots/analyze`, {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Analysis failed' }))
        throw new Error(errorData.detail?.message || errorData.message || 'Analysis failed')
      }
      
      const result = await response.json()
      
      if (result.status === 'success') {
        setAnalysisResult(result.analysis)
      } else {
        throw new Error(result.message || 'Analysis failed')
      }
    } catch (err) {
      console.error('Analysis failed:', err)
      setAnalysisError(err instanceof Error ? err.message : 'Failed to analyze shot')
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Auto-analyze when shot data loads (runs in background so it's ready when user switches to Analyze tab)
  useEffect(() => {
    // Reset previous analysis (both local and LLM)
    setAnalysisResult(null)
    setAnalysisError(null)
    setLlmAnalysisResult(null)
    setLlmAnalysisError(null)
    
    // Auto-trigger analysis when shot data is available
    if (selectedShot && shotData && !isAnalyzing) {
      // Small delay to avoid blocking UI during initial render
      const timer = setTimeout(() => {
        handleAnalyze()
      }, 100)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [selectedShot, shotData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Export analysis as image
  const handleExportAnalysis = async () => {
    if (!analysisCardRef.current || !analysisResult || !selectedShot) return
    
    try {
      setIsExportingAnalysis(true)
      
      // Get the element's full width including any clipped content
      const element = analysisCardRef.current
      const rect = element.getBoundingClientRect()
      const padding = 20
      
      // Wait for DOM to update
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const dataUrl = await domToPng(element, {
        scale: 2,
        backgroundColor: '#09090b',
        width: rect.width + (padding * 2),
        height: element.scrollHeight + (padding * 2),
        style: {
          padding: `${padding}px`,
          boxSizing: 'content-box',
          transform: 'none',
          transformOrigin: 'top left'
        }
      })
      
      // Create filename from profile and shot date
      const shotDate = selectedShot.date.replace(/-/g, '')
      const shotTime = selectedShot.filename.replace(/[:.]/g, '').replace('.shot.json', '')
      const safeProfileName = profileName.replace(/[^a-zA-Z0-9]/g, '_')
      const filename = `${safeProfileName}_analysis_${shotDate}_${shotTime}.png`
      
      const link = document.createElement('a')
      link.download = filename
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('Error exporting analysis:', error)
    } finally {
      setIsExportingAnalysis(false)
    }
  }

  // LLM-powered expert analysis
  const handleLlmAnalysis = async () => {
    console.log('[ShotHistoryView] handleLlmAnalysis called')
    console.log('[ShotHistoryView] selectedShot:', selectedShot?.filename, 'shotData exists:', !!shotData)
    
    if (!selectedShot || !shotData) {
      console.log('[ShotHistoryView] Aborting - no selectedShot or shotData')
      return
    }
    
    // Open view immediately and start loading
    console.log('[ShotHistoryView] Setting showLlmView to TRUE')
    setShowLlmView(true)
    setIsLlmAnalyzing(true)
    setLlmAnalysisError(null)
    
    try {
      const serverUrl = await getServerUrl()
      
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('shot_date', selectedShot.date)
      formData.append('shot_filename', selectedShot.filename)
      
      // Pass profile description if available
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) {
        formData.append('profile_description', profileDesc)
      }
      
      const response = await fetch(`${serverUrl}/api/shots/analyze-llm`, {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LLM Analysis failed' }))
        throw new Error(errorData.detail?.message || errorData.detail?.error || errorData.message || 'LLM Analysis failed')
      }
      
      const result = await response.json()
      console.log('[ShotHistoryView] LLM API result:', result)
      
      if (result.status === 'success') {
        console.log('[ShotHistoryView] Analysis success, result cached on server')
        setLlmAnalysisResult(result.llm_analysis)
        setIsLlmCached(result.cached || false)
      } else {
        throw new Error(result.message || 'LLM Analysis failed')
      }
    } catch (err) {
      console.error('LLM Analysis failed:', err)
      setLlmAnalysisError(err instanceof Error ? err.message : 'Failed to get expert analysis')
    } finally {
      setIsLlmAnalyzing(false)
    }
  }
  
  // Open LLM view to see cached result
  const handleViewLlmAnalysis = async () => {
    console.log('[ShotHistoryView] handleViewLlmAnalysis called - opening view')
    
    // If we don't have the result in state but it's cached on server, load it now
    if (!llmAnalysisResult && selectedShot && isLlmCached) {
      try {
        const serverUrl = await getServerUrl()
        const params = new URLSearchParams({
          profile_name: profileName,
          shot_date: selectedShot.date,
          shot_filename: selectedShot.filename
        })
        
        const response = await fetch(`${serverUrl}/api/shots/llm-analysis-cache?${params}`)
        if (response.ok) {
          const data = await response.json()
          if (data.cached && data.analysis) {
            console.log('[ShotHistoryView] Loaded cached analysis from server for view')
            setLlmAnalysisResult(data.analysis)
          }
        }
      } catch (e) {
        console.log('[ShotHistoryView] Failed to load cached analysis:', e)
      }
    }
    
    setShowLlmView(true)
  }
  
  // Re-analyze (force fresh analysis, ignore cache)
  const handleReAnalyze = async () => {
    if (!selectedShot || !shotData) return
    
    console.log('[ShotHistoryView] Re-analyzing with force_refresh=true')
    
    // Reset state
    setLlmAnalysisResult(null)
    setIsLlmCached(false)
    setLlmAnalysisError(null)
    setIsLlmAnalyzing(true)
    
    try {
      const serverUrl = await getServerUrl()
      
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('shot_date', selectedShot.date)
      formData.append('shot_filename', selectedShot.filename)
      formData.append('force_refresh', 'true')  // Force server to regenerate
      
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) {
        formData.append('profile_description', profileDesc)
      }
      
      const response = await fetch(`${serverUrl}/api/shots/analyze-llm`, {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LLM Analysis failed' }))
        throw new Error(errorData.detail?.message || errorData.detail?.error || errorData.message || 'LLM Analysis failed')
      }
      
      const result = await response.json()
      
      if (result.status === 'success') {
        setLlmAnalysisResult(result.llm_analysis)
        setIsLlmCached(false)  // Fresh analysis
      } else {
        throw new Error(result.message || 'LLM Analysis failed')
      }
    } catch (err) {
      console.error('Re-analysis failed:', err)
      setLlmAnalysisError(err instanceof Error ? err.message : 'Failed to get expert analysis')
    } finally {
      setIsLlmAnalyzing(false)
    }
  }
  
  // Close LLM view handler
  const handleCloseLlmView = () => {
    console.log('[ShotHistoryView] Closing LLM view')
    setShowLlmView(false)
  }

  // Transform shot data into chart-compatible format
  const getChartData = (data: ShotData): ChartDataPoint[] => {
    // Meticulous shot data structure: array of entries with nested 'shot' object
    // Each entry has: { shot: { pressure, flow, weight, gravimetric_flow, ... }, time: milliseconds, status: stageName, sensors: {...} }
    const dataEntries = (data.data as unknown as Array<{
      shot?: { pressure?: number; flow?: number; weight?: number; gravimetric_flow?: number };
      time?: number;
      profile_time?: number;
      status?: string;
    }>) || []
    
    if (Array.isArray(dataEntries) && dataEntries.length > 0 && dataEntries[0]?.shot) {
      // Meticulous format with nested shot object
      return dataEntries.map(entry => ({
        time: (entry.time || entry.profile_time || 0) / 1000, // Convert ms to seconds
        pressure: entry.shot?.pressure,
        flow: entry.shot?.flow,
        weight: entry.shot?.weight,
        gravimetricFlow: entry.shot?.gravimetric_flow,
        stage: entry.status
      }))
    }
    
    // Fallback: try other formats
    const telemetry = data.data || data
    
    // Check if we have arrays of data (alternate format)
    const timeArray = (telemetry as Record<string, unknown>).time as number[] || []
    const pressureArray = (telemetry as Record<string, unknown>).pressure as number[] || []
    const flowArray = (telemetry as Record<string, unknown>).flow as number[] || []
    const weightArray = (telemetry as Record<string, unknown>).weight as number[] || []
    
    if (Array.isArray(timeArray) && timeArray.length > 0) {
      // Standard array format
      const chartData: ChartDataPoint[] = []
      for (let i = 0; i < timeArray.length; i++) {
        chartData.push({
          time: timeArray[i],
          pressure: pressureArray[i],
          flow: flowArray[i],
          weight: weightArray[i]
        })
      }
      return chartData
    }
    
    // Try log entries format
    const logEntries = (data as Record<string, unknown>).log as Array<Record<string, number>> || []
    if (logEntries.length > 0) {
      return logEntries.map(entry => ({
        time: entry.time || entry.t || 0,
        pressure: entry.pressure || entry.p,
        flow: entry.flow || entry.f,
        weight: entry.weight || entry.w
      }))
    }
    
    return []
  }

  // Extract stage ranges for background coloring
  const getStageRanges = (chartData: ChartDataPoint[]): StageRange[] => {
    const ranges: StageRange[] = []
    let currentStage: string | null = null
    let stageStart = 0
    let colorIndex = 0
    const stageColorMap = new Map<string, number>()
    
    chartData.forEach((point, index) => {
      if (point.stage && point.stage !== currentStage) {
        // End previous stage
        if (currentStage !== null) {
          ranges.push({
            name: currentStage,
            startTime: stageStart,
            endTime: point.time,
            colorIndex: stageColorMap.get(currentStage) || 0
          })
        }
        
        // Start new stage
        currentStage = point.stage
        stageStart = point.time
        
        if (!stageColorMap.has(currentStage)) {
          stageColorMap.set(currentStage, colorIndex % STAGE_COLORS.length)
          colorIndex++
        }
      }
      
      // Handle last point
      if (index === chartData.length - 1 && currentStage) {
        ranges.push({
          name: currentStage,
          startTime: stageStart,
          endTime: point.time,
          colorIndex: stageColorMap.get(currentStage) || 0
        })
      }
    })
    
    return ranges
  }

  // Merge shot chart data with profile target curves for overlay
  const mergeWithTargetCurves = (
    chartData: ChartDataPoint[], 
    targetCurves: ProfileTargetPoint[] | undefined
  ): (ChartDataPoint & { targetPressure?: number; targetFlow?: number })[] => {
    if (!targetCurves || targetCurves.length === 0) {
      return chartData
    }
    
    // Filter and sort target points once for better performance
    const pressurePoints = targetCurves
      .filter(c => c.target_pressure !== undefined)
      .sort((a, b) => a.time - b.time)
    
    const flowPoints = targetCurves
      .filter(c => c.target_flow !== undefined)
      .sort((a, b) => a.time - b.time)
    
    // Helper function for binary search to find upper bound (first element > time)
    const findUpperBound = (points: ProfileTargetPoint[], time: number): number => {
      let left = 0
      let right = points.length
      
      while (left < right) {
        const mid = left + Math.floor((right - left) / 2)
        if (points[mid].time <= time) {
          left = mid + 1
        } else {
          right = mid
        }
      }
      
      return left
    }
    
    // Add target values to chart data points using linear interpolation
    return chartData.map(point => {
      
      // Find surrounding target points for interpolation
      let targetPressure: number | undefined
      let targetFlow: number | undefined
      
      // Find pressure target using binary search for efficiency
      if (pressurePoints.length > 0) {
        // Find the index where point.time would be inserted (first point > time)
        const afterIndex = findUpperBound(pressurePoints, point.time)
        
        if (afterIndex === 0) {
          // All points are after current time
          targetPressure = pressurePoints[0].target_pressure
        } else if (afterIndex === pressurePoints.length) {
          // All points are before current time
          targetPressure = pressurePoints[pressurePoints.length - 1].target_pressure
        } else {
          // We have points before and after
          const before = pressurePoints[afterIndex - 1]
          const after = pressurePoints[afterIndex]
          
          // Interpolate (guard against division by zero)
          const timeDiff = after.time - before.time
          if (timeDiff === 0) {
            targetPressure = before.target_pressure!
          } else {
            const t = (point.time - before.time) / timeDiff
            targetPressure = before.target_pressure! + t * (after.target_pressure! - before.target_pressure!)
          }
        }
      }
      
      // Find flow target using binary search for efficiency
      if (flowPoints.length > 0) {
        const afterIndex = findUpperBound(flowPoints, point.time)
        
        if (afterIndex === 0) {
          targetFlow = flowPoints[0].target_flow
        } else if (afterIndex === flowPoints.length) {
          targetFlow = flowPoints[flowPoints.length - 1].target_flow
        } else {
          const before = flowPoints[afterIndex - 1]
          const after = flowPoints[afterIndex]
          
          // Interpolate (guard against division by zero)
          const timeDiff = after.time - before.time
          if (timeDiff === 0) {
            targetFlow = before.target_flow!
          } else {
            const t = (point.time - before.time) / timeDiff
            targetFlow = before.target_flow! + t * (after.target_flow! - before.target_flow!)
          }
        }
      }
      
      return {
        ...point,
        targetPressure,
        targetFlow
      }
    })
  }

  const formatShotTime = (shot: ShotInfo) => {
    try {
      if (shot.timestamp && (typeof shot.timestamp === 'string' || typeof shot.timestamp === 'number')) {
        // Unix timestamp in seconds - might be string or number
        const ts = typeof shot.timestamp === 'string' ? parseFloat(shot.timestamp) : shot.timestamp
        if (!isNaN(ts) && ts > 0) {
          const date = new Date(ts * 1000)
          return format(date, 'MMM d, HH:mm')
        }
      }
      // Extract time from filename (format: HH:MM:SS.shot.json.zst or HH:MM:SS.shot.json)
      if (shot.filename && typeof shot.filename === 'string') {
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

  // Helper: Get selectable shots for comparison (exclude current shot)
  const selectableShots = shots.filter(s => 
    !(s.date === selectedShot?.date && s.filename === selectedShot?.filename)
  )

  // Helper: Load comparison shot data
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

  // Helper: Clear comparison
  const handleClearComparison = () => {
    setComparisonShot(null)
    setComparisonShotData(null)
    setComparisonError(null)
  }

  // Helper: Get chart data from shot (handles multiple formats)
  const getComparisonChartData = (data: ShotData): { time: number; pressure: number; flow: number; weight: number }[] => {
    const dataEntries = data.data as unknown
    
    // Format 1: Array with nested shot object
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
    
    return []
  }

  // Helper: Calculate comparison stats
  const getComparisonStats = () => {
    if (!selectedShot || !comparisonShot || !shotData || !comparisonShotData) return null
    
    const dataA = getComparisonChartData(shotData)
    const dataB = getComparisonChartData(comparisonShotData)
    
    const durationA = selectedShot.total_time || 0
    const durationB = comparisonShot.total_time || 0
    const yieldA = selectedShot.final_weight || 0
    const yieldB = comparisonShot.final_weight || 0
    const maxPressureA = Math.max(...dataA.map(d => d.pressure))
    const maxPressureB = Math.max(...dataB.map(d => d.pressure))
    const maxFlowA = Math.max(...dataA.map(d => d.flow))
    const maxFlowB = Math.max(...dataB.map(d => d.flow))
    
    const calcDiff = (a: number, b: number) => ({
      a, b,
      diff: a - b,
      diffPercent: b !== 0 ? ((a - b) / b) * 100 : 0
    })
    
    return {
      duration: calcDiff(durationA, durationB),
      yield: calcDiff(yieldA, yieldB),
      maxPressure: calcDiff(maxPressureA, maxPressureB),
      maxFlow: calcDiff(maxFlowA, maxFlowB)
    }
  }

  // Helper: Build combined chart data for comparison
  const getCombinedChartData = () => {
    if (!shotData) return []
    
    const dataA = getComparisonChartData(shotData)
    
    if (!comparisonShotData) {
      return dataA.map(d => ({
        time: d.time,
        pressureA: d.pressure,
        flowA: d.flow,
        weightA: d.weight,
        pressureB: undefined as number | undefined,
        flowB: undefined as number | undefined,
        weightB: undefined as number | undefined,
      }))
    }
    
    const dataB = getComparisonChartData(comparisonShotData)
    
    // Use the longer dataset as base
    const useAAsBase = dataA.length >= dataB.length
    const baseData = useAAsBase ? dataA : dataB
    const otherData = useAAsBase ? dataB : dataA
    
    // Interpolate other dataset to match base timestamps
    const findClosestPoint = (time: number, data: typeof dataA) => {
      if (data.length === 0) return null
      if (time < data[0].time || time > data[data.length - 1].time) return null
      
      let left = 0, right = data.length - 1
      while (left < right) {
        const mid = Math.floor((left + right) / 2)
        if (data[mid].time < time) left = mid + 1
        else right = mid
      }
      
      const idx = left
      if (idx === 0 || data[idx].time === time) return data[idx]
      
      const before = data[idx - 1], after = data[idx]
      const t = (time - before.time) / (after.time - before.time)
      return {
        pressure: before.pressure + t * (after.pressure - before.pressure),
        flow: before.flow + t * (after.flow - before.flow),
        weight: before.weight + t * (after.weight - before.weight)
      }
    }
    
    return baseData.map(basePoint => {
      const otherPoint = findClosestPoint(basePoint.time, otherData)
      if (useAAsBase) {
        return {
          time: basePoint.time,
          pressureA: basePoint.pressure, flowA: basePoint.flow, weightA: basePoint.weight,
          pressureB: otherPoint?.pressure, flowB: otherPoint?.flow, weightB: otherPoint?.weight
        }
      } else {
        return {
          time: basePoint.time,
          pressureA: otherPoint?.pressure, flowA: otherPoint?.flow, weightA: otherPoint?.weight,
          pressureB: basePoint.pressure, flowB: basePoint.flow, weightB: basePoint.weight
        }
      }
    })
  }

  // Update comparison max time when comparison data changes
  useEffect(() => {
    if (shotData && comparisonShotData) {
      const dataA = getComparisonChartData(shotData)
      const dataB = getComparisonChartData(comparisonShotData)
      const maxA = dataA.length > 0 ? dataA[dataA.length - 1].time : 0
      const maxB = dataB.length > 0 ? dataB[dataB.length - 1].time : 0
      setComparisonMaxTime(Math.max(maxA, maxB))
    }
  }, [shotData, comparisonShotData])

  if (selectedShot) {
    // Show Expert Analysis view when active, otherwise show Shot Details
    if (showLlmView) {
      return (
        <ExpertAnalysisView
          isLoading={isLlmAnalyzing}
          analysisResult={llmAnalysisResult}
          error={llmAnalysisError}
          onBack={handleCloseLlmView}
          onReAnalyze={handleReAnalyze}
          profileName={profileName}
          shotDate={selectedShot?.date}
          isCached={isLlmCached}
        />
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="shrink-0"
            >
              <CaretLeft size={22} weight="bold" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">
                Shot Details
              </h2>
              <p className="text-xs text-muted-foreground/70">
                {formatShotTime(selectedShot)}
              </p>
            </div>
          </div>

          {loadingData ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-sm text-muted-foreground">Loading shot data...</p>
              </div>
            </div>
          ) : dataError ? (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
              <Warning size={18} weight="fill" />
              <AlertDescription className="text-sm">{dataError}</AlertDescription>
            </Alert>
          ) : shotData ? (
            <div className="space-y-4 lg:space-y-0 desktop-two-col">
              {/* Left column: Stats + Chart */}
              <div className="space-y-4 desktop-panel-left">
              {/* Shot Summary Stats */}
              <div className="grid grid-cols-3 gap-3">
                {typeof selectedShot.total_time === 'number' && (
                  <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock size={14} weight="bold" />
                      <span className="text-xs font-medium">Duration</span>
                    </div>
                    <p className="text-lg font-bold">
                      {selectedShot.total_time.toFixed(1)}s
                    </p>
                  </div>
                )}
                {typeof selectedShot.final_weight === 'number' && (
                  <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Drop size={14} weight="fill" />
                      <span className="text-xs font-medium">Yield</span>
                    </div>
                    <p className="text-lg font-bold">
                      {selectedShot.final_weight.toFixed(1)}g
                    </p>
                  </div>
                )}
                {typeof shotData.profile?.temperature === 'number' && (
                  <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Thermometer size={14} weight="fill" />
                      <span className="text-xs font-medium">Temp</span>
                    </div>
                    <p className="text-lg font-bold">
                      {shotData.profile.temperature}°C
                    </p>
                  </div>
                )}
              </div>

              {/* Chart */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold tracking-wide text-primary flex items-center gap-2">
                    <ChartLine size={16} weight="bold" />
                    Extraction Graph
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
                    {(() => {
                      const chartData = getChartData(shotData)
                      const stageRanges = getStageRanges(chartData)
                      const hasGravFlow = chartData.some(d => d.gravimetricFlow !== undefined && d.gravimetricFlow > 0)
                      const dataMaxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : 0
                      
                      // Merge with profile target curves if analysis has been done
                      const mergedData = mergeWithTargetCurves(chartData, analysisResult?.profile_target_curves)
                      // Note: hasTargetCurves could be used for conditional rendering if needed:
                      // const hasTargetCurves = analysisResult?.profile_target_curves && analysisResult.profile_target_curves.length > 0
                      
                      // Calculate fixed max values from full dataset for stable axes
                      // Include target curve values to ensure they're not clipped
                      const maxPressure = Math.max(
                        ...chartData.map(d => d.pressure || 0),
                        ...(analysisResult?.profile_target_curves?.map(d => d.target_pressure || 0) || []),
                        12
                      )
                      const maxFlow = Math.max(
                        ...chartData.map(d => Math.max(d.flow || 0, d.gravimetricFlow || 0)),
                        ...(analysisResult?.profile_target_curves?.map(d => d.target_flow || 0) || []),
                        8
                      )
                      const maxLeftAxis = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
                      const maxWeight = Math.max(...chartData.map(d => d.weight || 0), 50)
                      const maxRightAxis = Math.ceil(maxWeight * 1.1)
                      
                      // Filter data for replay - show data up to currentTime while playing or paused at a position
                      // Only show full data when at start (0) or at end (>= maxTime)
                      const isShowingReplay = currentTime > 0 && currentTime < dataMaxTime
                      const displayData = isShowingReplay
                        ? mergedData.filter(d => d.time <= currentTime)
                        : mergedData
                      
                      // Filter stage ranges to only show stages that have started (for progressive reveal)
                      const displayStageRanges = isShowingReplay
                        ? stageRanges
                            .filter(stage => stage.startTime <= currentTime)
                            .map(stage => ({
                              ...stage,
                              // Clip the end time to current time if stage is still in progress
                              endTime: Math.min(stage.endTime, currentTime)
                            }))
                        : stageRanges
                      
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={displayData} margin={{ top: 5, right: 0, left: -5, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
                            
                            {/* Stage background areas - progressively revealed during replay */}
                            {displayStageRanges.map((stage, idx) => (
                              <ReferenceArea
                                key={idx}
                                yAxisId="left"
                                x1={stage.startTime}
                                x2={stage.endTime}
                                fill={STAGE_COLORS[stage.colorIndex]}
                                fillOpacity={1}
                                stroke={STAGE_BORDER_COLORS[stage.colorIndex]}
                                strokeWidth={0}
                                ifOverflow="extendDomain"
                              />
                            ))}
                            
                            {/* Playhead reference line during replay */}
                            {isShowingReplay && (
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
                              domain={[0, dataMaxTime]}
                              type="number"
                              allowDataOverflow={false}
                            />
                            <YAxis 
                              yAxisId="left" 
                              stroke="#666" 
                              fontSize={10}
                              domain={[0, maxLeftAxis]}
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
                              domain={[0, maxRightAxis]}
                              axisLine={{ stroke: '#444' }}
                              tickLine={{ stroke: '#444' }}
                              width={35}
                              allowDataOverflow={false}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend 
                              wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
                              iconType="circle"
                              iconSize={8}
                            />
                            <Line
                              yAxisId="left"
                              type="monotone"
                              dataKey="pressure"
                              stroke={CHART_COLORS.pressure}
                              strokeWidth={2}
                              dot={false}
                              name="Pressure (bar)"
                              isAnimationActive={false}
                            />
                            <Line
                              yAxisId="left"
                              type="monotone"
                              dataKey="flow"
                              stroke={CHART_COLORS.flow}
                              strokeWidth={2}
                              dot={false}
                              name="Flow (ml/s)"
                              isAnimationActive={false}
                            />
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey="weight"
                              stroke={CHART_COLORS.weight}
                              strokeWidth={2}
                              dot={false}
                              name="Weight (g)"
                              isAnimationActive={false}
                            />
                            {hasGravFlow && (
                              <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="gravimetricFlow"
                                stroke={CHART_COLORS.gravimetricFlow}
                                strokeWidth={1.5}
                                dot={false}
                                strokeDasharray="4 2"
                                name="Grav. Flow (g/s)"
                                isAnimationActive={false}
                              />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      )
                    })()}
                  </div>
                </div>
                
                {/* Stage Legend */}
                {(() => {
                  const chartData = getChartData(shotData)
                  const stageRanges = getStageRanges(chartData)
                  if (stageRanges.length === 0) return null
                  
                  return (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {stageRanges.map((stage, idx) => (
                        <Badge 
                          key={idx}
                          variant="outline"
                          className="text-[10px] px-2 py-0.5 font-medium"
                          style={{
                            backgroundColor: STAGE_COLORS[stage.colorIndex],
                            borderColor: STAGE_BORDER_COLORS[stage.colorIndex],
                            color: isDark ? STAGE_TEXT_COLORS_DARK[stage.colorIndex] : STAGE_TEXT_COLORS_LIGHT[stage.colorIndex]
                          }}
                        >
                          {typeof stage.name === 'string' ? stage.name : String(stage.name || '')}
                        </Badge>
                      ))}
                    </div>
                  )
                })()}
              </div>
              </div>{/* end left column */}

              {/* Right column: Action Tabs */}
              <div className="desktop-panel-right">
              <Tabs value={activeAction} onValueChange={(v) => setActiveAction(v as typeof activeAction)} className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-11 bg-secondary/60">
                  <TabsTrigger 
                    value="replay" 
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <Play size={14} weight={activeAction === 'replay' ? 'fill' : 'bold'} />
                    Replay
                  </TabsTrigger>
                  <TabsTrigger 
                    value="compare" 
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <GitDiff size={14} weight={activeAction === 'compare' ? 'fill' : 'bold'} />
                    Compare
                  </TabsTrigger>
                  <TabsTrigger 
                    value="analyze" 
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <MagnifyingGlass size={14} weight={activeAction === 'analyze' ? 'fill' : 'bold'} />
                    Analyze
                  </TabsTrigger>
                </TabsList>

                {/* Replay Tab Content */}
                <TabsContent value="replay" className="mt-4 overflow-hidden">
                  <motion.div
                    key="replay-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="space-y-4"
                  >
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
                        {/* Hover indicator */}
                        <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      
                      {/* Time display */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                        <span>{currentTime.toFixed(1)}s</span>
                        <span>{maxTime.toFixed(1)}s</span>
                      </div>
                    </div>
                  )}

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center gap-3">
                    {/* Restart Button */}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleRestart}
                      className="h-10 w-10 rounded-full"
                      title="Restart"
                    >
                      <ArrowCounterClockwise size={18} weight="bold" />
                    </Button>
                    
                    {/* Play/Pause Button */}
                    <Button
                      variant={isPlaying ? "secondary" : "default"}
                      size="icon"
                      onClick={handlePlayPause}
                      className="h-10 w-10 rounded-full shadow-lg"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
                        <Pause size={20} weight="fill" />
                      ) : (
                        <Play size={20} weight="fill" className="ml-0.5" />
                      )}
                    </Button>
                    
                    {/* Speed Control Dropdown */}
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
                  </motion.div>
                </TabsContent>

                {/* Compare Tab Content - Embedded */}
                <TabsContent value="compare" className="mt-4 overflow-hidden">
                  <motion.div
                    key="compare-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="space-y-4"
                  >
                  {/* Shot Selector */}
                  <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-medium text-muted-foreground">Compare with:</Label>
                      {comparisonShot && (
                        <button 
                          onClick={handleClearComparison}
                          className="p-1 hover:bg-destructive/20 rounded-full transition-colors"
                        >
                          <X size={14} weight="bold" className="text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    
                    {loadingComparison ? (
                      <div className="flex items-center gap-2 py-2">
                        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        <span className="text-xs text-muted-foreground">Loading shot data...</span>
                      </div>
                    ) : comparisonShot ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">Shot B</Badge>
                        <span className="text-sm font-medium">{formatShotTime(comparisonShot)}</span>
                        <span className="text-xs text-muted-foreground">
                          {comparisonShot.final_weight?.toFixed(1)}g
                        </span>
                      </div>
                    ) : selectableShots.length === 0 ? (
                      <p className="text-xs text-muted-foreground/60 py-2">
                        No other shots available to compare
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {selectableShots.map((shot) => (
                          <button
                            key={`${shot.date}|${shot.filename}`}
                            onClick={() => handleSelectComparisonShot(`${shot.date}|${shot.filename}`)}
                            className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg bg-background/50 hover:bg-primary/10 border border-border/30 hover:border-primary/30 transition-colors text-left"
                          >
                            <span className="text-sm font-medium">{formatShotTime(shot)}</span>
                            {typeof shot.final_weight === 'number' && (
                              <span className="text-xs text-muted-foreground">
                                {shot.final_weight.toFixed(1)}g
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {comparisonError && (
                    <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
                      <Warning size={16} weight="fill" />
                      <AlertDescription className="text-xs">{comparisonError}</AlertDescription>
                    </Alert>
                  )}

                  {/* Comparison Stats */}
                  {(() => {
                    const stats = getComparisonStats()
                    if (!stats) return null
                    
                    const StatCard = ({ label, icon: Icon, a, b, unit, diffPercent, higherIsBetter = true }: {
                      label: string; icon: React.ElementType; a: number; b: number; unit: string; diffPercent: number; higherIsBetter?: boolean
                    }) => {
                      const isPositive = diffPercent > 0
                      const isBetter = higherIsBetter ? isPositive : !isPositive
                      const isEqual = Math.abs(diffPercent) < 1
                      
                      return (
                        <div className="p-2.5 bg-secondary/30 rounded-xl border border-border/10 overflow-hidden">
                          <div className="flex items-center gap-1 text-muted-foreground mb-1">
                            <Icon size={12} weight="bold" className="shrink-0" />
                            <span className="text-[11px] font-medium truncate">{label}</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline gap-1 flex-wrap">
                              <span className="text-base font-bold text-primary">{a.toFixed(1)}</span>
                              <span className="text-[10px] text-muted-foreground">vs</span>
                              <span className="text-sm text-muted-foreground">{b.toFixed(1)}</span>
                              <span className="text-[9px] text-muted-foreground/60">{unit}</span>
                            </div>
                            <Badge 
                              variant={isEqual ? "secondary" : isBetter ? "default" : "destructive"}
                              className="text-[10px] px-1.5 py-0 h-5 w-fit"
                            >
                              {isEqual ? <Equals size={9} weight="bold" /> : isPositive ? <ArrowUp size={9} weight="bold" /> : <ArrowDown size={9} weight="bold" />}
                              {Math.abs(diffPercent).toFixed(0)}%
                            </Badge>
                          </div>
                        </div>
                      )
                    }
                    
                    return (
                      <div className="grid grid-cols-2 gap-2">
                        <StatCard label="Duration" icon={Clock} a={stats.duration.a} b={stats.duration.b} unit="s" diffPercent={stats.duration.diffPercent} higherIsBetter={false} />
                        <StatCard label="Yield" icon={Drop} a={stats.yield.a} b={stats.yield.b} unit="g" diffPercent={stats.yield.diffPercent} higherIsBetter={true} />
                        <StatCard label="Max Pressure" icon={Gauge} a={stats.maxPressure.a} b={stats.maxPressure.b} unit="bar" diffPercent={stats.maxPressure.diffPercent} higherIsBetter={false} />
                        <StatCard label="Max Flow" icon={Waves} a={stats.maxFlow.a} b={stats.maxFlow.b} unit="ml/s" diffPercent={stats.maxFlow.diffPercent} higherIsBetter={false} />
                      </div>
                    )
                  })()}

                  {/* Comparison Chart with Replay */}
                  {comparisonShotData && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-primary flex items-center gap-1.5">
                          <ChartLine size={14} weight="bold" />
                          Extraction Comparison
                        </Label>
                        {comparisonIsPlaying && (
                          <Badge variant="secondary" className="animate-pulse text-[10px]">
                            <Play size={8} weight="fill" className="mr-1" />
                            {comparisonPlaybackSpeed}x
                          </Badge>
                        )}
                      </div>
                      <div className="p-1 bg-secondary/40 rounded-xl border border-border/20">
                        <div className="h-64">
                          {(() => {
                            const combinedData = getCombinedChartData()
                            const dataMaxTime = combinedData.length > 0 ? combinedData[combinedData.length - 1].time : 0
                            const maxPressure = Math.max(...combinedData.map(d => Math.max(d.pressureA || 0, d.pressureB || 0)), 12)
                            const maxFlow = Math.max(...combinedData.map(d => Math.max(d.flowA || 0, d.flowB || 0)), 8)
                            const maxWeight = Math.max(...combinedData.map(d => Math.max(d.weightA || 0, d.weightB || 0)), 50)
                            const leftDomain = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
                            const rightDomain = Math.ceil(maxWeight * 1.1)
                            
                            // Filter data for replay - show data when playing or paused at a position
                            const isShowingReplay = comparisonCurrentTime > 0 && comparisonCurrentTime < dataMaxTime
                            const displayData = isShowingReplay
                              ? combinedData.filter(d => d.time <= comparisonCurrentTime)
                              : combinedData
                            
                            return (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={displayData} margin={{ top: 5, right: 0, left: -5, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
                                  
                                  {/* Playhead during replay */}
                                  {isShowingReplay && (
                                    <ReferenceLine
                                      yAxisId="left"
                                      x={comparisonCurrentTime}
                                      stroke="#fff"
                                      strokeWidth={2}
                                      strokeDasharray="4 2"
                                    />
                                  )}
                                  
                                  <XAxis 
                                    dataKey="time" 
                                    stroke="#666" 
                                    fontSize={10}
                                    tickFormatter={(v) => `${Math.round(v)}s`}
                                    domain={[0, dataMaxTime]}
                                    type="number"
                                    allowDataOverflow={false}
                                  />
                                  <YAxis yAxisId="left" stroke="#666" fontSize={10} domain={[0, leftDomain]} width={30} allowDataOverflow={false} />
                                  <YAxis yAxisId="right" orientation="right" stroke="#666" fontSize={10} domain={[0, rightDomain]} width={30} allowDataOverflow={false} />
                                  <Tooltip 
                                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }}
                                  />
                                  <Legend wrapperStyle={{ fontSize: '8px', paddingTop: '4px' }} iconSize={6} />
                                  
                                  {/* Shot A - Solid */}
                                  <Line yAxisId="left" type="monotone" dataKey="pressureA" stroke={COMPARISON_COLORS.pressure} strokeWidth={2} dot={false} name="Pressure A" isAnimationActive={false} />
                                  <Line yAxisId="left" type="monotone" dataKey="flowA" stroke={COMPARISON_COLORS.flow} strokeWidth={2} dot={false} name="Flow A" isAnimationActive={false} />
                                  <Line yAxisId="right" type="monotone" dataKey="weightA" stroke={COMPARISON_COLORS.weight} strokeWidth={2} dot={false} name="Weight A" isAnimationActive={false} />
                                  
                                  {/* Shot B - Dashed */}
                                  <Line yAxisId="left" type="monotone" dataKey="pressureB" stroke={COMPARISON_COLORS.pressure} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Pressure B" opacity={0.6} isAnimationActive={false} />
                                  <Line yAxisId="left" type="monotone" dataKey="flowB" stroke={COMPARISON_COLORS.flow} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Flow B" opacity={0.6} isAnimationActive={false} />
                                  <Line yAxisId="right" type="monotone" dataKey="weightB" stroke={COMPARISON_COLORS.weight} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Weight B" opacity={0.6} isAnimationActive={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            )
                          })()}
                        </div>
                      </div>
                      
                      {/* Legend */}
                      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-primary rounded" /> Shot A (solid)</span>
                        <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-primary/50 rounded border-dashed" /> Shot B (dashed)</span>
                      </div>
                      
                      {/* Replay Controls */}
                      <div className="space-y-3 pt-2 border-t border-border/20">
                        {/* Progress Bar */}
                        {comparisonMaxTime > 0 && (
                          <div className="space-y-1.5">
                            <div 
                              className="h-2 bg-secondary/60 rounded-full overflow-hidden cursor-pointer relative group"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const x = e.clientX - rect.left
                                const percent = x / rect.width
                                setComparisonCurrentTime(percent * comparisonMaxTime)
                              }}
                            >
                              <motion.div 
                                className="h-full bg-primary rounded-full"
                                initial={false}
                                animate={{ width: `${(comparisonCurrentTime / comparisonMaxTime) * 100}%` }}
                                transition={{ duration: 0.05 }}
                              />
                              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                              <span>{comparisonCurrentTime.toFixed(1)}s</span>
                              <span>{comparisonMaxTime.toFixed(1)}s</span>
                            </div>
                          </div>
                        )}

                        {/* Playback Controls */}
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={handleComparisonRestart}
                            className="h-8 w-8 rounded-full"
                            title="Restart"
                          >
                            <ArrowCounterClockwise size={14} weight="bold" />
                          </Button>
                          
                          <Button
                            variant={comparisonIsPlaying ? "secondary" : "default"}
                            size="icon"
                            onClick={handleComparisonPlayPause}
                            className="h-10 w-10 rounded-full shadow-lg"
                            title={comparisonIsPlaying ? "Pause" : "Play"}
                          >
                            {comparisonIsPlaying ? (
                              <Pause size={20} weight="fill" />
                            ) : (
                              <Play size={20} weight="fill" className="ml-0.5" />
                            )}
                          </Button>
                          
                          <Select 
                            value={comparisonPlaybackSpeed.toString()} 
                            onValueChange={(v) => setComparisonPlaybackSpeed(parseFloat(v))}
                          >
                            <SelectTrigger className="w-20 h-8 rounded-full text-xs font-medium">
                              <Timer size={12} weight="bold" className="mr-0.5 shrink-0" />
                              <span className="font-mono">{comparisonPlaybackSpeed}x</span>
                            </SelectTrigger>
                            <SelectContent>
                              {SPEED_OPTIONS.map((speed) => (
                                <SelectItem key={speed} value={speed.toString()}>
                                  <span className="flex items-center gap-1">
                                    <Timer size={10} weight="bold" />
                                    {speed}x
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!comparisonShot && !loadingComparison && selectableShots.length > 0 && (
                    <div className="text-center py-4">
                      <GitDiff size={28} className="mx-auto mb-2 text-muted-foreground/30" weight="duotone" />
                      <p className="text-xs text-muted-foreground/50">Select a shot above to see comparison</p>
                    </div>
                  )}
                  </motion.div>
                </TabsContent>

                {/* Analyze Tab Content */}
                <TabsContent value="analyze" className="mt-4 overflow-hidden">
                  <motion.div
                    key="analyze-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="space-y-4"
                  >
                  
                  {/* Initial state - no analysis yet */}
                  {!analysisResult && !isAnalyzing && !analysisError && (
                    <div className="text-center py-6 space-y-3">
                      <div className="p-4 rounded-2xl bg-secondary/40 inline-block">
                        <ChartLine size={32} className="text-muted-foreground/60" weight="duotone" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground/80">Shot Analysis</p>
                        <p className="text-xs text-muted-foreground/60 mt-1 max-w-[250px] mx-auto">
                          Compare shot execution against profile targets, exit triggers, and limits.
                        </p>
                      </div>
                      <Button variant="default" size="sm" className="mt-2" onClick={handleAnalyze}>
                        <ChartLine size={14} weight="bold" className="mr-1.5" />
                        Analyze Shot
                      </Button>
                    </div>
                  )}
                  
                  {/* Loading state */}
                  {isAnalyzing && (
                    <div className="text-center py-8 space-y-4">
                      <div className="relative inline-block">
                        <div className="p-4 rounded-2xl bg-primary/10 inline-block">
                          <ChartLine size={32} className="text-primary animate-pulse" weight="duotone" />
                        </div>
                        <div className="absolute inset-0 rounded-2xl border-2 border-primary/30 animate-ping" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground/80">Analyzing Shot...</p>
                        <p className="text-xs text-muted-foreground/60">
                          Comparing stages against profile targets
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Error state */}
                  {analysisError && (
                    <div className="space-y-3">
                      <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
                        <Warning size={18} weight="fill" />
                        <AlertDescription className="text-sm">{analysisError}</AlertDescription>
                      </Alert>
                      <div className="flex justify-center">
                        <Button variant="outline" size="sm" onClick={handleAnalyze}>
                          <ArrowsCounterClockwise size={14} weight="bold" className="mr-1.5" />
                          Try Again
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Analysis Results - Local Analysis */}
                  {analysisResult && (
                    <div className="space-y-4">
                      {/* Early stage disclaimer */}
                      <Alert className="bg-primary/5 border-primary/20">
                        <Info size={16} weight="bold" className="text-primary" />
                        <AlertDescription className="text-xs text-muted-foreground">
                          This analysis feature is in early development. Suggestions for improvement are very welcome!
                        </AlertDescription>
                      </Alert>
                      
                      {/* Content to export */}
                      <div ref={analysisCardRef} className="space-y-4">
                        {/* Shot Summary Card */}
                        <div className="p-4 bg-gradient-to-br from-primary/10 via-secondary/30 to-secondary/20 rounded-xl border border-primary/20">
                          <div className="flex items-center gap-2 mb-3">
                            <ChartLine size={20} weight="fill" className="text-primary" />
                            <span className="text-base font-semibold">Shot Summary</span>
                            <span className="ml-auto text-xs text-muted-foreground">{profileName}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-xs text-muted-foreground">Weight</span>
                              <div className="flex items-baseline gap-1">
                                <span className="text-xl font-bold">{analysisResult.shot_summary.final_weight}g</span>
                                {analysisResult.shot_summary.target_weight && (
                                  <span className="text-sm text-muted-foreground">/ {analysisResult.shot_summary.target_weight}g</span>
                                )}
                              </div>
                              {analysisResult.weight_analysis.status !== 'on_target' && (
                                <Badge 
                                  variant="secondary"
                                  className={`text-xs mt-1 ${
                                    analysisResult.weight_analysis.status === 'under' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                                  }`}
                                >
                                  {analysisResult.weight_analysis.deviation_percent > 0 ? '+' : ''}{analysisResult.weight_analysis.deviation_percent}%
                              </Badge>
                            )}
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Duration</span>
                            <div className="text-xl font-bold">{analysisResult.shot_summary.total_time}s</div>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Max Pressure</span>
                            <div className="text-lg font-semibold">{analysisResult.shot_summary.max_pressure} bar</div>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Max Flow</span>
                            <div className="text-lg font-semibold">{analysisResult.shot_summary.max_flow} ml/s</div>
                          </div>
                        </div>
                        
                        {/* Profile Target Curves Chart */}
                        {shotData && (
                          <div className="mt-4 pt-4 border-t border-primary/10">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-muted-foreground">Shot vs Profile Target</span>
                              {analysisResult.profile_target_curves && analysisResult.profile_target_curves.length > 0 && (
                                <Badge variant="outline" className="text-xs bg-primary/10 border-primary/20">
                                  Target overlay active
                                </Badge>
                              )}
                            </div>
                            <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                {(() => {
                                  const chartData = getChartData(shotData)
                                  const stageRanges = getStageRanges(chartData)
                                  const hasTargetCurves = analysisResult.profile_target_curves && analysisResult.profile_target_curves.length > 0
                                  
                                  // Get data max time for X axis
                                  const dataMaxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : 0
                                  
                                  // Calculate max values for Y axis
                                  const maxPressure = Math.max(
                                    ...chartData.map(d => d.pressure || 0),
                                    ...(analysisResult.profile_target_curves?.map(d => d.target_pressure || 0) || []),
                                    10
                                  )
                                  const maxFlow = Math.max(
                                    ...chartData.map(d => d.flow || 0),
                                    ...(analysisResult.profile_target_curves?.map(d => d.target_flow || 0) || []),
                                    5
                                  )
                                  const maxLeftAxis = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
                                  
                                  return (
                                    <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                      
                                      {/* Stage background areas */}
                                      {stageRanges.map((stage, idx) => (
                                        <ReferenceArea
                                          key={idx}
                                          yAxisId="left"
                                          x1={stage.startTime}
                                          x2={stage.endTime}
                                          fill={STAGE_COLORS[stage.colorIndex]}
                                          fillOpacity={1}
                                          stroke={STAGE_BORDER_COLORS[stage.colorIndex]}
                                          strokeWidth={0}
                                          ifOverflow="extendDomain"
                                        />
                                      ))}
                                      
                                      <XAxis 
                                        dataKey="time" 
                                        tick={{ fontSize: 10, fill: '#888' }} 
                                        tickFormatter={(v) => `${Math.round(v)}s`}
                                        axisLine={{ stroke: '#444' }}
                                        type="number"
                                        domain={[0, dataMaxTime]}
                                      />
                                      <YAxis 
                                        yAxisId="left"
                                        domain={[0, maxLeftAxis]}
                                        tick={{ fontSize: 10, fill: '#888' }} 
                                        axisLine={{ stroke: '#444' }}
                                        tickFormatter={(v) => `${v}`}
                                        width={25}
                                      />
                                      <YAxis 
                                        yAxisId="right"
                                        orientation="right"
                                        domain={[0, Math.ceil(maxFlow * 1.1)]}
                                        tick={{ fontSize: 10, fill: '#888' }} 
                                        axisLine={{ stroke: '#444' }}
                                        width={0}
                                        hide
                                      />
                                      <Tooltip 
                                        contentStyle={{ 
                                          backgroundColor: 'rgba(0,0,0,0.85)', 
                                          border: '1px solid #333',
                                          borderRadius: '8px',
                                          fontSize: '11px'
                                        }}
                                        formatter={(value: number, name: string) => [
                                          `${value?.toFixed(1) || '-'}`,
                                          name
                                        ]}
                                        labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
                                      />
                                      {/* Actual shot data */}
                                      <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="pressure"
                                        stroke={CHART_COLORS.pressure}
                                        strokeWidth={2}
                                        dot={false}
                                        name="Pressure (bar)"
                                        isAnimationActive={false}
                                      />
                                      <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="flow"
                                        stroke={CHART_COLORS.flow}
                                        strokeWidth={2}
                                        dot={false}
                                        name="Flow (ml/s)"
                                        isAnimationActive={false}
                                      />
                                      {/* Profile target curves using Customized SVG */}
                                      {hasTargetCurves && analysisResult.profile_target_curves && (
                                        <Customized
                                          component={({ xAxisMap, yAxisMap }: { xAxisMap?: Record<string, { scale: (v: number) => number }>; yAxisMap?: Record<string, { scale: (v: number) => number }> }) => {
                                            if (!xAxisMap || !yAxisMap) return null
                                            const xAxis = Object.values(xAxisMap)[0]
                                            const yAxis = yAxisMap['left']
                                            if (!xAxis?.scale || !yAxis?.scale) return null
                                            
                                            const curves = analysisResult.profile_target_curves!
                                            
                                            const pressurePoints = curves
                                              .filter(p => p.target_pressure !== undefined)
                                              .sort((a, b) => a.time - b.time)
                                            const flowPoints = curves
                                              .filter(p => p.target_flow !== undefined)
                                              .sort((a, b) => a.time - b.time)
                                            
                                            let pressurePath = ''
                                            if (pressurePoints.length >= 2) {
                                              pressurePath = pressurePoints.map((p, i) => {
                                                const x = xAxis.scale(p.time)
                                                const y = yAxis.scale(p.target_pressure!)
                                                return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                                              }).join(' ')
                                            }
                                            
                                            let flowPath = ''
                                            if (flowPoints.length >= 2) {
                                              flowPath = flowPoints.map((p, i) => {
                                                const x = xAxis.scale(p.time)
                                                const y = yAxis.scale(p.target_flow!)
                                                return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                                              }).join(' ')
                                            }
                                            
                                            return (
                                              <g className="target-curves">
                                                {pressurePath && (
                                                  <>
                                                    <path d={pressurePath} fill="none" stroke={CHART_COLORS.targetPressure} strokeWidth={2.5} strokeDasharray="8 4" strokeLinecap="round" />
                                                    {pressurePoints.map((p, i) => (
                                                      <circle key={`tp-${i}`} cx={xAxis.scale(p.time)} cy={yAxis.scale(p.target_pressure!)} r={4} fill={CHART_COLORS.targetPressure} />
                                                    ))}
                                                  </>
                                                )}
                                                {flowPath && (
                                                  <>
                                                    <path d={flowPath} fill="none" stroke={CHART_COLORS.targetFlow} strokeWidth={2.5} strokeDasharray="8 4" strokeLinecap="round" />
                                                    {flowPoints.map((p, i) => (
                                                      <circle key={`tf-${i}`} cx={xAxis.scale(p.time)} cy={yAxis.scale(p.target_flow!)} r={4} fill={CHART_COLORS.targetFlow} />
                                                    ))}
                                                  </>
                                                )}
                                              </g>
                                            )
                                          }}
                                        />
                                      )}
                                    </LineChart>
                                  )
                                })()}
                              </ResponsiveContainer>
                            </div>
                            {/* Legend */}
                            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.pressure }} />
                                <span>Pressure</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.flow }} />
                                <span>Flow</span>
                              </div>
                              {analysisResult.profile_target_curves && analysisResult.profile_target_curves.length > 0 && (
                                <>
                                  <div className="flex items-center gap-1">
                                    <div className="w-3 h-0.5 rounded border-dashed" style={{ backgroundColor: CHART_COLORS.targetPressure, borderStyle: 'dashed' }} />
                                    <span>Target Pressure</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.targetFlow, borderStyle: 'dashed' }} />
                                    <span>Target Flow</span>
                                  </div>
                                </>
                              )}
                            </div>
                            {/* Stage Legend */}
                            {shotData && (() => {
                              const chartData = getChartData(shotData)
                              const stageRanges = getStageRanges(chartData)
                              if (stageRanges.length === 0) return null
                              
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {stageRanges.map((stage, idx) => (
                                    <Badge 
                                      key={idx}
                                      variant="outline" 
                                      className="text-[10px] px-1.5 py-0.5 font-medium"
                                      style={{
                                        backgroundColor: STAGE_COLORS[stage.colorIndex],
                                        borderColor: STAGE_BORDER_COLORS[stage.colorIndex],
                                        color: isDark ? STAGE_TEXT_COLORS_DARK[stage.colorIndex] : STAGE_TEXT_COLORS_LIGHT[stage.colorIndex]
                                      }}
                                    >
                                      {typeof stage.name === 'string' ? stage.name : String(stage.name || '')}
                                    </Badge>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                      
                      {/* Unreached Stages Warning */}
                      {analysisResult.unreached_stages.length > 0 && (
                        <Alert variant="destructive" className="border-red-500/30 bg-red-500/10 rounded-xl">
                          <Warning size={18} weight="fill" />
                          <AlertDescription className="text-sm">
                            <span className="font-semibold">Stages never reached:</span>{' '}
                            {analysisResult.unreached_stages.join(', ')}
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      {/* Pre-infusion Summary */}
                      {analysisResult.preinfusion_summary.stages.length > 0 && (
                        <div className={`p-4 rounded-xl border ${
                          analysisResult.preinfusion_summary.issues?.length > 0
                            ? 'bg-amber-500/10 border-amber-500/30'
                            : 'bg-secondary/40 border-border/20'
                        }`}>
                          <div className="flex items-center gap-2 mb-2">
                            <Drop size={16} weight="bold" className="text-cyan-400" />
                            <span className="text-sm font-semibold">Pre-infusion</span>
                            {analysisResult.preinfusion_summary.weight_percent_of_total > 10 && (
                              <Badge variant="outline" className="ml-auto text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">
                                {analysisResult.preinfusion_summary.weight_percent_of_total.toFixed(1)}% of shot volume
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground/60">Duration: </span>
                              <span className="font-medium">{analysisResult.preinfusion_summary.total_time}s</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground/60">Time %: </span>
                              <span className="font-medium">{analysisResult.preinfusion_summary.proportion_of_shot}%</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground/60">Weight: </span>
                              <span className={`font-medium ${
                                analysisResult.preinfusion_summary.weight_percent_of_total > 10 
                                  ? 'text-amber-400' 
                                  : ''
                              }`}>
                                {analysisResult.preinfusion_summary.weight_accumulated?.toFixed(1) || 0}g
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground/60 mt-2">
                            Stages: {analysisResult.preinfusion_summary.stages.join(', ')}
                          </p>
                          
                          {/* Pre-infusion Issues */}
                          {analysisResult.preinfusion_summary.issues?.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {analysisResult.preinfusion_summary.issues.map((issue, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-sm">
                                  <Warning size={14} weight="bold" className={
                                    issue.severity === 'concern' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'
                                  } />
                                  <div>
                                    <p className={issue.severity === 'concern' ? 'text-red-400' : 'text-amber-400'}>
                                      {issue.message}
                                    </p>
                                    <p className="text-xs text-muted-foreground/60">{issue.detail}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {/* Pre-infusion Recommendations */}
                          {analysisResult.preinfusion_summary.recommendations?.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border/20">
                              <p className="text-xs text-muted-foreground/60 mb-1">Recommendations:</p>
                              <ul className="space-y-1">
                                {analysisResult.preinfusion_summary.recommendations.map((rec, idx) => (
                                  <li key={idx} className="text-xs text-primary/80 flex items-start gap-1.5">
                                    <span className="text-primary mt-0.5">→</span>
                                    {rec}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Extraction Summary */}
                      {(() => {
                        // Get extraction stages (stages not in pre-infusion)
                        const preinfusionStageNames = new Set(
                          analysisResult.preinfusion_summary.stages.map(s => s.toLowerCase())
                        )
                        const extractionStages = analysisResult.stage_analyses.filter(
                          s => s.executed && !preinfusionStageNames.has(s.stage_name.toLowerCase())
                        )
                        
                        if (extractionStages.length === 0) return null
                        
                        // Calculate extraction metrics
                        const extractionTime = extractionStages.reduce(
                          (sum, s) => sum + (s.execution_data?.duration || 0), 0
                        )
                        const totalTime = analysisResult.shot_summary.total_time
                        const extractionPercent = totalTime > 0 ? Math.round((extractionTime / totalTime) * 100) : 0
                        
                        // Calculate extraction weight (total - preinfusion weight)
                        const totalWeight = analysisResult.shot_summary.final_weight
                        const preinfusionWeight = analysisResult.preinfusion_summary.weight_accumulated || 0
                        const extractionWeight = totalWeight - preinfusionWeight
                        
                        // Check for any limit hits or failed assessments in extraction
                        const hasIssues = extractionStages.some(
                          s => s.limit_hit || s.assessment?.status === 'hit_limit' || s.assessment?.status === 'failed'
                        )
                        
                        // Get reached goals
                        const reachedGoals = extractionStages.filter(
                          s => s.assessment?.status === 'reached_goal'
                        )
                        
                        return (
                          <div className={`p-4 rounded-xl border ${
                            hasIssues
                              ? 'bg-amber-500/10 border-amber-500/30'
                              : 'bg-secondary/40 border-border/20'
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              <Gauge size={16} weight="bold" className="text-green-400" />
                              <span className="text-sm font-semibold">Extraction</span>
                              {reachedGoals.length > 0 && (
                                <Badge variant="outline" className="ml-auto text-xs bg-green-500/20 text-green-400 border-green-500/30">
                                  {reachedGoals.length} goal{reachedGoals.length !== 1 ? 's' : ''} reached
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground/60">Duration: </span>
                                <span className="font-medium">{extractionTime.toFixed(1)}s</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/60">Time %: </span>
                                <span className="font-medium">{extractionPercent}%</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/60">Weight: </span>
                                <span className="font-medium">{extractionWeight.toFixed(1)}g</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground/60 mt-2">
                              Stages: {extractionStages.map(s => s.stage_name).join(', ')}
                            </p>
                            
                            {/* Extraction stage summaries */}
                            {extractionStages.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-border/20 space-y-2">
                                {extractionStages.map((stage, idx) => (
                                  <div key={idx} className="flex items-start gap-2 text-sm">
                                    <span className={`mt-0.5 ${
                                      stage.assessment?.status === 'reached_goal' ? 'text-green-400' :
                                      stage.assessment?.status === 'hit_limit' || stage.limit_hit ? 'text-amber-400' :
                                      'text-muted-foreground'
                                    }`}>
                                      {stage.assessment?.status === 'reached_goal' ? '✓' :
                                       stage.assessment?.status === 'hit_limit' || stage.limit_hit ? '⚠' : '•'}
                                    </span>
                                    <div className="flex-1">
                                      <span className="font-medium">{stage.stage_name}</span>
                                      <span className="text-muted-foreground/60 ml-2">
                                        {stage.execution_data?.duration?.toFixed(1)}s
                                      </span>
                                      {stage.assessment?.message && (
                                        <p className="text-xs text-muted-foreground/60">{stage.assessment.message}</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      
                      {/* Stage-by-Stage Analysis */}
                      <div className="p-4 bg-secondary/40 rounded-xl border border-border/20">
                        <div className="flex items-center gap-2 mb-4">
                          <ChartLine size={16} weight="bold" className="text-primary" />
                          <span className="text-sm font-semibold">Stage Analysis</span>
                          <Badge variant="secondary" className="text-xs ml-auto">
                            {analysisResult.stage_analyses.filter(s => s.executed).length}/{analysisResult.stage_analyses.length} executed
                          </Badge>
                        </div>
                        <div className="space-y-4">
                          {analysisResult.stage_analyses.map((stage, idx) => (
                            <div 
                              key={idx} 
                              className={`p-4 rounded-lg border ${
                                !stage.executed 
                                  ? 'bg-red-500/5 border-red-500/20' 
                                  : stage.assessment?.status === 'reached_goal' 
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : stage.assessment?.status === 'hit_limit'
                                      ? 'bg-amber-500/5 border-amber-500/20'
                                      : stage.assessment?.status === 'failed'
                                        ? 'bg-red-500/5 border-red-500/20'
                                        : stage.assessment?.status === 'incomplete'
                                          ? 'bg-orange-500/5 border-orange-500/20'
                                          : 'bg-background/30 border-border/20'
                              }`}
                            >
                              {/* Stage Header */}
                              <div className="flex flex-col gap-2 mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`w-3 h-3 rounded-full shrink-0 ${
                                    !stage.executed ? 'bg-red-500' :
                                    stage.assessment?.status === 'reached_goal' ? 'bg-green-500' :
                                    stage.assessment?.status === 'hit_limit' ? 'bg-amber-500' :
                                    stage.assessment?.status === 'failed' ? 'bg-red-500' :
                                    stage.assessment?.status === 'incomplete' ? 'bg-orange-500' : 'bg-blue-500'
                                  }`} />
                                  <span className="text-sm font-semibold break-words">{stage.stage_name}</span>
                                  <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
                                    {stage.stage_type}
                                  </Badge>
                                </div>
                                {stage.assessment && (
                                  <Badge 
                                    variant="secondary" 
                                    className={`text-[10px] w-fit shrink-0 ${
                                      stage.assessment.status === 'reached_goal' ? 'bg-green-500/20 text-green-700 dark:text-green-300' :
                                      stage.assessment.status === 'hit_limit' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' :
                                      stage.assessment.status === 'not_reached' ? 'bg-red-500/20 text-red-700 dark:text-red-300' :
                                      stage.assessment.status === 'failed' ? 'bg-red-500/20 text-red-700 dark:text-red-300' :
                                      stage.assessment.status === 'incomplete' ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300' :
                                      'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                    }`}
                                  >
                                    {stage.assessment.status === 'reached_goal' ? '✓ Reached Goal' :
                                     stage.assessment.status === 'hit_limit' ? '⚠ Hit Limit' :
                                     stage.assessment.status === 'not_reached' ? '✗ Not Reached' :
                                     stage.assessment.status === 'failed' ? '✗ Failed' :
                                     stage.assessment.status === 'incomplete' ? '◐ Incomplete' :
                                     stage.assessment.status}
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Profile Target */}
                              <div className="mb-3 p-2 bg-background/40 rounded-md">
                                <span className="text-xs text-muted-foreground block mb-1">Profile Target:</span>
                                <span className="text-sm font-medium">{stage.profile_target}</span>
                              </div>
                              
                              {/* Exit Triggers */}
                              {stage.exit_triggers.length > 0 && (
                                <div className="mb-3">
                                  <span className="text-xs text-muted-foreground block mb-1.5">Exit Triggers:</span>
                                  <div className="flex flex-wrap gap-2">
                                    {stage.exit_triggers.map((trigger, tIdx) => {
                                      const wasTriggered = stage.exit_trigger_result?.triggered?.type === trigger.type
                                      const notTriggeredData = stage.exit_trigger_result?.not_triggered?.find(nt => nt.type === trigger.type)
                                      
                                      return (
                                        <div 
                                          key={tIdx}
                                          className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                                            wasTriggered 
                                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                              : 'bg-secondary/60 text-muted-foreground border border-border/30'
                                          }`}
                                        >
                                          <span className="font-medium">{trigger.description}</span>
                                          {wasTriggered && stage.exit_trigger_result?.triggered && (
                                            <span className="ml-1 opacity-70">
                                              (actual: {stage.exit_trigger_result.triggered.actual})
                                            </span>
                                          )}
                                          {notTriggeredData && !wasTriggered && (
                                            <span className="ml-1 opacity-70">
                                              (actual: {notTriggeredData.actual})
                                            </span>
                                          )}
                                          {wasTriggered && <span className="ml-1">✓</span>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {/* Limits */}
                              {stage.limits.length > 0 && (
                                <div className="mb-3">
                                  <span className="text-xs text-muted-foreground block mb-1.5">Limits:</span>
                                  <div className="flex flex-wrap gap-2">
                                    {stage.limits.map((limit, lIdx) => (
                                      <div 
                                        key={lIdx}
                                        className={`px-2 py-1 rounded text-xs ${
                                          stage.limit_hit?.type === limit.type
                                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                            : 'bg-secondary/60 text-muted-foreground border border-border/30'
                                        }`}
                                      >
                                        {limit.description}
                                        {stage.limit_hit?.type === limit.type && (
                                          <>
                                            <span className="ml-1 opacity-70">
                                              (hit: {stage.limit_hit.actual_value})
                                            </span>
                                            <span className="ml-1">⚠</span>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* Execution Data */}
                              {stage.execution_data && (
                                <div className="grid grid-cols-4 gap-2 p-2 bg-background/40 rounded-md text-center">
                                  <div>
                                    <span className="text-xs text-muted-foreground block">Duration</span>
                                    <span className="text-sm font-medium">{stage.execution_data.duration}s</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">Weight</span>
                                    <span className="text-sm font-medium">+{stage.execution_data.weight_gain}g</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">Pressure</span>
                                    <span className="text-sm font-medium">{stage.execution_data.avg_pressure} bar</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">Flow</span>
                                    <span className="text-sm font-medium">{stage.execution_data.avg_flow} ml/s</span>
                                  </div>
                                </div>
                              )}
                              
                              {/* Assessment Message */}
                              {stage.assessment && (
                                <p className="text-xs text-muted-foreground/70 mt-2 italic">
                                  {stage.assessment.message}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      </div>{/* End of analysisCardRef */}
                      
                      {/* Action buttons - stacked vertically for mobile */}
                      <div className="flex flex-col gap-2 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleExportAnalysis}
                          disabled={isExportingAnalysis}
                          className="gap-1.5 w-full"
                        >
                          <DownloadSimple size={14} weight="bold" />
                          {isExportingAnalysis ? 'Exporting...' : 'Export as Image'}
                        </Button>
                        
                        {/* Show "View" if cached, otherwise "Get" */}
                        {(llmAnalysisResult || isLlmCached) && !isLlmAnalyzing ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleViewLlmAnalysis}
                            className="gap-1.5 w-full ai-shimmer-button border-0"
                          >
                            <Brain size={14} weight="fill" />
                            View Expert Analysis (AI)
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleLlmAnalysis}
                            disabled={isLlmAnalyzing}
                            className="gap-1.5 w-full ai-shimmer-button border-0"
                          >
                            <Brain size={14} weight="fill" />
                            Get Expert Analysis (AI)
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  
                  </motion.div>
                </TabsContent>
              </Tabs>
              </div>{/* end right column */}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No data available for this shot
            </p>
          )}
        </Card>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
              <ChartLine size={22} className="text-primary" weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">Shot History</h2>
                <Badge variant="secondary" className="shrink-0">
                  {shots.length} shots
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground/70 break-words line-clamp-2">
                {profileName}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
            <Warning size={18} weight="fill" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* Background refresh indicator */}
        {isBackgroundRefreshing && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ArrowsCounterClockwise size={12} className="animate-spin" weight="bold" />
                Checking for new shots...
              </span>
            </div>
            <Progress value={undefined} className="h-1" />
          </motion.div>
        )}

        {isLoading ? (
          <SearchingLoader estimatedSeconds={60} />
        ) : shots.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
              <ChartLine size={40} className="text-muted-foreground/40" weight="duotone" />
            </div>
            <p className="text-foreground/80 font-medium">No shots found</p>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              No shots have been pulled with this profile yet
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
            <AnimatePresence>
              {shots.map((shot, index) => (
                <motion.div
                  key={`${shot.date}-${shot.filename}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  onClick={() => handleSelectShot(shot)}
                  className="group cursor-pointer"
                >
                  <div className="p-4 bg-secondary/40 hover:bg-secondary/70 rounded-xl border border-border/20 hover:border-border/40 transition-all duration-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                          {formatShotTime(shot)}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5">
                          {typeof shot.total_time === 'number' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock size={12} weight="bold" />
                              {shot.total_time.toFixed(1)}s
                            </span>
                          )}
                          {typeof shot.final_weight === 'number' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Drop size={12} weight="fill" />
                              {shot.final_weight.toFixed(1)}g
                            </span>
                          )}
                        </div>
                      </div>
                      <ChartLine 
                        size={20} 
                        weight="bold" 
                        className="text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" 
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        
        {/* Last Updated & Refresh */}
        {!isLoading && (
          <div className="pt-3 border-t border-border/20 space-y-2">
            {lastFetched && (
              <p className="text-xs text-muted-foreground/60 text-center">
                Last updated: {formatDistanceToNow(lastFetched, { addSuffix: true })}
              </p>
            )}
            <Button
              variant="ghost"
              onClick={handleRefresh}
              disabled={isBackgroundRefreshing}
              className="w-full h-9 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowsCounterClockwise size={16} weight="bold" className={`mr-2 ${isBackgroundRefreshing ? 'animate-spin' : ''}`} />
              {isBackgroundRefreshing ? 'Refreshing...' : 'Check for New Shots'}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
