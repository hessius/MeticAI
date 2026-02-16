import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

import { AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'
import type { APIResponse, ViewState } from '@/types'

import { AmbientBackground } from '@/components/AmbientBackground'
import { useBackgroundBlobs } from '@/hooks/useBackgroundBlobs'
import { useThemePreference } from '@/hooks/useThemePreference'
import { Sun, Moon } from '@phosphor-icons/react'

// Phase 3 — Control Center & live telemetry
import { useWebSocket } from '@/hooks/useWebSocket'
import { useLastShot } from '@/hooks/useLastShot'
import { ControlCenter } from '@/components/ControlCenter'
import { LastShotBanner } from '@/components/LastShotBanner'
import { ShotDetectionBanner } from '@/components/ShotDetectionBanner'
import { LiveShotView } from '@/components/LiveShotView'

function App() {
  const [isInitializing, setIsInitializing] = useState(true)
  const [viewState, setViewState] = useState<ViewState>('start')
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [userPrefs, setUserPrefs] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [advancedOptions, setAdvancedOptions] = useState<AdvancedCustomizationOptions>({})
  const [currentMessage, setCurrentMessage] = useState(0)
  const [apiResponse, setApiResponse] = useState<APIResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<HistoryEntry | null>(null)
  const [selectedHistoryImageUrl, setSelectedHistoryImageUrl] = useState<string | undefined>(undefined)
  const [currentProfileJson, setCurrentProfileJson] = useState<Record<string, unknown> | null>(null)
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null)
  const [runShotProfileId, setRunShotProfileId] = useState<string | undefined>(undefined)
  const [runShotProfileName, setRunShotProfileName] = useState<string | undefined>(undefined)
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
  const machineState = useWebSocket(mqttEnabled)
  const lastShotHook = useLastShot(mqttEnabled)
  const [shotBannerDismissed, setShotBannerDismissed] = useState(false)
  const prevBrewingRef = useRef(false)

  // Fetch mqttEnabled from settings on mount
  useEffect(() => {
    const fetchMqttSetting = async () => {
      try {
        const serverUrl = await getServerUrl()
        const res = await fetch(`${serverUrl}/api/settings`)
        if (res.ok) {
          const data = await res.json()
          setMqttEnabled(data.mqttEnabled !== false)
        }
      } catch {
        // default false if unreachable
      }
    }
    fetchMqttSetting()
  }, [])

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
        setErrorMessage('Please upload an image file (JPG, PNG, etc.)')
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
    if (!imageFile && !userPrefs.trim() && selectedTags.length === 0) {
      setErrorMessage('Please provide at least a coffee bag photo or taste preferences')
      return
    }

    setViewState('loading')
    setCurrentMessage(0)
    setErrorMessage('')

    const messageInterval = setInterval(() => {
      setCurrentMessage(prev => (prev + 1) % LOADING_MESSAGE_COUNT)
    }, 3500)

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
      }

      const serverUrl = await getServerUrl()
      console.log('Sending request to:', `${serverUrl}/analyze_and_profile`)
      
      const response = await fetch(`${serverUrl}/analyze_and_profile`, {
        method: 'POST',
        body: formData,
      })

      clearInterval(messageInterval)

      console.log('Response status:', response.status)
      console.log('Response headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      const responseText = await response.text()
      console.log('Response text:', responseText)
      
      const data: APIResponse = JSON.parse(responseText)
      
      // Check if the API returned an error status
      if (data.status === 'error') {
        throw new Error((data as unknown as { message?: string }).message || 'Profile generation failed on the server')
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
      setErrorMessage(
        error instanceof Error 
          ? `Failed to generate profile: ${error.message}` 
          : 'Failed to generate profile. Please check your connection and try again.'
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
      case 'live-shot':
        handleBackToStart()
        break
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
      toast.error('No profile JSON available')
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
    
    toast.success('Profile JSON downloaded!')
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

  const loadMockResults = () => {
    const mockProfileJson = {
      name: "Riesling to the Occasion",
      author: "MeticAI",
      temperature: 94,
      final_weight: 45,
      stages: [
        { name: "Pre-infusion", pressure: 3, flow: 2, duration: 10 },
        { name: "Bloom", pressure: 2, flow: 1.5, duration: 15 },
        { name: "Extraction", pressure: 9, flow: null, duration: 20 },
        { name: "Decline", pressure: 6, flow: null, duration: 10 }
      ]
    }
    
    setApiResponse({
      status: 'success',
      analysis: "Standout Coffee's Washed Pink Bourbon, grown in the Huila region of Colombia at 1800 masl on the Zarza farm, offers floral notes of rose and lily with flavors of cantaloupe, sweet mango, pink lemonade, and sparkling Austrian riesling.",
      reply: `Profile Created: Riesling to the Occasion

Description: A modern, multi-stage profile designed to highlight the delicate florals and funky fruit-forward nature of the Washed Pink Bourbon. It uses an extended blooming phase to deepen complexity and a declining pressure ramp to deliver a clean, sparkling finish reminiscent of a fine white wine.

Preparation: • Dose: 18g
• Grind: Fine; slightly finer than a standard espresso grind to accommodate the long, gentle pre-infusion.
• Water Temp: 94°C
• Yield: 45g (approx. 1:2.5 ratio)
• Total Time: ~45-55 seconds

Why This Works: We're giving this exceptional coffee the spa treatment. The initial low-flow soak gently saturates the puck, preventing any harshness. The long, low-energy "Funk Tank Bloom" is where the magic happens, allowing unique, soluble compounds to develop, pushing those mango and cantaloupe notes forward. The pressure ramp extracts the core sweetness and body, while the final, declining pressure phase mimics a lever machine, which prevents over-extraction of bitter compounds and lets that bright, acidic "Riesling" and pink lemonade sparkle.

Special Notes: For maximum clarity and to really make those delicate floral notes pop, consider using a paper filter at the bottom of your basket.`
    })
    setCurrentProfileJson(mockProfileJson)
    setViewState('results')
  }

  const handleTitleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
    }
    
    const newCount = clickCount + 1
    setClickCount(newCount)
    
    if (newCount === 5) {
      // Secret dev feature: 5 rapid clicks loads test results
      loadMockResults()
      setClickCount(0)
    } else {
      // Set a timer - if no more clicks, go home after 300ms
      clickTimerRef.current = setTimeout(() => {
        // Single tap: go to start screen (only if not on start already)
        if (viewState !== 'start') {
          handleBackToStart()
        }
        setClickCount(0)
      }, 300)
    }
  }

  const canSubmit = !!(imageFile || userPrefs.trim().length > 0 || selectedTags.length > 0)

  // Phase 3 layout helpers
  const showControlCenter = mqttEnabled && machineState._wsConnected
  const showRightColumn = showControlCenter && ['start', 'run-shot', 'live-shot'].includes(viewState)
  const showShotBanner =
    mqttEnabled &&
    machineState.brewing &&
    viewState !== 'live-shot' &&
    !shotBannerDismissed

  return (
    <>
      {showBlobs && <AmbientBackground />}

      {/* Shot detection banner — fixed at top, across all views */}
      <ShotDetectionBanner
        visible={showShotBanner}
        onWatch={() => setViewState('live-shot')}
        onDismiss={() => setShotBannerDismissed(true)}
      />

      <div className={`min-h-screen text-foreground flex justify-center px-5 lg:px-8 overflow-x-hidden relative ${isHome ? 'items-center py-5' : 'items-start pt-3 pb-5'}`} style={{ zIndex: 1 }}>
      <Toaster richColors position="top-center" />
      <div className="w-full max-w-md md:max-w-3xl lg:max-w-5xl relative">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className={isHome ? "text-center mb-10" : "text-center mb-6"}
        >
          <div className="flex items-center justify-center gap-3 mb-1 relative">
            <div 
              className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={handleTitleClick}
              title="Tap to go home"
            >
              <MeticAILogo size={isHome ? 48 : 28} variant={isDark ? 'white' : 'default'} />
              <h1 className={`font-bold tracking-tight transition-all duration-300 ${isHome ? 'text-5xl' : 'text-2xl'}`}>
                Metic<span className="gold-text">AI</span>
              </h1>
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {themeMounted && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-primary transition-colors h-8 w-8"
                  onClick={toggleTheme}
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
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
                  title="Open on mobile"
                >
                  <QrCode size={18} weight="duotone" />
                </Button>
              )}
            </div>
          </div>

        </motion.div>

        {/* Two-column grid wrapper (desktop, specific views only) */}
        <div className={showRightColumn ? 'md:grid md:grid-cols-2 md:gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(340px,1.2fr)]' : ''}>
          {/* ── Main content column ─────────────────────── */}
          <div>
            <AnimatePresence mode="wait">
              {isInitializing && (
                <motion.div
                  key="initializing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Card className="p-6">
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
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
                  onSettings={() => setViewState('settings')}
                  lastShotBanner={
                    mqttEnabled ? (
                      <LastShotBanner
                        lastShot={lastShotHook}
                        onAnalyze={(date, filename) => {
                          // Navigate to shot history for analysis
                          // TODO: wire to specific shot detail once LiveShotView is built
                          setViewState('history')
                          void date; void filename
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
                />
              )}

              {viewState === 'history-detail' && selectedHistoryEntry && (
                <ProfileDetailView
                  entry={selectedHistoryEntry}
                  onBack={() => setViewState('history')}
                  cachedImageUrl={selectedHistoryImageUrl}
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
                  onAnalyze={handleBackToStart}
                />
              )}

              {viewState === 'loading' && (
                <LoadingView currentMessage={currentMessage} />
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
                  compact
                />
              </div>
            )}
          </div>

          {/* ── Right column — desktop Control Center ─── */}
          {showRightColumn && (
            <aside className="hidden md:block">
              <div className={`sticky top-4 ${viewState === 'live-shot' ? 'mt-10' : ''}`}>
                <ControlCenter
                  machineState={machineState}
                  onOpenLiveView={() => setViewState('live-shot')}
                />
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
