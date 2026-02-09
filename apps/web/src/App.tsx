import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Camera, Sparkle, CheckCircle, Warning, ArrowClockwise, Upload, X, Info, QrCode, FileJs, Coffee, Image, CaretLeft, Plus, Gear, Play } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { MarkdownText, cleanProfileName } from '@/components/MarkdownText'
import { domToPng } from 'modern-screenshot'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { QRCodeDialog } from '@/components/QRCodeDialog'
import { useIsDesktop } from '@/hooks/use-desktop'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSwipeNavigation } from '@/hooks/use-swipe-navigation'
import { MeticAILogo } from '@/components/MeticAILogo'
import { HistoryView, ProfileDetailView } from '@/components/HistoryView'
import { ProfileBreakdown, ProfileData } from '@/components/ProfileBreakdown'
import { HistoryEntry } from '@/hooks/useHistory'
import { SettingsView } from '@/components/SettingsView'
import { RunShotView } from '@/components/RunShotView'

const LOADING_MESSAGES = [
  "Analyzing coffee beans...",
  "Detecting roast profile...",
  "Watching a Lance video...",
  "Identifying flavor notes...",
  "Checking for Kickstarter updates...",
  "Feeling some Aramse ASMR...",
  "Calculating extraction parameters...",
  "Perusing a Daddy Hoff book...",
  "Optimizing grind settings...",
  "Logging into Discord...",
  "Checking James Hoffmann's notes...",
  "Fine-tuning flow curve...",
  "Consulting the Sprometheus archives...",
  "Generating espresso profile...",
  "Channeling my inner Morgan Drinks Coffee...",
  "Almost there..."
]

import { PRESET_TAGS, CATEGORY_COLORS } from '@/lib/tags'
import { AdvancedCustomization, AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'

interface APIResponse {
  status: string
  analysis: string
  reply: string
  history_id?: string
}

type ViewState = 'start' | 'form' | 'loading' | 'results' | 'error' | 'history' | 'history-detail' | 'settings' | 'run-shot'

// Time-based greetings with variants
const GREETINGS = {
  morning: ["Good morning!", "Rise and shine!", "Morning, coffee time!", "Top of the morning!"],
  afternoon: ["Good afternoon!", "Hey there!", "Howdy!", "What's brewing?"],
  evening: ["Good evening!", "Evening!", "Ready for an espresso?", "Time for coffee!"]
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours()
  let greetings: string[]
  
  if (hour >= 5 && hour < 12) {
    greetings = GREETINGS.morning
  } else if (hour >= 12 && hour < 17) {
    greetings = GREETINGS.afternoon
  } else {
    greetings = GREETINGS.evening
  }
  
  return greetings[Math.floor(Math.random() * greetings.length)]
}

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
      setCurrentMessage(prev => (prev + 1) % LOADING_MESSAGES.length)
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

  const canSubmit = imageFile || userPrefs.trim().length > 0 || selectedTags.length > 0

  const getCategoryColor = (category: string) => {
    return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || ''
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-5 overflow-x-hidden">
      <Toaster richColors position="top-center" />
      <div className="w-full max-w-md relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-3 mb-3 relative">
            <div 
              className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={handleTitleClick}
              title="Tap to go home"
            >
              <MeticAILogo size={44} variant="white" />
              <h1 className="text-4xl font-bold tracking-tight">
                Metic<span className="text-primary">AI</span>
              </h1>
            </div>
            {isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setQrDialogOpen(true)}
                title="Open on mobile"
              >
                <QrCode size={22} weight="duotone" />
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-sm font-medium tracking-wide">Meticulous Espresso AI Profiler</p>
        </motion.div>

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
            <motion.div
              key="start"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Card className="p-6 space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">{getTimeBasedGreeting()}</h2>
                  <p className="text-sm text-muted-foreground">
                    {profileCount && profileCount > 0
                      ? `You have ${profileCount} profile${profileCount !== 1 ? 's' : ''} saved`
                      : 'Get started by generating your first profile'}
                  </p>
                </div>

                <div className="space-y-3">
                  <Button
                    onClick={() => setViewState('form')}
                    className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
                  >
                    <Plus size={20} className="mr-2" weight="bold" />
                    Generate New Profile
                  </Button>
                  
                  <Button
                    onClick={() => setViewState('history')}
                    className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
                  >
                    <Coffee size={20} className="mr-2" weight="fill" />
                    Profile Catalogue
                  </Button>
                  
                  <Button
                    onClick={() => {
                      setRunShotProfileId(undefined)
                      setRunShotProfileName(undefined)
                      setViewState('run-shot')
                    }}
                    className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
                  >
                    <Play size={20} className="mr-2" weight="fill" />
                    Run / Schedule
                  </Button>
                  
                  <Button
                    onClick={() => setViewState('settings')}
                    className="w-full h-14 text-base font-semibold bg-muted hover:bg-muted/80 text-foreground"
                  >
                    <Gear size={20} className="mr-2" weight="duotone" />
                    Settings
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {!isInitializing && viewState === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Card className="p-6 space-y-6">
                {/* Header with back button */}
                <div className="flex items-center gap-3 -mt-1 -mx-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBackToStart}
                    className="shrink-0"
                  >
                    <CaretLeft size={22} weight="bold" />
                  </Button>
                  <h2 className="text-lg font-bold tracking-tight">New Profile</h2>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-semibold tracking-wide text-foreground/90">
                    Coffee Bag Photo <span className="text-muted-foreground font-normal">(Optional)</span>
                  </Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  
                  {!imagePreview ? (
                    <label htmlFor="file-upload">
                      <motion.div 
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className="border-2 border-dashed border-border/60 hover:border-primary/50 rounded-2xl p-10 cursor-pointer transition-all duration-200 group bg-secondary/30 hover:bg-secondary/50"
                      >
                        <div className="flex flex-col items-center gap-4 text-muted-foreground group-hover:text-foreground transition-colors duration-200">
                          <div className="flex gap-3">
                            <Camera size={28} weight="duotone" className="group-hover:text-primary transition-colors" />
                            <Upload size={28} weight="duotone" className="group-hover:text-primary transition-colors" />
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-medium">Tap to upload or take photo</p>
                            <p className="text-xs mt-1.5 text-muted-foreground">JPG, PNG, or other image formats</p>
                          </div>
                        </div>
                      </motion.div>
                    </label>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative rounded-2xl overflow-hidden border-2 border-primary/40 shadow-lg"
                    >
                      <img 
                        src={imagePreview} 
                        alt="Coffee bag preview" 
                        className="w-full h-48 object-cover"
                      />
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={handleRemoveImage}
                        className="absolute top-3 right-3 p-2 bg-black/70 hover:bg-destructive rounded-xl transition-colors backdrop-blur-sm"
                      >
                        <X size={18} weight="bold" />
                      </motion.button>
                    </motion.div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="preferences" className="text-sm font-semibold tracking-wide text-foreground/90">
                    Taste Preferences <span className="text-muted-foreground font-normal">(Optional)</span>
                  </Label>
                  
                  <div className="space-y-4">
                    <Textarea
                      id="preferences"
                      value={userPrefs}
                      onChange={(e) => setUserPrefs(e.target.value)}
                      placeholder="e.g., Balanced extraction, nutty notes..."
                      className="min-h-[90px] resize-none bg-secondary/50 border-border/50 focus:border-primary/60 focus:bg-secondary/80 transition-all duration-200 rounded-xl text-sm placeholder:text-muted-foreground/60"
                    />
                    
                    <div className="space-y-2.5">
                      <p className="text-xs text-muted-foreground font-medium">Or select preset tags:</p>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_TAGS.map((tag) => {
                          const isSelected = selectedTags.includes(tag.label)
                          return (
                            <motion.button
                              key={tag.label}
                              onClick={() => toggleTag(tag.label)}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              className="relative"
                            >
                              <Badge
                                variant={isSelected ? "default" : "outline"}
                                className={`
                                  px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200
                                  ${isSelected 
                                    ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20' 
                                    : `${getCategoryColor(tag.category)} border`
                                  }
                                `}
                              >
                                {tag.label}
                              </Badge>
                            </motion.button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground/80 mt-3">
                    Describe your ideal espresso flavor profile using text, tags, or both
                  </p>
                </div>

                <AdvancedCustomization
                  value={advancedOptions}
                  onChange={setAdvancedOptions}
                />

                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
                      <Warning size={18} weight="fill" />
                      <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}

                <div className="space-y-3 pt-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="w-full h-13 text-base font-semibold transition-all duration-200"
                  >
                    <Sparkle size={18} weight="fill" className="mr-1" />
                    Generate Profile
                  </Button>
                  
                  {/* Only show catalogue button when no profiles exist (no back button visible) */}
                  {(profileCount === null || profileCount === 0) && (
                    <Button
                      onClick={() => setViewState('history')}
                      variant="ghost"
                      className="w-full h-11 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Coffee size={18} className="mr-2" weight="fill" />
                      Profile Catalogue
                    </Button>
                  )}
                </div>
              </Card>
            </motion.div>
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
            />
          )}

          {viewState === 'run-shot' && (
            <RunShotView
              onBack={handleBackToStart}
              initialProfileId={runShotProfileId}
              initialProfileName={runShotProfileName}
            />
          )}

          {viewState === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Card className="p-10">
                <div className="flex flex-col items-center gap-8">
                  <motion.div
                    animate={{ 
                      rotate: 360,
                    }}
                    transition={{ 
                      rotate: { duration: 3, repeat: Infinity, ease: "linear" },
                    }}
                    className="rounded-full p-5 bg-primary/10 border border-primary/20"
                  >
                    <Sparkle size={40} className="text-primary" weight="fill" />
                  </motion.div>

                  <div className="text-center space-y-4 w-full">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={currentMessage}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3 }}
                        className="text-lg font-semibold text-primary min-h-[3.5rem]"
                      >
                        {LOADING_MESSAGES[currentMessage]}
                      </motion.p>
                    </AnimatePresence>
                    <p className="text-sm text-muted-foreground">
                      This may take 60-90 seconds
                    </p>
                  </div>

                  <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary via-amber-400 to-primary rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 75, ease: "linear" }}
                    />
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {viewState === 'results' && apiResponse && (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ 
                type: "spring",
                stiffness: 300,
                damping: 25
              }}
            >
              <div ref={resultsCardRef} className={isCapturing ? 'w-[400px] mx-auto' : ''}>
                {isCapturing && (
                  <div className="text-center mb-6">
                    <div className="flex items-center justify-center gap-3 mb-2">
                      <MeticAILogo size={40} variant="white" />
                      <h1 className="text-4xl font-bold tracking-tight">
                        Metic<span className="text-primary">AI</span>
                      </h1>
                    </div>
                    <p className="text-muted-foreground text-sm">Meticulous Espresso AI Profiler</p>
                  </div>
                )}
              <Card className={`p-6 ${isCapturing ? 'space-y-4' : 'space-y-5'}`}>
                {(() => {
                  const profileNameMatch = apiResponse.reply.match(/Profile Created:\s*(.+?)(?:\n|$)/i)
                  const profileName = cleanProfileName(profileNameMatch?.[1]?.trim() || '')
                  
                  if (isCapturing && profileName) {
                    return (
                      <div className="text-success w-full">
                        <h2 className="text-2xl font-bold break-words">{profileName}</h2>
                      </div>
                    )
                  }
                  
                  return (
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleReset}
                        className="shrink-0"
                        title="Back to form"
                      >
                        <CaretLeft size={22} weight="bold" />
                      </Button>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="p-2 rounded-xl bg-success/10 shrink-0">
                          <CheckCircle size={24} weight="fill" className="text-success" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold text-foreground break-words leading-tight">
                            {profileName || 'Profile Generated!'}
                          </h2>
                          <p className="text-xs text-muted-foreground">Profile saved to device</p>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="space-y-4">
                  {/* Only show Coffee Analysis if it has content */}
                  {apiResponse.analysis && apiResponse.analysis.trim() && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="space-y-2"
                    >
                      <Label className="text-sm font-semibold tracking-wide text-primary">
                        Coffee Analysis
                      </Label>
                      <div className="p-4 bg-secondary/60 rounded-xl border border-primary/20">
                        <p className="text-sm leading-relaxed text-foreground/90">
                          <MarkdownText>{apiResponse.analysis}</MarkdownText>
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {/* Parse and display structured profile sections */}
                  {(() => {
                    const parseProfileSections = (text: string) => {
                      const sections: { title: string; content: string }[] = []
                      const sectionHeaders = [
                        'Description',
                        'Preparation',
                        'Why This Works',
                        'Special Notes'
                      ]
                      
                      // Split by section headers (handles both "Header:" and "**Header:**" formats)
                      const remainingText = text
                      
                      sectionHeaders.forEach((header, index) => {
                        // Match both "Header:" and "**Header:**" patterns
                        const headerPattern = new RegExp(`\\*?\\*?${header}:\\*?\\*?\\s*`, 'i')
                        const match = remainingText.match(headerPattern)
                        
                        if (match && match.index !== undefined) {
                          const startIndex = match.index + match[0].length
                          
                          // Find the next section header or end of text
                          let endIndex = remainingText.length
                          for (let i = index + 1; i < sectionHeaders.length; i++) {
                            // Match both "Header:" and "**Header:**" patterns
                            const nextHeaderPattern = new RegExp(`\\*?\\*?${sectionHeaders[i]}:`, 'i')
                            const nextMatch = remainingText.match(nextHeaderPattern)
                            if (nextMatch && nextMatch.index !== undefined) {
                              endIndex = nextMatch.index
                              break
                            }
                          }
                          
                          let content = remainingText.substring(startIndex, endIndex).trim()
                          
                          // Clean any remaining ** artifacts at start/end of content
                          content = content.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '')
                          
                          // Remove trailing --- (format delimiter) from Special Notes
                          content = content.replace(/\n*---\s*$/g, '').trim()
                          
                          // Stop at PROFILE JSON section to hide JSON output
                          const jsonSectionIndex = content.indexOf('PROFILE JSON')
                          if (jsonSectionIndex > 0) {
                            content = content.substring(0, jsonSectionIndex).trim()
                          }
                          // Also remove any code blocks that might contain JSON
                          content = content.replace(/```json[\s\S]*?```/g, '').trim()
                          content = content.replace(/```[\s\S]*?```/g, '').trim()
                          
                          if (content) {
                            sections.push({ title: header, content })
                          }
                        }
                      })
                      
                      return sections
                    }
                    
                    const sections = parseProfileSections(apiResponse.reply)
                    
                    return sections.length > 0 ? (
                      <div className="space-y-3">
                        {sections.map((section, index) => (
                          <motion.div 
                            key={index} 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + index * 0.05 }}
                            className="space-y-2"
                          >
                            <Label className="text-sm font-semibold tracking-wide text-amber-400">
                              {section.title}
                            </Label>
                            <div className="p-4 bg-secondary/60 rounded-xl border border-amber-500/15">
                              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                                <MarkdownText>{section.content}</MarkdownText>
                              </p>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      // Fallback to original display if parsing fails
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold tracking-wide text-amber-400">
                          Profile
                        </Label>
                        <div className="p-4 bg-secondary/60 rounded-xl border border-amber-500/15">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                            <MarkdownText>{apiResponse.reply}</MarkdownText>
                          </p>
                        </div>
                      </div>
                    )  
                  })()}
                </div>

                {/* Profile Technical Breakdown */}
                {currentProfileJson && (
                  <ProfileBreakdown profile={currentProfileJson as ProfileData} />
                )}

                {!isCapturing && (
                  <>
                    <Alert className="bg-success/8 border-success/20 rounded-xl">
                      <Info className="h-4 w-4 text-success" />
                      <AlertDescription className="text-sm text-foreground/80">
                        Profile has been saved to your Meticulous device and history
                      </AlertDescription>
                    </Alert>

                    {/* Run / Schedule Button */}
                    {createdProfileId && currentProfileJson?.name && (
                      <Button
                        onClick={() => {
                          setRunShotProfileId(createdProfileId)
                          setRunShotProfileName(currentProfileJson.name as string)
                          setViewState('run-shot')
                        }}
                        className="w-full h-12 text-sm font-semibold bg-success hover:bg-success/90"
                      >
                        <Play size={18} className="mr-1.5" weight="fill" />
                        Run / Schedule Shot
                      </Button>
                    )}

                    {/* Export Buttons */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground block text-center">Export as</Label>
                      <div className={`grid gap-2.5 ${currentProfileJson ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        <Button
                          onClick={handleSaveResults}
                          variant="outline"
                          className="h-11 text-sm font-semibold"
                          title="Save results as image"
                        >
                          <Image size={18} className="mr-1.5" weight="bold" />
                          Image
                        </Button>
                        {currentProfileJson && (
                          <Button
                            onClick={handleDownloadJson}
                            variant="outline"
                            className="h-11 text-sm font-semibold"
                          >
                            <FileJs size={18} className="mr-1.5" weight="bold" />
                            JSON
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Action Button */}
                    <Button
                      onClick={() => setViewState('history')}
                      variant={createdProfileId ? "outline" : "default"}
                      className="w-full h-12 text-sm font-semibold"
                    >
                      <Coffee size={18} className="mr-1.5" weight="fill" />
                      Profile Catalogue
                    </Button>
                  </>
                )}
              </Card>
              </div>
            </motion.div>
          )}

          {viewState === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25 }}
            >
              <Card className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-destructive/15">
                    <Warning size={24} weight="fill" className="text-destructive" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Something went wrong</h2>
                </div>

                <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl overflow-hidden">
                  <AlertDescription className="text-sm break-words whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {errorMessage}
                  </AlertDescription>
                </Alert>

                <div className="flex gap-3">
                  <Button
                    onClick={handleSubmit}
                    className="flex-1 h-12 text-sm font-semibold"
                  >
                    <ArrowClockwise size={18} weight="bold" className="mr-2" />
                    Retry
                  </Button>
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="flex-1 h-12 text-sm font-semibold"
                  >
                    Back to Form
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
        
        <QRCodeDialog open={qrDialogOpen} onOpenChange={setQrDialogOpen} />
      </div>
    </div>
  )
}

export default App
