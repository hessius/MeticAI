import { useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { AnimatePresence } from 'framer-motion'
import { useShotHistory } from '@/hooks/useShotHistory'
import { useScrollToTop } from '@/hooks/useScrollToTop'
import { getServerUrl } from '@/lib/config'

import type { ShotInfo } from './types'
import { ShotList } from './ShotList'
import { ShotDetail } from './ShotDetail'
import { SearchingLoader } from './SearchingLoader'

interface ShotHistoryViewProps {
  profileName: string
  initialShotDate?: string
  initialShotFilename?: string
  onBack: () => void
  aiConfigured?: boolean
  hideAiWhenUnavailable?: boolean
}

export function ShotHistoryView({
  profileName,
  initialShotDate,
  initialShotFilename,
  onBack,
  aiConfigured = true,
  hideAiWhenUnavailable = false,
}: ShotHistoryViewProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const {
    shots,
    isLoading,
    isBackgroundRefreshing,
    error,
    lastFetched,
    fetchShotsByProfile,
    backgroundRefresh,
    fetchShotData,
  } = useShotHistory()

  // ---- Core state ---------------------------------------------------------
  const [selectedShot, setSelectedShot] = useState<ShotInfo | null>(null)
  const [shotData, setShotData] = useState<import('./types').ShotData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [annotationSummaries, setAnnotationSummaries] = useState<
    Record<string, { has_annotation: boolean; rating: number | null }>
  >({})

  useScrollToTop([selectedShot])

  // Track whether the component was opened with a specific shot pre-selected
  const enteredWithShot = useRef(!!(initialShotDate && initialShotFilename))

  // ---- Fetch shots (stale-while-revalidate) -------------------------------
  useEffect(() => {
    const loadShots = async () => {
      try {
        const result = await fetchShotsByProfile(profileName, { limit: 20, includeData: false })

        if (result.is_stale) {
          backgroundRefresh(profileName, { limit: 20 })
        }

        // Auto-select a specific shot if navigated from ShotAnalysisView
        if (initialShotDate && initialShotFilename && result.shots?.length > 0) {
          const target = result.shots.find(
            (s: ShotInfo) => s.date === initialShotDate && s.filename === initialShotFilename,
          )
          if (target) {
            handleSelectShot(target)
          }
        }
      } catch (err) {
        console.error('Failed to fetch shots:', err)
      }
    }

    loadShots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName, fetchShotsByProfile, backgroundRefresh])

  // ---- Fetch annotation summaries when shots change -----------------------
  useEffect(() => {
    if (shots.length === 0) return
    const fetchAnnotations = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/shots/annotations`)
        if (response.ok) {
          const data = await response.json()
          setAnnotationSummaries(data.annotations || {})
        }
      } catch {
        // Non-critical — indicators just won't show
      }
    }
    fetchAnnotations()
  }, [shots])

  // ---- Handlers -----------------------------------------------------------
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
    if (selectedShot && !enteredWithShot.current) {
      setSelectedShot(null)
      setShotData(null)
      setDataError(null)
    } else {
      onBack()
    }
  }

  const handleRefresh = () => {
    backgroundRefresh(profileName, { limit: 20 })
  }

  // ---- Render -------------------------------------------------------------
  return (
    <AnimatePresence mode="wait">
      {isLoading && shots.length === 0 ? (
        <SearchingLoader key="loader" />
      ) : selectedShot ? (
        <ShotDetail
          key={`${selectedShot.date}/${selectedShot.filename}`}
          selectedShot={selectedShot}
          shotData={shotData}
          loadingData={loadingData}
          dataError={dataError}
          profileName={profileName}
          aiConfigured={aiConfigured}
          hideAiWhenUnavailable={hideAiWhenUnavailable}
          isDark={isDark}
          shots={shots}
          fetchShotData={fetchShotData}
          onBack={handleBack}
          annotationSummaries={annotationSummaries}
          setAnnotationSummaries={setAnnotationSummaries}
        />
      ) : (
        <ShotList
          key="shot-list"
          shots={shots}
          isLoading={isLoading}
          isBackgroundRefreshing={isBackgroundRefreshing}
          error={error}
          lastFetched={lastFetched}
          profileName={profileName}
          annotationSummaries={annotationSummaries}
          onBack={handleBack}
          onSelectShot={handleSelectShot}
          onRefresh={handleRefresh}
        />
      )}
    </AnimatePresence>
  )
}
