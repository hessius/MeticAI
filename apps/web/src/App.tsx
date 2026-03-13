import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QrCode } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { cleanProfileName } from '@/components/MarkdownText'
import { domToPng } from 'modern-screenshot'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { QRCodeDialog } from '@/components/QRCodeDialog'
import { useIsDesktop } from '@/hooks/use-desktop'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSwipeNavigation } from '@/hooks/use-swipe-navigation'
import { MeticAILogo } from '@/components/MeticAILogo'
import { HistoryView, ProfileDetailView } from '@/components/HistoryView'
import { HistoryEntry } from '@/hooks/useHistory'
import { SettingsView } from '@/components/SettingsView'
import { RunShotView } from '@/components/RunShotView'
import { StartView } from '@/views/StartView'
import { FormView } from '@/views/FormView'
import { LoadingView, LOADING_MESSAGE_COUNT } from '@/views/LoadingView'
import { ResultsView } from '@/views/ResultsView'
import { ErrorView } from '@/views/ErrorView'
import { useGenerationProgress } from '@/hooks/useGenerationProgress'
import { useReducedMotion } from '@/hooks/a11y/useScreenReader'
import { SkipNavigation } from '@/components/SkipNavigation'

import { AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'
import type { APIResponse, ViewState } from '@/types'

import { AmbientBackground } from '@/components/AmbientBackground'
import { useBackgroundBlobs } from '@/hooks/useBackgroundBlobs'
import { useThemePreference } from '@/hooks/useThemePreference'
import { Sun, Moon } from '@phosphor-icons/react'
import { AI_PREFS_CHANGED_EVENT, getAiEnabled, getHideAiWhenUnavailable, getAutoSync, getAutoSyncAiDescription, syncAutoSyncFromServer } from '@/lib/aiPreferences'

// Phase 3 — Control Center & live telemetry
import { useWebSocket } from '@/hooks/useWebSocket'
import { useLastShot } from '@/hooks/useLastShot'
import { ControlCenter } from '@/components/ControlCenter'
import { LastShotBanner } from '@/components/LastShotBanner'
import { ShotDetectionBanner } from '@/components/ShotDetectionBanner'
import { BetaBanner } from '@/components/BetaBanner'
import { LiveShotView } from '@/components/LiveShotView'
import { PourOverView } from '@/components/PourOverView'
import { ShotHistoryView } from '@/components/ShotHistoryView'
import { ShotAnalysisView } from '@/components/ShotAnalysisView'
import { ProfileCatalogueView } from '@/components/ProfileCatalogueView'
import { DialInWizard } from '@/components/DialInWizard'
import { ProfileBreakdown } from '@/components/ProfileBreakdown'
import type { ProfileData } from '@/components/ProfileBreakdown'

function App() {
  const { t } = useTranslation()
  const [isInitializing, setIsInitializing] = useState(true)
  const [viewState, setViewState] = useState<ViewState>('start')
  const previousViewStateRef = useRef<ViewState>('start')
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [userPrefs, setUserPrefs] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [advancedOptions, setAdvancedOptions] = useState<AdvancedCustomizationOptions>({})
  const [currentMessage, setCurrentMessage] = useState(0)
  const [apiResponse, setApiResponse] = useState<APIResponse | null>(null)

  // SSE progress for real-time generation updates
  const { progress: generationProgress } = useGenerationProgress(viewState === 'loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<HistoryEntry | null>(null)
  const [selectedHistoryImageUrl, setSelectedHistoryImageUrl] = useState<string | undefined>(undefined)
  const [currentProfileJson, setCurrentProfileJson] = useState<Record<string, unknown> | null>(null)
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null)
  const [runShotProfileId, setRunShotProfileId] = useState<string | undefined>(undefined)
  const [runShotProfileName, setRunShotProfileName] = useState<string | undefined>(undefined)
  const [shotHistoryProfileName, setShotHistoryProfileName] = useState<string | undefined>(undefined)
  const [shotHistoryInitialDate, setShotHistoryInitialDate] = useState<string | undefined>(undefined)
  const [shotHistoryInitialFilename, setShotHistoryInitialFilename] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsCardRef = useRef<HTMLDivElement>(null)
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Desktop detection for QR code feature
  const isDesktop = useIsDesktop()
  const isMobile = useIsMobile()

  // Background blobs preference (localStorage)
  const { showBlobs, toggleBlobs } = useBackgroundBlobs()

  // Phase 3 — MQTT / WebSocket telemetry
  const [mqttEnabled, setMqttEnabled] = useState(false)
  const [isAiConfigured, setIsAiConfigured] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [hideAiWhenUnavailable, setHideAiWhenUnavailable] = useState(false)
  const machineState = useWebSocket(mqttEnabled)
  const lastShotHook = useLastShot(mqttEnabled)
  const [shotBannerDismissed, setShotBannerDismissed] = useState(false)
  const prevBrewingRef = useRef(false)

  // Live profile breakdown data (fetched when in live-shot view)
  const [liveProfileData, setLiveProfileData] = useState<ProfileData | null>(null)
  const [liveProfileImageUrl, setLiveProfileImageUrl] = useState<string | null>(null)
  const liveProfileFetchedRef = useRef<string | null>(null)

  // Fetch full profile data (with stages) when in live-shot view
  useEffect(() => {
    if (viewState !== 'live-shot') {
      liveProfileFetchedRef.current = null
      setLiveProfileData(null)
      setLiveProfileImageUrl(null)
      return
    }
    const profileName = machineState.active_profile
    if (!profileName || liveProfileFetchedRef.current === profileName) return
    liveProfileFetchedRef.current = profileName

    ;(async () => {
      try {
        const base = await getServerUrl()
        // Fetch profile stages
        const r = await fetch(`${base}/api/profile/${encodeURIComponent(profileName)}?include_stages=true`)
        if (!r.ok) return
        const data = await r.json()
        if (data?.profile) {
          setLiveProfileData(data.profile as ProfileData)
        }
        // Build image URL
        setLiveProfileImageUrl(`${base}/api/profile/${encodeURIComponent(profileName)}/image-proxy`)
      } catch { /* non-critical */ }
    })()
  }, [viewState, machineState.active_profile])

  // Fetch mqttEnabled from settings on mount and when returning from Settings view
  const prevViewStateRef = useRef<ViewState | null>(null)
  useEffect(() => {
    const fetchMqttSetting = async () => {
      try {
        const serverUrl = await getServerUrl()
        const res = await fetch(`${serverUrl}/api/settings`)
        if (res.ok) {
          const data = await res.json()
          setMqttEnabled(data.mqttEnabled !== false)
          const hasGeminiKey = Boolean((data.geminiApiKey || '').trim())
          setIsAiConfigured(data.geminiApiKeyConfigured === true || hasGeminiKey)
          syncAutoSyncFromServer(data)
        }
      } catch {
        // default false if unreachable
      }
    }
    // Fetch on mount or when leaving the settings view
    if (prevViewStateRef.current === null || (prevViewStateRef.current === 'settings' && viewState !== 'settings')) {
      fetchMqttSetting()
    }
    prevViewStateRef.current = viewState
  }, [viewState])

  useEffect(() => {
    setAiEnabled(getAiEnabled())
    setHideAiWhenUnavailable(getHideAiWhenUnavailable())

    const handler = () => {
      setAiEnabled(getAiEnabled())
      setHideAiWhenUnavailable(getHideAiWhenUnavailable())
    }

    window.addEventListener(AI_PREFS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(AI_PREFS_CHANGED_EVENT, handler)
  }, [])

  // Global auto-sync polling: every 5 minutes when enabled
  const autoSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (autoSyncIntervalRef.current) {
      clearInterval(autoSyncIntervalRef.current)
      autoSyncIntervalRef.current = null
    }

    // Re-read prefs on every AI_PREFS_CHANGED_EVENT via aiEnabled dep
    const autoSyncEnabled = getAutoSync()
    if (!autoSyncEnabled) return

    const runAutoSync = async () => {
      try {
        const serverUrl = await getServerUrl()
        const aiDescription = getAutoSyncAiDescription()
        const response = await fetch(`${serverUrl}/api/profiles/auto-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_description: aiDescription }),
        })
        if (!response.ok) return
        const data = await response.json()
        const total = (data.imported_count || 0) + (data.updated_count || 0)
        if (total > 0) {
          toast.success(
            t('profileCatalogue.sync.autoSyncComplete', {
              imported: data.imported_count || 0,
              updated: data.updated_count || 0,
            })
          )
        }
      } catch {
        // Silent — auto-sync is best-effort
      }
    }

    runAutoSync()
    autoSyncIntervalRef.current = setInterval(runAutoSync, 5 * 60 * 1000)

    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current)
      }
    }
  }, [aiEnabled, t]) // aiEnabled changes on AI_PREFS_CHANGED_EVENT, retriggering this

  // Reset shot banner dismissed state when brewing ends
  useEffect(() => {
    if (prevBrewingRef.current && !machineState.brewing) {
      setShotBannerDismissed(false)
    }
    prevBrewingRef.current = machineState.brewing
  }, [machineState.brewing])

  // Theme preference (light/dark/system)
  const { mounted: themeMounted, isDark, isFollowSystem, toggleTheme, setFollowSystem } = useThemePreference()

  const isHome = viewState === 'start'

  // Check for existing profiles on mount
  useEffect(() => {
    const checkProfiles = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/history?limit=1&offset=0`)
        if (response.ok) {
          const data = await response.json()
          setProfileCount(data.total || 0)
        }
      } catch (err) {
        console.error('Failed to check profiles:', err)
        // On error, default to form view
        setProfileCount(0)
      } finally {
        setIsInitializing(false)
      }
    }
    checkProfiles()
  }, [])

  // Update profile count when returning from history view
  const refreshProfileCount = useCallback(async () => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history?limit=1&offset=0`)
      if (response.ok) {
        const data = await response.json()
        setProfileCount(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to refresh profile count:', err)
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrorMessage(t('app.errors.uploadImage'))
        return
      }
      setImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleFileDrop = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage(t('app.errors.uploadImage'))
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }, [t])

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const handleSubmit = async () => {
    if (!(isAiConfigured && aiEnabled)) {
      setErrorMessage(t('app.errors.aiDisabled'))
      return
    }

    if (!imageFile && !userPrefs.trim() && selectedTags.length === 0) {
      setErrorMessage(t('app.errors.provideInput'))
      return
    }

    setViewState('loading')
    setCurrentMessage(0)
    setErrorMessage('')

    const messageInterval = setInterval(() => {
      setCurrentMessage(prev => (prev + 1) % LOADING_MESSAGE_COUNT)
    }, 5000)

    try {
      const formData = new FormData()
      if (imageFile) {
        formData.append('file', imageFile)
      }
      
      const combinedPrefs = [
        ...selectedTags,
        userPrefs.trim()
      ].filter(Boolean).join(', ')
      
      if (combinedPrefs) {
        formData.append('user_prefs', combinedPrefs)
      }

      // Add advanced customization options if any are set
      if (Object.values(advancedOptions).some(val => val !== undefined)) {
        const advancedParams: string[] = []
        
        if (advancedOptions.basketSize) {
          advancedParams.push(`Basket size: ${advancedOptions.basketSize}`)
        }
        if (advancedOptions.basketType) {
          advancedParams.push(`Basket type: ${advancedOptions.basketType}`)
        }
        if (advancedOptions.waterTemp !== undefined) {
          advancedParams.push(`Water temperature: ${advancedOptions.waterTemp}°C`)
        }
        if (advancedOptions.maxPressure !== undefined) {
          advancedParams.push(`Max pressure: ${advancedOptions.maxPressure} bar`)
        }
        if (advancedOptions.maxFlow !== undefined) {
          advancedParams.push(`Max flow: ${advancedOptions.maxFlow} ml/s`)
        }
        if (advancedOptions.shotVolume !== undefined) {
          advancedParams.push(`Shot volume: ${advancedOptions.shotVolume} ml`)
        }
        if (advancedOptions.dose !== undefined) {
          advancedParams.push(`Dose: ${advancedOptions.dose} g`)
        }
        if (advancedOptions.bottomFilter) {
          advancedParams.push(`Bottom filter: ${advancedOptions.bottomFilter}`)
        }
        
        if (advancedParams.length > 0) {
          formData.append('advanced_customization', advancedParams.join(', '))
        }
        
        // Pass detailed knowledge mode flag
        if (advancedOptions.detailedKnowledge) {
          formData.append('detailed_knowledge', 'true')
        }
      }

      const serverUrl = await getServerUrl()
      
      const response = await fetch(`${serverUrl}/api/analyze_and_profile`, {
        method: 'POST',
        body: formData,
      })

      clearInterval(messageInterval)

      // Handle "busy" — another generation is already in progress.
      // Return the user to the form (preserving their input) with a toast.
      if (response.status === 409) {
        toast.warning(t('app.errors.generateBusy'))
        setViewState('form')
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      const responseText = await response.text()
      
      const data: APIResponse = JSON.parse(responseText)
      
      // Check if the API returned an error status
      if (data.status === 'error') {
        throw new Error((data as unknown as { message?: string }).message || t('app.errors.generateFailedGeneric'))
      }
      
      setApiResponse(data)
      
      // Extract profile JSON from the reply for download functionality
      const extractProfileJson = (text: string | undefined | null): Record<string, unknown> | null => {
        if (!text) return null
        const jsonBlockPattern = /```json\s*([\s\S]*?)```/gi
        const matches = text.matchAll(jsonBlockPattern)
        
        for (const match of matches) {
          try {
            const parsed = JSON.parse(match[1].trim())
            if (typeof parsed === 'object' && parsed !== null && ('name' in parsed || 'stages' in parsed)) {
              return parsed
            }
          } catch {
            continue
          }
        }
        return null
      }
      
      const profileJson = extractProfileJson(data.reply)
      setCurrentProfileJson(profileJson)
      
      // Fetch the machine profile ID for the created profile, with a small retry to
      // handle delays between creation and appearance in /api/machine/profiles
      const profileName = profileJson?.name as string | undefined
      if (profileName) {
        const maxAttempts = 5
        const delayMs = 500
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        let foundProfileId: string | null = null

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const profilesResponse = await fetch(`${serverUrl}/api/machine/profiles`)
            if (profilesResponse.ok) {
              const profilesData = await profilesResponse.json()
              const matchingProfile = (profilesData.profiles || []).find(
                (p: { id: string; name: string }) => p.name === profileName
              )
              if (matchingProfile) {
                foundProfileId = matchingProfile.id
                setCreatedProfileId(matchingProfile.id)
                break
              }
            } else {
              console.warn(
                `Attempt ${attempt} to fetch profiles failed with status ${profilesResponse.status}`
              )
            }
          } catch (profileErr) {
            console.error(`Failed to fetch profile ID on attempt ${attempt}:`, profileErr)
          }

          if (!foundProfileId && attempt < maxAttempts) {
            await delay(delayMs)
          }
        }
      }
      
      setViewState('results')
    } catch (error) {
      clearInterval(messageInterval)
      console.error('Error:', error)

      const buildFriendlyGenerateError = (err: Error): string => {
        const message = err.message || ''

        // Network-level failure — fetch never got an HTTP response (no connection, CORS, etc.)
        if (/NetworkError|Failed to fetch|network request failed|fetch failed/i.test(message) && !message.includes('HTTP error')) {
          return t('app.errors.generateFailedNetwork')
        }

        if (message.includes('HTTP error! status: 404')) {
          return t('app.errors.generateFailed404Route')
        }

        if (message.includes('HTTP error! status: 504') || /timed out/i.test(message)) {
          return t('app.errors.generateFailedTimeout')
        }

        if (/validation errors it couldn't resolve/i.test(message)) {
          return t('app.errors.generateFailedValidation')
        }

        // Extract the detail string from JSON error bodies returned by the server
        // e.g. body: {"detail": "quota exhausted..."} or {"detail": {"message": "..."}}
        let friendlyDetail = message
        const bodyMatch = message.match(/body:\s*(\{[\s\S]+\})$/)
        if (bodyMatch) {
          try {
            const parsed = JSON.parse(bodyMatch[1])
            const detail = parsed.detail
            if (typeof detail === 'string') {
              friendlyDetail = detail
            } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
              friendlyDetail = detail.message
            }
          } catch {
            // keep friendlyDetail as the raw message
          }
        }

        return t('app.errors.generateFailed', { message: friendlyDetail })
      }

      setErrorMessage(
        error instanceof Error 
          ? buildFriendlyGenerateError(error)
          : t('app.errors.generateFailedGeneric')
      )
      setViewState('error')
    }
  }

  const handleReset = useCallback(() => {
    // Clear any pending click timer to prevent stale callbacks
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    // Refresh profile count before switching view
    refreshProfileCount()
    setViewState('form')
    setImageFile(null)
    setImagePreview(null)
    setUserPrefs('')
    setSelectedTags([])
    setAdvancedOptions({})
    setApiResponse(null)
    setErrorMessage('')
    setCurrentMessage(0)
    setCurrentProfileJson(null)
    setCreatedProfileId(null)
    setSelectedHistoryEntry(null)
  }, [refreshProfileCount])

  // Cleanup clickTimer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  const handleBackToStart = useCallback(() => {
    refreshProfileCount()
    setViewState('start')
  }, [refreshProfileCount])

  // Swipe navigation for mobile - back navigation via swipe right
  const handleSwipeRight = useCallback(() => {
    if (!isMobile) return
    
    // Handle back navigation based on current view
    switch (viewState) {
      case 'form':
        handleBackToStart()
        break
      case 'results':
        handleReset()
        break
      case 'history-detail':
        setViewState('history')
        break
      case 'history':
      case 'settings':
      case 'pour-over':
      case 'live-shot':
      case 'shot-analysis':
      case 'dial-in':
        handleBackToStart()
        break
      case 'shot-history': {
        const prev = previousViewStateRef.current
        if (prev === 'shot-analysis' || prev === 'history-detail') {
          setViewState(prev)
        } else {
          handleBackToStart()
        }
        break
      }
      // Don't navigate on start, loading, or error views - but still block browser gesture
      default:
        break
    }
  }, [isMobile, viewState, handleBackToStart, handleReset, setViewState])

  useSwipeNavigation({
    onSwipeRight: handleSwipeRight,
    // Keep enabled on mobile to always block browser's native back gesture
    enabled: isMobile,
  })

  const handleViewHistoryEntry = (entry: HistoryEntry, cachedImageUrl?: string) => {
    setSelectedHistoryEntry(entry)
    setSelectedHistoryImageUrl(cachedImageUrl)
    setViewState('history-detail')
  }

  const handleDownloadJson = () => {
    const jsonData = selectedHistoryEntry?.profile_json || currentProfileJson
    if (!jsonData) {
      toast.error(t('results.noProfileJson'))
      return
    }

    const profileName = cleanProfileName(selectedHistoryEntry?.profile_name || 
      apiResponse?.reply.match(/Profile Created:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 
      'profile')
    
    const safeName = profileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], {
      type: 'application/json'
    })
    
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeName || 'profile'}.json`
    link.click()
    URL.revokeObjectURL(url)
    
    toast.success(t('results.profileJsonDownloaded'))
  }

  const handleSaveResults = async () => {
    if (!resultsCardRef.current || !apiResponse) return
    
    try {
      // Extract profile name from the reply
      const profileNameMatch = apiResponse.reply.match(/Profile Created:\s*(.+?)(?:\n|$)/i)
      const profileName = cleanProfileName(profileNameMatch ? profileNameMatch[1].trim() : 'espresso-profile')
      const safeFilename = profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      
      // Enable capturing mode to show header and hide buttons
      setIsCapturing(true)
      
      // Wait for DOM to update
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Verify ref is still valid after await
      if (!resultsCardRef.current) {
        setIsCapturing(false)
        return
      }
      
      // Create a wrapper div with padding to avoid alignment offset issues
      // Applying padding via modern-screenshot's style option causes width miscalculation
      const element = resultsCardRef.current
      const wrapper = document.createElement('div')
      wrapper.style.padding = '20px'
      wrapper.style.backgroundColor = '#09090b'
      wrapper.style.display = 'inline-block'
      // Position off-screen to prevent visible duplicate and layout shifts
      wrapper.style.position = 'fixed'
      wrapper.style.top = '-9999px'
      wrapper.style.left = '-9999px'
      wrapper.style.pointerEvents = 'none'
      
      // Clone the element to avoid modifying the DOM
      const clone = element.cloneNode(true) as HTMLElement
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)
      
      let dataUrl: string
      try {
        dataUrl = await domToPng(wrapper, {
          scale: 2,
          backgroundColor: '#09090b'
        })
      } finally {
        // Always clean up the wrapper
        document.body.removeChild(wrapper)
      }
      
      // Disable capturing mode
      setIsCapturing(false)
      
      const link = document.createElement('a')
      link.download = `${safeFilename}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('Error saving results:', error)
      setIsCapturing(false)
      setErrorMessage('Failed to save results. Please try again.')
    }
  }

  const handleTitleClick = () => {
    // Single tap: go to start screen (only if not on start already)
    if (viewState !== 'start') {
      handleBackToStart()
    }
  }

  const aiAvailable = isAiConfigured && aiEnabled
  const canSubmit = !!(aiAvailable && (imageFile || userPrefs.trim().length > 0 || selectedTags.length > 0))

  // Phase 3 layout helpers
  const showControlCenter = mqttEnabled && machineState._wsConnected
  const showRightColumn = showControlCenter && ['start', 'run-shot', 'live-shot'].includes(viewState)
  const showShotBanner =
    mqttEnabled &&
    machineState.brewing &&
    viewState !== 'live-shot' &&
    viewState !== 'pour-over' &&
    !shotBannerDismissed

  const prefersReducedMotion = useReducedMotion()
  const motionTransition = prefersReducedMotion ? { duration: 0 } : undefined

  return (
    <>
      <SkipNavigation />
      {showBlobs && <AmbientBackground />}

      {/* Beta version banner — fixed at top */}
      <BetaBanner />

      {/* Shot detection banner — fixed at top, across all views */}
      <ShotDetectionBanner
        visible={showShotBanner}
        onWatch={() => setViewState('live-shot')}
        onDismiss={() => setShotBannerDismissed(true)}
      />

      <div className={`min-h-screen text-foreground flex justify-center px-5 lg:px-8 overflow-x-hidden relative ${isHome ? 'items-center py-5' : 'items-start pt-3 pb-5'}`} style={{ zIndex: 1 }}>
      <Toaster richColors position="top-center" />
      <div className="w-full max-w-md md:max-w-3xl lg:max-w-5xl relative">
        <header>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTransition ?? { duration: 0.5, ease: "easeOut" }}
          className={isHome ? "text-center mb-10" : "text-center mb-6"}
        >
          <div className="flex items-center justify-center gap-3 mb-1 relative">
            <div 
              className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={handleTitleClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTitleClick() } }}
              aria-label={t('a11y.goHome')}
            >
              <MeticAILogo size={isHome ? 48 : 28} variant={isDark ? 'white' : 'default'} />
              <h1 className={`font-bold tracking-tight transition-all duration-300 ${isHome ? 'text-5xl' : 'text-2xl'}`}>
                Metic<span className="gold-text">AI</span>
              </h1>
            </div>
            <nav className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1" id="navigation" aria-label={t('navigation.settings')}>
              {themeMounted && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary transition-colors h-8 w-8"
                  onClick={toggleTheme}
                  aria-label={t('a11y.toggleTheme', { mode: isDark ? 'light' : 'dark' })}
                >
                  {isDark ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
                </Button>
              )}
              {isDesktop && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary transition-colors h-8 w-8"
                  onClick={() => setQrDialogOpen(true)}
                  aria-label={t('a11y.openOnMobile')}
                >
                  <QrCode size={18} weight="duotone" />
                </Button>
              )}
            </nav>
          </div>

        </motion.div>
        </header>

        {/* Two-column grid wrapper (desktop, specific views only) */}
        <div className={showRightColumn ? 'lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(340px,1.2fr)] lg:gap-6' : ''}>
          {/* ── Main content column ─────────────────────── */}
          <main id="main-content">
            <AnimatePresence mode="wait">
              {isInitializing && (
                <motion.div
                  key="initializing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionTransition ?? { duration: 0.15 }}
                >
                  <Card className="p-6">
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-pulse text-muted-foreground text-sm">{t('app.loading')}</div>
                    </div>
                  </Card>
                </motion.div>
              )}
              
              {!isInitializing && viewState === 'start' && (
                <StartView
                  profileCount={profileCount}
                  onGenerateNew={() => setViewState('form')}
                  onViewHistory={() => setViewState('history')}
                  onRunShot={() => {
                    setRunShotProfileId(undefined)
                    setRunShotProfileName(undefined)
                    setViewState('run-shot')
                  }}
                  onPourOver={() => setViewState('pour-over')}
                  onDialIn={() => setViewState('dial-in')}
                  onShotAnalysis={() => setViewState('shot-analysis')}
                  onSettings={() => setViewState('settings')}
                  aiConfigured={aiAvailable}
                  hideAiWhenUnavailable={hideAiWhenUnavailable}
                  lastShotBanner={
                    mqttEnabled ? (
                      <LastShotBanner
                        lastShot={lastShotHook}
                        onAnalyze={(date, filename) => {
                          // Navigate to shot analysis with the last shot's profile
                          const profileName = lastShotHook.lastShot?.profile_name
                          if (profileName) {
                            setShotHistoryProfileName(profileName)
                            setShotHistoryInitialDate(date)
                            setShotHistoryInitialFilename(filename)
                            previousViewStateRef.current = 'start'
                            setViewState('shot-history')
                          } else {
                            setViewState('shot-analysis')
                          }
                        }}
                      />
                    ) : undefined
                  }
                />
              )}

              {!isInitializing && viewState === 'form' && (
                <FormView
                  imagePreview={imagePreview}
                  userPrefs={userPrefs}
                  selectedTags={selectedTags}
                  advancedOptions={advancedOptions}
                  errorMessage={errorMessage}
                  canSubmit={canSubmit}
                  profileCount={profileCount}
                  fileInputRef={fileInputRef}
                  onFileSelect={handleFileSelect}
                  onFileDrop={handleFileDrop}
                  onRemoveImage={handleRemoveImage}
                  onUserPrefsChange={setUserPrefs}
                  onToggleTag={toggleTag}
                  onAdvancedOptionsChange={setAdvancedOptions}
                  onSubmit={handleSubmit}
                  onBack={handleBackToStart}
                  onViewHistory={() => setViewState('history')}
                />
              )}

              {viewState === 'history' && (
                <HistoryView
                  onBack={handleBackToStart}
                  onViewProfile={handleViewHistoryEntry}
                  onGenerateNew={() => setViewState('form')}
                  onManageMachine={() => setViewState('profile-catalogue')}
                  aiConfigured={aiAvailable}
                  hideAiWhenUnavailable={hideAiWhenUnavailable}
                />
              )}

              {viewState === 'history-detail' && selectedHistoryEntry && (
                <ProfileDetailView
                  entry={selectedHistoryEntry}
                  onBack={() => setViewState('history')}
                  cachedImageUrl={selectedHistoryImageUrl}
                  aiConfigured={aiAvailable}
                  hideAiWhenUnavailable={hideAiWhenUnavailable}
                  onEntryUpdated={(updated) => setSelectedHistoryEntry(updated)}
                  onRunProfile={(profileId, profileName) => {
                    setRunShotProfileId(profileId)
                    setRunShotProfileName(profileName)
                    setViewState('run-shot')
                  }}
                />
              )}

              {viewState === 'settings' && (
                <SettingsView
                  onBack={handleBackToStart}
                  showBlobs={showBlobs}
                  onToggleBlobs={toggleBlobs}
                  isDark={isDark}
                  isFollowSystem={isFollowSystem}
                  onToggleTheme={toggleTheme}
                  onSetFollowSystem={setFollowSystem}
                />
              )}

              {viewState === 'run-shot' && (
                <RunShotView
                  onBack={handleBackToStart}
                  initialProfileId={runShotProfileId}
                  initialProfileName={runShotProfileName}
                />
              )}

              {viewState === 'live-shot' && (
                <LiveShotView
                  machineState={machineState}
                  onBack={handleBackToStart}
                  onAnalyzeShot={(profileName) => {
                    setShotHistoryProfileName(profileName)
                    setShotHistoryInitialDate(undefined)
                    setShotHistoryInitialFilename(undefined)
                    previousViewStateRef.current = 'live-shot'
                    setViewState('shot-history')
                  }}
                />
              )}

              {viewState === 'pour-over' && (
                <PourOverView
                  machineState={machineState}
                  onBack={handleBackToStart}
                />
              )}

              {viewState === 'dial-in' && (
                <DialInWizard
                  onBack={handleBackToStart}
                  aiConfigured={aiAvailable}
                />
              )}

              {viewState === 'shot-history' && shotHistoryProfileName && (
                <ShotHistoryView
                  profileName={shotHistoryProfileName}
                  initialShotDate={shotHistoryInitialDate}
                  initialShotFilename={shotHistoryInitialFilename}
                  onBack={() => {
                    const prev = previousViewStateRef.current
                    if (prev === 'shot-analysis' || prev === 'history-detail') {
                      setViewState(prev)
                    } else {
                      handleBackToStart()
                    }
                  }}
                  aiConfigured={aiAvailable}
                  hideAiWhenUnavailable={hideAiWhenUnavailable}
                />
              )}

              {viewState === 'shot-analysis' && (
                <ShotAnalysisView
                  onBack={handleBackToStart}
                  onSelectShot={(profileName, date, filename) => {
                    setShotHistoryProfileName(profileName)
                    setShotHistoryInitialDate(date)
                    setShotHistoryInitialFilename(filename)
                    previousViewStateRef.current = 'shot-analysis'
                    setViewState('shot-history')
                  }}
                />
              )}

              {viewState === 'profile-catalogue' && (
                <ProfileCatalogueView onBack={() => setViewState('history')} />
              )}

              {viewState === 'loading' && (
                <LoadingView currentMessage={currentMessage} progress={generationProgress} />
              )}

              {viewState === 'results' && apiResponse && (
                <ResultsView
                  apiResponse={apiResponse}
                  currentProfileJson={currentProfileJson}
                  createdProfileId={createdProfileId}
                  isCapturing={isCapturing}
                  resultsCardRef={resultsCardRef}
                  onBack={handleReset}
                  onSaveResults={handleSaveResults}
                  onDownloadJson={handleDownloadJson}
                  onViewHistory={() => setViewState('history')}
                  onRunProfile={() => {
                    if (createdProfileId && currentProfileJson?.name) {
                      setRunShotProfileId(createdProfileId)
                      setRunShotProfileName(currentProfileJson.name as string)
                      setViewState('run-shot')
                    }
                  }}
                />
              )}


              {viewState === 'error' && (
                <ErrorView
                  errorMessage={errorMessage}
                  onRetry={handleSubmit}
                  onBack={handleReset}
                />
              )}
            </AnimatePresence>

            {/* Mobile Control Center — below the main card, StartView only */}
            {showControlCenter && isMobile && viewState === 'start' && (
              <div className="mt-4">
                <ControlCenter
                  machineState={machineState}
                  onOpenLiveView={() => setViewState('live-shot')}
                />
              </div>
            )}
          </main>

          {/* ── Right column — desktop Control Center ─── */}
          {showRightColumn && (
            <aside className="hidden lg:block">
              <div className={`sticky top-4 ${viewState === 'live-shot' ? 'mt-10' : 'mt-2'}`}>
                {/* Hide control center during live shot — profile breakdown takes over */}
                {viewState !== 'live-shot' && (
                  <ControlCenter
                    machineState={machineState}
                    onOpenLiveView={() => setViewState('live-shot')}
                  />
                )}
                {/* Live profile breakdown — shown during active shot view, fills the column */}
                {viewState === 'live-shot' && liveProfileData && (
                  <div className="flex flex-col max-h-[calc(100vh-6rem)]">
                    {/* Sticky profile header — always visible */}
                    {machineState.active_profile && (
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-card/80 backdrop-blur-sm border border-border/60 rounded-xl mb-2 shrink-0">
                        {liveProfileImageUrl && (
                          <img
                            src={liveProfileImageUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {machineState.active_profile}
                          </p>
                          {machineState.state && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {machineState.state}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Scrollable stage breakdown — auto-scroll only, no manual scroll */}
                    <div className="auto-scroll-only rounded-xl">
                      <ProfileBreakdown
                        profile={liveProfileData}
                        currentStage={machineState.state ?? null}
                      />
                      {/* Overscroll padding: allows last stage to scroll to top of container */}
                      <div className="h-[80vh]" />
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
        
        <QRCodeDialog open={qrDialogOpen} onOpenChange={setQrDialogOpen} />
      </div>
    </div>
    </>
  )
}

export default App
