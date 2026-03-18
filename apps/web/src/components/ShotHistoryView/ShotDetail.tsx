import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
  Brain,
} from '@phosphor-icons/react'
import { domToPng } from 'modern-screenshot'
import { ExpertAnalysisView } from '@/components/ExpertAnalysisView'
import { ShotAnnotation } from '@/components/ShotAnnotation'
import { ReplayChart, CompareChart, AnalyzeChart } from '@/components/ShotCharts'
import { getServerUrl } from '@/lib/config'

import type { ShotInfo, ShotData, LocalAnalysisResult } from './types'
import { SPEED_OPTIONS } from './types'
import {
  getChartData,
  getStageRanges,
  mergeWithTargetCurves,
  getComparisonChartData,
  getCombinedChartData,
  getComparisonStats,
  formatShotTime,
} from './shotDataTransforms'
import { useReplayAnimation } from './useReplayAnimation'

// ---------------------------------------------------------------------------
// Comparison StatCard — extracted from inline IIFE for clarity
// ---------------------------------------------------------------------------
function StatCard({ label, icon: Icon, a, b, unit, diffPercent, higherIsBetter = true }: {
  label: string
  icon: React.ElementType
  a: number
  b: number
  unit: string
  diffPercent: number
  higherIsBetter?: boolean
}) {
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
          variant={isEqual ? 'secondary' : isBetter ? 'default' : 'destructive'}
          className="text-[10px] px-1.5 py-0 h-5 w-fit"
        >
          {isEqual ? <Equals size={9} weight="bold" /> : isPositive ? <ArrowUp size={9} weight="bold" /> : <ArrowDown size={9} weight="bold" />}
          {Math.abs(diffPercent).toFixed(0)}%
        </Badge>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ShotDetailProps {
  selectedShot: ShotInfo
  shotData: ShotData | null
  loadingData: boolean
  dataError: string | null
  profileName: string
  aiConfigured: boolean
  hideAiWhenUnavailable: boolean
  isDark: boolean
  shots: ShotInfo[]
  fetchShotData: (date: string, filename: string) => Promise<ShotData>
  onBack: () => void
  annotationSummaries: Record<string, { has_annotation: boolean; rating: number | null }>
  setAnnotationSummaries: React.Dispatch<React.SetStateAction<Record<string, { has_annotation: boolean; rating: number | null }>>>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ShotDetail({
  selectedShot,
  shotData,
  loadingData,
  dataError,
  profileName,
  aiConfigured,
  hideAiWhenUnavailable,
  isDark,
  shots,
  fetchShotData,
  onBack,
  setAnnotationSummaries,
}: ShotDetailProps) {
  const { t } = useTranslation()

  // ---- Tab state ----------------------------------------------------------
  const [activeAction, setActiveAction] = useState<'replay' | 'compare' | 'analyze'>('replay')

  // ---- Comparison state ---------------------------------------------------
  const [comparisonShot, setComparisonShot] = useState<ShotInfo | null>(null)
  const [comparisonShotData, setComparisonShotData] = useState<ShotData | null>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  // ---- Analysis state -----------------------------------------------------
  const [analysisResult, setAnalysisResult] = useState<LocalAnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [isExportingAnalysis, setIsExportingAnalysis] = useState(false)
  const analysisCardRef = useRef<HTMLDivElement>(null)

  // ---- LLM Analysis state -------------------------------------------------
  const [llmAnalysisResult, setLlmAnalysisResult] = useState<string | null>(null)
  const [isLlmAnalyzing, setIsLlmAnalyzing] = useState(false)
  const [llmAnalysisError, setLlmAnalysisError] = useState<string | null>(null)
  const [showLlmView, setShowLlmView] = useState(false)
  const [isLlmCached, setIsLlmCached] = useState(false)

  // ---- Replay hooks -------------------------------------------------------
  const mainMaxTime = useMemo(() => {
    if (!shotData) return 0
    const data = getChartData(shotData)
    return data.length > 0 ? data[data.length - 1].time : 0
  }, [shotData])

  const comparisonMaxTime = useMemo(() => {
    if (!shotData || !comparisonShotData) return 0
    const dataA = getComparisonChartData(shotData)
    const dataB = getComparisonChartData(comparisonShotData)
    const maxA = dataA.length > 0 ? dataA[dataA.length - 1].time : 0
    const maxB = dataB.length > 0 ? dataB[dataB.length - 1].time : 0
    return Math.max(maxA, maxB)
  }, [shotData, comparisonShotData])

  const mainReplay = useReplayAnimation({ maxTime: mainMaxTime })
  const compReplay = useReplayAnimation({ maxTime: comparisonMaxTime })

  // ---- Reset replay on shot change ----------------------------------------
  useEffect(() => {
    mainReplay.setIsPlaying(false)
    mainReplay.setCurrentTime(0)
  }, [selectedShot]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    compReplay.setIsPlaying(false)
    compReplay.setCurrentTime(0)
  }, [comparisonShot]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- LLM cache check on shot change -------------------------------------
  useEffect(() => {
    if (!selectedShot) {
      setLlmAnalysisResult(null)
      setIsLlmCached(false)
      return
    }
    const checkServerCache = async () => {
      try {
        const serverUrl = await getServerUrl()
        const params = new URLSearchParams({
          profile_name: profileName,
          shot_date: selectedShot.date,
          shot_filename: selectedShot.filename,
        })
        const response = await fetch(`${serverUrl}/api/shots/llm-analysis-cache?${params}`)
        if (response.ok) {
          const data = await response.json()
          if (data.cached && data.analysis) {
            setLlmAnalysisResult(data.analysis)
            setIsLlmCached(true)
            return
          }
        }
        setLlmAnalysisResult(null)
        setIsLlmCached(false)
      } catch {
        setLlmAnalysisResult(null)
        setIsLlmCached(false)
      }
    }
    checkServerCache()
  }, [selectedShot, profileName])

  // ---- Auto-analyze when shot data loads ----------------------------------
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
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) formData.append('profile_description', profileDesc)
      const response = await fetch(`${serverUrl}/api/shots/analyze`, { method: 'POST', body: formData })
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

  useEffect(() => {
    setAnalysisResult(null)
    setAnalysisError(null)
    setLlmAnalysisResult(null)
    setLlmAnalysisError(null)
    if (selectedShot && shotData) {
      handleAnalyze()
    }
    return undefined
  }, [selectedShot, shotData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Export analysis as image -------------------------------------------
  const handleExportAnalysis = async () => {
    if (!analysisCardRef.current || !analysisResult || !selectedShot) return
    try {
      setIsExportingAnalysis(true)
      const element = analysisCardRef.current
      const rect = element.getBoundingClientRect()
      const padding = 20
      await new Promise(resolve => setTimeout(resolve, 100))
      const dataUrl = await domToPng(element, {
        scale: 2,
        backgroundColor: '#09090b',
        width: rect.width + padding * 2,
        height: element.scrollHeight + padding * 2,
        style: {
          padding: `${padding}px`,
          boxSizing: 'content-box',
          transform: 'none',
          transformOrigin: 'top left',
        },
      })
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

  // ---- LLM analysis -------------------------------------------------------
  const handleLlmAnalysis = async () => {
    if (!selectedShot || !shotData) return
    setShowLlmView(true)
    setIsLlmAnalyzing(true)
    setLlmAnalysisError(null)
    try {
      const serverUrl = await getServerUrl()
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('shot_date', selectedShot.date)
      formData.append('shot_filename', selectedShot.filename)
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) formData.append('profile_description', profileDesc)
      const response = await fetch(`${serverUrl}/api/shots/analyze-llm`, { method: 'POST', body: formData })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LLM Analysis failed' }))
        throw new Error(errorData.detail?.message || errorData.detail?.error || errorData.message || 'LLM Analysis failed')
      }
      const result = await response.json()
      if (result.status === 'success') {
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

  const handleViewLlmAnalysis = async () => {
    if (!llmAnalysisResult && selectedShot && isLlmCached) {
      try {
        const serverUrl = await getServerUrl()
        const params = new URLSearchParams({
          profile_name: profileName,
          shot_date: selectedShot.date,
          shot_filename: selectedShot.filename,
        })
        const response = await fetch(`${serverUrl}/api/shots/llm-analysis-cache?${params}`)
        if (response.ok) {
          const data = await response.json()
          if (data.cached && data.analysis) {
            setLlmAnalysisResult(data.analysis)
          }
        }
      } catch {
        // Non-critical
      }
    }
    setShowLlmView(true)
  }

  const handleReAnalyze = async () => {
    if (!selectedShot || !shotData) return
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
      formData.append('force_refresh', 'true')
      const profileData = shotData.profile as { description?: string; notes?: string } | undefined
      const profileDesc = profileData?.description || profileData?.notes
      if (profileDesc) formData.append('profile_description', profileDesc)
      const response = await fetch(`${serverUrl}/api/shots/analyze-llm`, { method: 'POST', body: formData })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'LLM Analysis failed' }))
        throw new Error(errorData.detail?.message || errorData.detail?.error || errorData.message || 'LLM Analysis failed')
      }
      const result = await response.json()
      if (result.status === 'success') {
        setLlmAnalysisResult(result.llm_analysis)
        setIsLlmCached(false)
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

  const handleCloseLlmView = () => setShowLlmView(false)

  // ---- Comparison handlers ------------------------------------------------
  const selectableShots = useMemo(
    () => shots.filter(s => !(s.date === selectedShot.date && s.filename === selectedShot.filename)),
    [shots, selectedShot],
  )

  const handleSelectComparisonShot = async (shotKey: string) => {
    const [date, filename] = shotKey.split('|')
    const shot = shots.find(s => s.date === date && s.filename === filename)
    if (!shot) return
    setComparisonShot(shot)
    setLoadingComparison(true)
    setComparisonError(null)
    try {
      const data = await fetchShotData(date, filename)
      setComparisonShotData(data)
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : 'Failed to load comparison shot')
    } finally {
      setLoadingComparison(false)
    }
  }

  const handleClearComparison = () => {
    setComparisonShot(null)
    setComparisonShotData(null)
    setComparisonError(null)
  }

  // ---- Memoised chart data (shared between mobile and desktop) ------------
  const replayChartData = useMemo(() => {
    if (!shotData) return null
    const chartData = getChartData(shotData)
    const stageRanges = getStageRanges(chartData)
    const hasGravFlow = chartData.some(d => d.gravimetricFlow !== undefined && d.gravimetricFlow > 0)
    const dataMaxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : 0
    const mergedData = mergeWithTargetCurves(chartData, analysisResult?.profile_target_curves)
    const maxPressure = Math.max(
      ...chartData.map(d => d.pressure || 0),
      ...(analysisResult?.profile_target_curves?.map(d => d.target_pressure || 0) || []),
      12,
    )
    const maxFlow = Math.max(
      ...chartData.map(d => Math.max(d.flow || 0, d.gravimetricFlow || 0)),
      ...(analysisResult?.profile_target_curves?.map(d => d.target_flow || 0) || []),
      8,
    )
    const maxLeftAxis = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
    const maxWeight = Math.max(...chartData.map(d => d.weight || 0), 50)
    const maxRightAxis = Math.ceil(maxWeight * 1.1)
    return { chartData, stageRanges, hasGravFlow, dataMaxTime, mergedData, maxLeftAxis, maxRightAxis }
  }, [shotData, analysisResult?.profile_target_curves])

  const compareChartMemo = useMemo(() => {
    if (!shotData || !comparisonShotData) return null
    const combinedData = getCombinedChartData(shotData, comparisonShotData)
    const dataMaxTime = combinedData.length > 0 ? combinedData[combinedData.length - 1].time : 0
    const maxPressure = Math.max(...combinedData.map(d => Math.max(d.pressureA || 0, d.pressureB || 0)), 12)
    const maxFlow = Math.max(...combinedData.map(d => Math.max(d.flowA || 0, d.flowB || 0)), 8)
    const maxWeight = Math.max(...combinedData.map(d => Math.max(d.weightA || 0, d.weightB || 0)), 50)
    const leftDomain = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
    const rightDomain = Math.ceil(maxWeight * 1.1)
    return { combinedData, dataMaxTime, leftDomain, rightDomain }
  }, [shotData, comparisonShotData])

  const analyzeChartMemo = useMemo(() => {
    if (!shotData || !analysisResult) return null
    const chartData = getChartData(shotData)
    const stageRanges = getStageRanges(chartData)
    const hasTargetCurves = !!(analysisResult.profile_target_curves && analysisResult.profile_target_curves.length > 0)
    const dataMaxTime = chartData.length > 0 ? chartData[chartData.length - 1].time : 0
    const maxPressure = Math.max(
      ...chartData.map(d => d.pressure || 0),
      ...(analysisResult.profile_target_curves?.map(d => d.target_pressure || 0) || []),
      10,
    )
    const maxFlow = Math.max(
      ...chartData.map(d => d.flow || 0),
      ...(analysisResult.profile_target_curves?.map(d => d.target_flow || 0) || []),
      5,
    )
    const maxLeftAxis = Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
    return { chartData, stageRanges, hasTargetCurves, dataMaxTime, maxLeftAxis, maxFlow }
  }, [shotData, analysisResult])

  const comparisonStats = useMemo(() => {
    if (!comparisonShot || !shotData || !comparisonShotData) return null
    return getComparisonStats(selectedShot, comparisonShot, shotData, comparisonShotData)
  }, [selectedShot, comparisonShot, shotData, comparisonShotData])

  // ---- Annotation handler -------------------------------------------------
  const handleAnnotationChange = (hasAnnotation: boolean, rating: number | null) => {
    const key = `${selectedShot.date}/${selectedShot.filename}`
    setAnnotationSummaries(prev => ({
      ...prev,
      [key]: hasAnnotation || rating
        ? { has_annotation: hasAnnotation, rating }
        : undefined as never,
      ...(!hasAnnotation && !rating ? { [key]: undefined as never } : {}),
    }))
    if (!hasAnnotation && !rating) {
      setAnnotationSummaries(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  // Delegate to ExpertAnalysisView when active
  if (showLlmView) {
    return (
      <ExpertAnalysisView
        isLoading={isLlmAnalyzing}
        analysisResult={llmAnalysisResult}
        error={llmAnalysisError}
        onBack={handleCloseLlmView}
        onReAnalyze={handleReAnalyze}
        profileName={profileName}
        shotFilename={selectedShot?.filename}
        shotDate={selectedShot?.date}
        isCached={isLlmCached}
      />
    )
  }

  // --- Helper to build ReplayChart props from memo + live replay state -----
  const buildReplayChartProps = (variant: 'mobile' | 'desktop') => {
    if (!replayChartData) return null
    const { stageRanges, hasGravFlow, dataMaxTime, mergedData, maxLeftAxis, maxRightAxis } = replayChartData
    const isShowingReplay = mainReplay.currentTime > 0 && mainReplay.currentTime < dataMaxTime
    const displayData = isShowingReplay ? mergedData.filter(d => d.time <= mainReplay.currentTime) : mergedData
    const displayStageRanges = isShowingReplay
      ? stageRanges.filter(s => s.startTime <= mainReplay.currentTime).map(s => ({ ...s, endTime: Math.min(s.endTime, mainReplay.currentTime) }))
      : stageRanges
    return (
      <ReplayChart
        displayData={displayData}
        displayStageRanges={displayStageRanges}
        stageRanges={stageRanges}
        dataMaxTime={dataMaxTime}
        maxLeftAxis={maxLeftAxis}
        maxRightAxis={maxRightAxis}
        hasGravFlow={hasGravFlow}
        isShowingReplay={isShowingReplay}
        currentTime={mainReplay.currentTime}
        isPlaying={mainReplay.isPlaying}
        playbackSpeed={mainReplay.playbackSpeed}
        isDark={isDark}
        variant={variant}
      />
    )
  }

  // --- Helper to build CompareChart props ----------------------------------
  const buildCompareChartProps = (variant: 'mobile' | 'desktop') => {
    if (!compareChartMemo) return null
    const { combinedData, dataMaxTime, leftDomain, rightDomain } = compareChartMemo
    const isShowingReplay = compReplay.currentTime > 0 && compReplay.currentTime < dataMaxTime
    return (
      <CompareChart
        combinedData={combinedData}
        dataMaxTime={dataMaxTime}
        leftDomain={leftDomain}
        rightDomain={rightDomain}
        isShowingReplay={isShowingReplay}
        comparisonCurrentTime={compReplay.currentTime}
        comparisonIsPlaying={compReplay.isPlaying}
        comparisonPlaybackSpeed={compReplay.playbackSpeed}
        isDark={isDark}
        variant={variant}
      />
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {/* ---- Loading ---------------------------------------------------- */}
      {loadingData ? (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
              <CaretLeft size={22} weight="bold" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">{t('shotHistory.shotDetails')}</h2>
              <p className="text-xs text-muted-foreground/70">{formatShotTime(selectedShot)}</p>
            </div>
          </div>
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            </div>
          </div>
        </Card>

      /* ---- Error ------------------------------------------------------ */
      ) : dataError ? (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
              <CaretLeft size={22} weight="bold" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">{t('shotHistory.shotDetails')}</h2>
              <p className="text-xs text-muted-foreground/70">{formatShotTime(selectedShot)}</p>
            </div>
          </div>
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
            <Warning size={18} weight="fill" />
            <AlertDescription className="text-sm">{dataError}</AlertDescription>
          </Alert>
        </Card>

      /* ---- Data loaded ------------------------------------------------- */
      ) : shotData ? (
        <Tabs value={activeAction} onValueChange={(v) => setActiveAction(v as typeof activeAction)} className="w-full">
          {/* Desktop: two-column — left=card with tab content, right=graph */}
          <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
            {/* Left column */}
            <div className="order-1">
              <Card className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
                    <CaretLeft size={22} weight="bold" />
                  </Button>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-foreground truncate">{t('shotHistory.shotDetails')}</h2>
                    <p className="text-xs text-muted-foreground/70">{formatShotTime(selectedShot)}</p>
                  </div>
                </div>

                {/* Shot Summary Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {typeof selectedShot.total_time === 'number' && (
                    <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Clock size={14} weight="bold" />
                        <span className="text-xs font-medium">{t('shotHistory.duration')}</span>
                      </div>
                      <p className="text-lg font-bold">{selectedShot.total_time.toFixed(1)}s</p>
                    </div>
                  )}
                  {typeof selectedShot.final_weight === 'number' && (
                    <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Drop size={14} weight="fill" />
                        <span className="text-xs font-medium">{t('shotHistory.yield')}</span>
                      </div>
                      <p className="text-lg font-bold">{selectedShot.final_weight.toFixed(1)}g</p>
                    </div>
                  )}
                  {typeof shotData.profile?.temperature === 'number' && (
                    <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Thermometer size={14} weight="fill" />
                        <span className="text-xs font-medium">{t('shotHistory.temp')}</span>
                      </div>
                      <p className="text-lg font-bold">{shotData.profile.temperature}°C</p>
                    </div>
                  )}
                </div>

                {/* Tab Bar */}
                <TabsList className="grid w-full grid-cols-3 h-11 bg-secondary/60">
                  <TabsTrigger
                    value="replay"
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <Play size={14} weight={activeAction === 'replay' ? 'fill' : 'bold'} />
                    {t('shotHistory.replay')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="compare"
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <GitDiff size={14} weight={activeAction === 'compare' ? 'fill' : 'bold'} />
                    {t('shotHistory.compare')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="analyze"
                    className="gap-1.5 text-xs data-[state=active]:bg-amber-500 dark:data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-900 data-[state=active]:font-semibold"
                  >
                    <MagnifyingGlass size={14} weight={activeAction === 'analyze' ? 'fill' : 'bold'} />
                    {t('shotHistory.analyze')}
                  </TabsTrigger>
                </TabsList>

                {/* ====== REPLAY TAB ====== */}
                <TabsContent value="replay" className="mt-0">
                  <motion.div
                    key="replay-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="space-y-4"
                  >
                    {/* Mobile-only chart */}
                    <div className="lg:hidden">{buildReplayChartProps('mobile')}</div>

                    {/* Progress Bar */}
                    {mainMaxTime > 0 && (
                      <div className="space-y-2">
                        <div
                          className="h-2 bg-secondary/60 rounded-full overflow-hidden cursor-pointer relative group"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            const x = e.clientX - rect.left
                            const percent = x / rect.width
                            mainReplay.setCurrentTime(percent * mainMaxTime)
                          }}
                        >
                          <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={false}
                            animate={{ width: `${(mainReplay.currentTime / mainMaxTime) * 100}%` }}
                            transition={{ duration: 0.05 }}
                          />
                          <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                          <span>{mainReplay.currentTime.toFixed(1)}s</span>
                          <span>{mainMaxTime.toFixed(1)}s</span>
                        </div>
                      </div>
                    )}

                    {/* Playback Controls */}
                    <div className="flex items-center justify-center gap-3">
                      <Button variant="outline" size="icon" onClick={mainReplay.handleRestart} className="h-10 w-10 rounded-full" title={t('shotHistory.restart')}>
                        <ArrowCounterClockwise size={18} weight="bold" />
                      </Button>
                      <Button
                        variant={mainReplay.isPlaying ? 'secondary' : 'default'}
                        size="icon"
                        onClick={mainReplay.handlePlayPause}
                        className="h-10 w-10 rounded-full shadow-lg"
                        title={mainReplay.isPlaying ? t('shotHistory.pause') : t('shotHistory.play')}
                      >
                        {mainReplay.isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" className="ml-0.5" />}
                      </Button>
                      <Select value={mainReplay.playbackSpeed.toString()} onValueChange={(v) => mainReplay.setPlaybackSpeed(parseFloat(v))}>
                        <SelectTrigger className="w-24 h-10 rounded-full font-medium">
                          <Timer size={14} weight="bold" className="mr-1 shrink-0" />
                          <span className="font-mono">{mainReplay.playbackSpeed}x</span>
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

                {/* ====== COMPARE TAB ====== */}
                <TabsContent value="compare" className="mt-4">
                  <motion.div
                    key="compare-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="space-y-4"
                  >
                    {/* Shot Selector */}
                    <div className="p-3 bg-secondary/40 rounded-xl border border-border/20">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs font-medium text-muted-foreground">{t('shotComparison.compareWith')}</Label>
                        {comparisonShot && (
                          <button
                            onClick={handleClearComparison}
                            className="p-1 hover:bg-destructive/20 rounded-full transition-colors"
                            title={t('common.clear')}
                            aria-label={t('common.clear')}
                          >
                            <X size={14} weight="bold" className="text-muted-foreground" />
                          </button>
                        )}
                      </div>

                      {loadingComparison ? (
                        <div className="flex items-center gap-2 py-2">
                          <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                          <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
                        </div>
                      ) : comparisonShot ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">{t('shotComparison.shotB')}</Badge>
                          <span className="text-sm font-medium">{formatShotTime(comparisonShot)}</span>
                          <span className="text-xs text-muted-foreground">{comparisonShot.final_weight?.toFixed(1)}g</span>
                        </div>
                      ) : selectableShots.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 py-2">{t('shotComparison.noOtherShots')}</p>
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
                                <span className="text-xs text-muted-foreground">{shot.final_weight.toFixed(1)}g</span>
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
                    {comparisonStats && (
                      <div className="grid grid-cols-2 gap-2">
                        <StatCard label={t('shotHistory.duration')} icon={Clock} a={comparisonStats.duration.a} b={comparisonStats.duration.b} unit="s" diffPercent={comparisonStats.duration.diffPercent} higherIsBetter={false} />
                        <StatCard label={t('shotHistory.yield')} icon={Drop} a={comparisonStats.yield.a} b={comparisonStats.yield.b} unit="g" diffPercent={comparisonStats.yield.diffPercent} higherIsBetter={true} />
                        <StatCard label={t('shotHistory.maxPressure')} icon={Gauge} a={comparisonStats.maxPressure.a} b={comparisonStats.maxPressure.b} unit="bar" diffPercent={comparisonStats.maxPressure.diffPercent} higherIsBetter={false} />
                        <StatCard label={t('shotHistory.maxFlow')} icon={Waves} a={comparisonStats.maxFlow.a} b={comparisonStats.maxFlow.b} unit="ml/s" diffPercent={comparisonStats.maxFlow.diffPercent} higherIsBetter={false} />
                      </div>
                    )}

                    {/* Comparison Chart with Replay */}
                    {comparisonShotData && (
                      <div className="space-y-3">
                        <div className="lg:hidden">{buildCompareChartProps('mobile')}</div>

                        {/* Replay Controls */}
                        <div className="space-y-3 pt-2 border-t border-border/20">
                          {comparisonMaxTime > 0 && (
                            <div className="space-y-1.5">
                              <div
                                className="h-2 bg-secondary/60 rounded-full overflow-hidden cursor-pointer relative group"
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const x = e.clientX - rect.left
                                  const percent = x / rect.width
                                  compReplay.setCurrentTime(percent * comparisonMaxTime)
                                }}
                              >
                                <motion.div
                                  className="h-full bg-primary rounded-full"
                                  initial={false}
                                  animate={{ width: `${(compReplay.currentTime / comparisonMaxTime) * 100}%` }}
                                  transition={{ duration: 0.05 }}
                                />
                                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                                <span>{compReplay.currentTime.toFixed(1)}s</span>
                                <span>{comparisonMaxTime.toFixed(1)}s</span>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-center gap-2">
                            <Button variant="outline" size="icon" onClick={compReplay.handleRestart} className="h-8 w-8 rounded-full" title={t('shotHistory.restart')}>
                              <ArrowCounterClockwise size={14} weight="bold" />
                            </Button>
                            <Button
                              variant={compReplay.isPlaying ? 'secondary' : 'default'}
                              size="icon"
                              onClick={compReplay.handlePlayPause}
                              className="h-10 w-10 rounded-full shadow-lg"
                              title={compReplay.isPlaying ? t('shotHistory.pause') : t('shotHistory.play')}
                            >
                              {compReplay.isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" className="ml-0.5" />}
                            </Button>
                            <Select value={compReplay.playbackSpeed.toString()} onValueChange={(v) => compReplay.setPlaybackSpeed(parseFloat(v))}>
                              <SelectTrigger className="w-20 h-8 rounded-full text-xs font-medium">
                                <Timer size={12} weight="bold" className="mr-0.5 shrink-0" />
                                <span className="font-mono">{compReplay.playbackSpeed}x</span>
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
                        <p className="text-xs text-muted-foreground/50">{t('shotComparison.selectShot')}</p>
                      </div>
                    )}
                  </motion.div>
                </TabsContent>

                {/* ====== ANALYZE TAB ====== */}
                <TabsContent value="analyze" className="mt-4">
                  <motion.div
                    key="analyze-content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="space-y-4"
                  >
                    {/* Initial state */}
                    {!analysisResult && !isAnalyzing && !analysisError && (
                      <div className="text-center py-6 space-y-3">
                        <div className="p-4 rounded-2xl bg-secondary/40 inline-block">
                          <ChartLine size={32} className="text-muted-foreground/60" weight="duotone" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground/80">{t('shotHistory.shotAnalysis')}</p>
                          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[250px] mx-auto">{t('shotHistory.analysisDescription')}</p>
                        </div>
                        <Button variant="default" size="sm" className="mt-2" onClick={handleAnalyze}>
                          <ChartLine size={14} weight="bold" className="mr-1.5" />
                          {t('shotHistory.analyzeShot')}
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
                          <p className="text-sm font-medium text-foreground/80">{t('shotHistory.analyzingShot')}</p>
                          <p className="text-xs text-muted-foreground/60">{t('shotHistory.comparingStages')}</p>
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
                            {t('common.tryAgain')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Analysis Results */}
                    {analysisResult && (
                      <div className="space-y-4">
                        <div ref={analysisCardRef} className="space-y-4">
                          {/* Shot Summary Card */}
                          <div className="p-4 bg-gradient-to-br from-primary/10 via-secondary/30 to-secondary/20 rounded-xl border border-primary/20">
                            <div className="flex items-center gap-2 mb-3">
                              <ChartLine size={20} weight="fill" className="text-primary" />
                              <span className="text-base font-semibold">{t('shotHistory.shotSummary')}</span>
                              <span className="ml-auto text-xs text-muted-foreground">{profileName}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-xs text-muted-foreground">{t('shotHistory.weight')}</span>
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
                                      analysisResult.weight_analysis.status === 'under'
                                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                                        : 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                                    }`}
                                  >
                                    {analysisResult.weight_analysis.deviation_percent > 0 ? '+' : ''}{analysisResult.weight_analysis.deviation_percent}%
                                  </Badge>
                                )}
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">{t('shotHistory.duration')}</span>
                                <div className="text-xl font-bold">{analysisResult.shot_summary.total_time}s</div>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">{t('shotHistory.maxPressure')}</span>
                                <div className="text-lg font-semibold">{analysisResult.shot_summary.max_pressure} bar</div>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">{t('shotHistory.maxFlow')}</span>
                                <div className="text-lg font-semibold">{analysisResult.shot_summary.max_flow} ml/s</div>
                              </div>
                            </div>

                            {/* Analyze chart — mobile only */}
                            {analyzeChartMemo && (
                              <div className="mt-4 pt-4 border-t border-primary/10 lg:hidden">
                                <AnalyzeChart
                                  chartData={analyzeChartMemo.chartData}
                                  stageRanges={analyzeChartMemo.stageRanges}
                                  hasTargetCurves={analyzeChartMemo.hasTargetCurves}
                                  dataMaxTime={analyzeChartMemo.dataMaxTime}
                                  maxLeftAxis={analyzeChartMemo.maxLeftAxis}
                                  maxFlow={analyzeChartMemo.maxFlow}
                                  profileTargetCurves={analysisResult.profile_target_curves}
                                  isDark={isDark}
                                  variant="mobile"
                                />
                              </div>
                            )}
                          </div>

                          {/* Unreached Stages Warning */}
                          {analysisResult.unreached_stages.length > 0 && (
                            <Alert variant="destructive" className="border-red-500/30 bg-red-500/10 rounded-xl">
                              <Warning size={18} weight="fill" />
                              <AlertDescription className="text-sm">
                                <span className="font-semibold">{t('shotDetail.stagesNeverReached')}</span>{' '}
                                {analysisResult.unreached_stages.join(', ')}
                              </AlertDescription>
                            </Alert>
                          )}

                          {/* Pre-infusion Summary */}
                          {(analysisResult.preinfusion_summary?.stages ?? []).length > 0 && (
                            <div className={`p-4 rounded-xl border ${
                              analysisResult.preinfusion_summary.issues?.length > 0
                                ? 'bg-amber-500/10 border-amber-500/30'
                                : 'bg-secondary/40 border-border/20'
                            }`}>
                              <div className="flex items-center gap-2 mb-2">
                                <Drop size={16} weight="bold" className="text-cyan-700 dark:text-cyan-400" />
                                <span className="text-sm font-semibold">{t('shotHistory.preinfusion')}</span>
                                {(analysisResult.preinfusion_summary.weight_percent_of_total ?? 0) > 10 && (
                                  <Badge variant="outline" className="ml-auto text-xs bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                                    {(analysisResult.preinfusion_summary.weight_percent_of_total ?? 0).toFixed(1)}% of shot volume
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                <div>
                                  <span className="text-muted-foreground/60">{t('shotHistory.durationLabel')}</span>
                                  <span className="font-medium">{analysisResult.preinfusion_summary.total_time}s</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground/60">{t('shotHistory.timePercent')}</span>
                                  <span className="font-medium">{analysisResult.preinfusion_summary.proportion_of_shot}%</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground/60">{t('shotHistory.weightLabel')}</span>
                                  <span className={`font-medium ${
                                    analysisResult.preinfusion_summary.weight_percent_of_total > 10
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : ''
                                  }`}>
                                    {analysisResult.preinfusion_summary.weight_accumulated?.toFixed(1) || 0}g
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground/60 mt-2">
                                {t('shotHistory.stagesLabel')}{(analysisResult.preinfusion_summary.stages ?? []).join(', ')}
                              </p>

                              {/* Pre-infusion Issues */}
                              {analysisResult.preinfusion_summary.issues?.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  {analysisResult.preinfusion_summary.issues.map((issue, idx) => (
                                    <div key={idx} className="flex items-start gap-2 text-sm">
                                      <Warning size={14} weight="bold" className={
                                        issue.severity === 'concern' ? 'text-red-700 dark:text-red-400 mt-0.5' : 'text-amber-700 dark:text-amber-400 mt-0.5'
                                      } />
                                      <div>
                                        <p className={issue.severity === 'concern' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
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
                                  <p className="text-xs text-muted-foreground/60 mb-1">{t('shotHistory.recommendations')}</p>
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
                            const preinfusionStageNames = new Set(
                              (analysisResult.preinfusion_summary.stages ?? []).map(s => s.toLowerCase()),
                            )
                            const extractionStages = (analysisResult.stage_analyses ?? []).filter(
                              s => s.executed && !preinfusionStageNames.has(s.stage_name.toLowerCase()),
                            )
                            if (extractionStages.length === 0) return null
                            const extractionTime = extractionStages.reduce((sum, s) => sum + (s.execution_data?.duration || 0), 0)
                            const totalTime = analysisResult.shot_summary.total_time
                            const extractionPercent = totalTime > 0 ? Math.round((extractionTime / totalTime) * 100) : 0
                            const totalWeight = analysisResult.shot_summary?.final_weight ?? 0
                            const preinfusionWeight = analysisResult.preinfusion_summary?.weight_accumulated ?? 0
                            const extractionWeight = totalWeight - preinfusionWeight
                            const hasIssues = extractionStages.some(
                              s => s.limit_hit || s.assessment?.status === 'hit_limit' || s.assessment?.status === 'failed',
                            )
                            const reachedTargets = extractionStages.filter(s => s.assessment?.status === 'reached_goal')

                            return (
                              <div className={`p-4 rounded-xl border ${
                                hasIssues ? 'bg-amber-500/10 border-amber-500/30' : 'bg-secondary/40 border-border/20'
                              }`}>
                                <div className="flex items-center gap-2 mb-2">
                                  <Gauge size={16} weight="bold" className="text-green-700 dark:text-green-400" />
                                  <span className="text-sm font-semibold">{t('shotHistory.extraction')}</span>
                                  {reachedTargets.length > 0 && (
                                    <Badge variant="outline" className="ml-auto text-xs bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">
                                      {t('shotHistory.targetsReached', { reached: reachedTargets.length, total: extractionStages.length })}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground/60">{t('shotHistory.durationLabel')}</span>
                                    <span className="font-medium">{extractionTime.toFixed(1)}s</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground/60">{t('shotHistory.timePercent')}</span>
                                    <span className="font-medium">{extractionPercent}%</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground/60">{t('shotHistory.weightLabel')}</span>
                                    <span className="font-medium">{extractionWeight.toFixed(1)}g</span>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground/60 mt-2">
                                  {t('shotHistory.stagesLabel')}{extractionStages.map(s => s.stage_name).join(', ')}
                                </p>

                                {extractionStages.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-border/20 space-y-2">
                                    {extractionStages.map((stage, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-sm">
                                        <span className={`mt-0.5 ${
                                          stage.assessment?.status === 'reached_goal' ? 'text-green-700 dark:text-green-400' :
                                          stage.assessment?.status === 'hit_limit' || stage.limit_hit ? 'text-amber-700 dark:text-amber-400' :
                                          'text-muted-foreground'
                                        }`}>
                                          {stage.assessment?.status === 'reached_goal' ? '✓' :
                                           stage.assessment?.status === 'hit_limit' || stage.limit_hit ? '⚠' : '•'}
                                        </span>
                                        <div className="flex-1">
                                          <span className="font-medium">{stage.stage_name}</span>
                                          <span className="text-muted-foreground/60 ml-2">{stage.execution_data?.duration?.toFixed(1)}s</span>
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
                              <span className="text-sm font-semibold">{t('shotHistory.stageAnalysis')}</span>
                              <Badge variant="secondary" className="text-xs ml-auto">
                                {(analysisResult.stage_analyses ?? []).filter(s => s.executed).length}/{(analysisResult.stage_analyses ?? []).length} executed
                              </Badge>
                            </div>
                            <div className="space-y-4">
                              {(analysisResult.stage_analyses ?? []).map((stage, idx) => (
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
                                      <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{stage.stage_type}</Badge>
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
                                        {stage.assessment.status === 'reached_goal' ? t('shotHistory.targetReached') :
                                         stage.assessment.status === 'hit_limit' ? t('shotHistory.hitLimit') :
                                         stage.assessment.status === 'not_reached' ? t('shotHistory.notReached') :
                                         stage.assessment.status === 'failed' ? t('shotHistory.stageFailed') :
                                         stage.assessment.status === 'incomplete' ? t('shotHistory.incomplete') :
                                         stage.assessment.status}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Profile Target */}
                                  <div className="mb-3 p-2 bg-background/40 rounded-md">
                                    <span className="text-xs text-muted-foreground block mb-1">{t('shotHistory.profileTarget')}:</span>
                                    <span className="text-sm font-medium">{stage.profile_target}</span>
                                  </div>

                                  {/* Exit Triggers */}
                                  {stage.exit_triggers.length > 0 && (
                                    <div className="mb-3">
                                      <span className="text-xs text-muted-foreground block mb-1.5">{t('shotHistory.exitTriggers')}</span>
                                      <div className="flex flex-wrap gap-2 overflow-hidden">
                                        {stage.exit_triggers.map((trigger, tIdx) => {
                                          const wasTriggered = stage.exit_trigger_result?.triggered?.type === trigger.type
                                          const notTriggeredData = stage.exit_trigger_result?.not_triggered?.find(nt => nt.type === trigger.type)
                                          return (
                                            <div
                                              key={tIdx}
                                              className={`px-2 py-1 rounded text-xs max-w-full break-words ${
                                                wasTriggered
                                                  ? 'bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/30'
                                                  : 'bg-secondary/60 text-muted-foreground border border-border/30'
                                              }`}
                                            >
                                              <span className="font-medium">{trigger.description}</span>
                                              {wasTriggered && stage.exit_trigger_result?.triggered && (
                                                <span className="ml-1 opacity-70">(actual: {stage.exit_trigger_result.triggered.actual})</span>
                                              )}
                                              {notTriggeredData && !wasTriggered && (
                                                <span className="ml-1 opacity-70">(actual: {notTriggeredData.actual})</span>
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
                                      <span className="text-xs text-muted-foreground block mb-1.5">{t('shotHistory.limits')}</span>
                                      <div className="flex flex-wrap gap-2">
                                        {stage.limits.map((limit, lIdx) => (
                                          <div
                                            key={lIdx}
                                            className={`px-2 py-1 rounded text-xs ${
                                              stage.limit_hit?.type === limit.type
                                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                                                : 'bg-secondary/60 text-muted-foreground border border-border/30'
                                            }`}
                                          >
                                            {limit.description}
                                            {stage.limit_hit?.type === limit.type && (
                                              <>
                                                <span className="ml-1 opacity-70">(hit: {stage.limit_hit.actual_value})</span>
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
                                        <span className="text-xs text-muted-foreground block">{t('shotHistory.duration')}</span>
                                        <span className="text-sm font-medium">{stage.execution_data.duration}s</span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-muted-foreground block">{t('shotHistory.weight')}</span>
                                        <span className="text-sm font-medium">+{stage.execution_data.weight_gain}g</span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-muted-foreground block">{t('shotHistory.maxPressure')}</span>
                                        <span className="text-sm font-medium">{stage.execution_data.avg_pressure} bar</span>
                                      </div>
                                      <div>
                                        <span className="text-xs text-muted-foreground block">{t('shotHistory.maxFlow')}</span>
                                        <span className="text-sm font-medium">{stage.execution_data.avg_flow} ml/s</span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Assessment Message */}
                                  {stage.assessment && (
                                    <p className="text-xs text-muted-foreground/70 mt-2 italic">{stage.assessment.message}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>{/* End analysisCardRef */}

                        {/* Action buttons */}
                        <div className="flex flex-col gap-2 pt-2">
                          <Button variant="outline" size="sm" onClick={handleExportAnalysis} disabled={isExportingAnalysis} className="gap-1.5 w-full">
                            <DownloadSimple size={14} weight="bold" />
                            {isExportingAnalysis ? t('shotHistory.exporting') : t('shotHistory.exportAsImage')}
                          </Button>

                          {(!hideAiWhenUnavailable || aiConfigured) && ((llmAnalysisResult || isLlmCached) && !isLlmAnalyzing ? (
                            <Button variant="default" size="sm" onClick={handleViewLlmAnalysis} className="gap-1.5 w-full ai-shimmer-button border-0">
                              <Brain size={14} weight="fill" />
                              {t('shotHistory.viewAiAnalysis')}
                            </Button>
                          ) : (
                            <Button variant="default" size="sm" onClick={handleLlmAnalysis} disabled={isLlmAnalyzing || !aiConfigured} className="gap-1.5 w-full ai-shimmer-button border-0">
                              <Brain size={14} weight="fill" />
                              {t('shotHistory.getAiAnalysis')}
                            </Button>
                          ))}

                          {!aiConfigured && !hideAiWhenUnavailable && (
                            <p className="text-[11px] text-muted-foreground text-center">{t('shotHistory.aiUnavailable')}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </TabsContent>
              </Card>

              {/* Shot Annotation */}
              <Card className="p-4 border-border/40 mt-8">
                <ShotAnnotation
                  date={selectedShot.date}
                  filename={selectedShot.filename}
                  onAnnotationChange={handleAnnotationChange}
                />
              </Card>
            </div>{/* end left column */}

            {/* Right column — desktop chart (hidden on mobile) */}
            <div className="hidden lg:block order-2 sticky top-4">
              <div className="space-y-2">
                {activeAction === 'replay' && buildReplayChartProps('desktop')}

                {activeAction === 'compare' && comparisonShotData && buildCompareChartProps('desktop')}

                {activeAction === 'compare' && !comparisonShotData && (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40">
                    <GitDiff size={48} weight="duotone" />
                    <p className="text-sm mt-3">{t('shotComparison.selectShotDesktop')}</p>
                  </div>
                )}

                {activeAction === 'analyze' && analyzeChartMemo && (
                  <AnalyzeChart
                    chartData={analyzeChartMemo.chartData}
                    stageRanges={analyzeChartMemo.stageRanges}
                    hasTargetCurves={analyzeChartMemo.hasTargetCurves}
                    dataMaxTime={analyzeChartMemo.dataMaxTime}
                    maxLeftAxis={analyzeChartMemo.maxLeftAxis}
                    maxFlow={analyzeChartMemo.maxFlow}
                    profileTargetCurves={analysisResult?.profile_target_curves}
                    isDark={isDark}
                    variant="desktop"
                  />
                )}

                {activeAction === 'analyze' && !analysisResult && (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40">
                    <MagnifyingGlass size={48} weight="duotone" />
                    <p className="text-sm mt-3">{t('shotHistory.runAnalysisForOverlay')}</p>
                  </div>
                )}
              </div>
            </div>{/* end desktop graph column */}
          </div>{/* end two-column layout */}
        </Tabs>

      /* ---- No data fallback --------------------------------------------- */
      ) : (
        <Card className="p-6">
          <p className="text-center text-muted-foreground py-8">{t('shotHistory.noData')}</p>
        </Card>
      )}
    </motion.div>
  )
}
