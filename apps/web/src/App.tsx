import { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QrCode } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { fetchProxyAiConfigured } from '@/lib/aiConfigStatus'
import { invalidateCatalogueCache } from '@/lib/catalogueCache'
import { isDirectMode, isDemoMode, isNativePlatform } from '@/lib/machineMode'
import { hasFeature } from '@/lib/featureFlags'
import { STORAGE_KEYS } from '@/lib/constants'
import { cleanProfileName } from '@/components/MarkdownText'
import { domToPng } from 'modern-screenshot'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { notify, setHomeActive, isHomeActive } from '@/lib/notify'
import { subscribeIslandNotifications, type IslandNotification } from '@/lib/islandNotifications'
import { QRCodeDialog } from '@/components/QRCodeDialog'
import { useIsDesktop } from '@/hooks/use-desktop'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSwipeNavigation } from '@/hooks/use-swipe-navigation'
import { MeticLogo } from '@/components/MeticLogo'
import { HistoryEntry } from '@/hooks/useHistory'
import { StartView } from '@/views/StartView'
import { LoadingView, LOADING_MESSAGE_COUNT } from '@/views/LoadingView'
import { ErrorView } from '@/views/ErrorView'

// Lazy-loaded views — code-split into separate chunks
const ProfileDetailView = lazy(() => import('./components/HistoryView').then(m => ({ default: m.ProfileDetailView })))
const SettingsView = lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })))
const RunShotView = lazy(() => import('./components/RunShotView').then(m => ({ default: m.RunShotView })))
const FormView = lazy(() => import('./views/FormView').then(m => ({ default: m.FormView })))
const ResultsView = lazy(() => import('./views/ResultsView').then(m => ({ default: m.ResultsView })))
const MachineStatusCenter = lazy(() => import('./components/MachineStatusCenter').then(m => ({ default: m.MachineStatusCenter })))
import { useGenerationProgress } from '@/hooks/useGenerationProgress'
import { useReducedMotion } from '@/hooks/a11y/useScreenReader'
import { SkipNavigation } from '@/components/SkipNavigation'

import { AdvancedCustomizationOptions } from '@/components/AdvancedCustomization'
import type { APIResponse, ViewState } from '@/types'

import { AmbientBackground } from '@/components/AmbientBackground'
import { useBackgroundBlobs } from '@/hooks/useBackgroundBlobs'
import { useThemePreference } from '@/hooks/useThemePreference'
import { Sun, Moon, Gear, ArrowRight } from '@phosphor-icons/react'
import { AI_PREFS_CHANGED_EVENT, getAiEnabled, getHideAiWhenUnavailable, getAutoSync, getAutoSyncAiDescription, syncAutoSyncFromServer } from '@/lib/aiPreferences'
import { isAIConfigured, apiKeyStorageKey, getActiveProviderId } from '@/services/ai/providers'

// Phase 3 — Control Center & live telemetry
import { useMachineTelemetry } from '@/hooks/useMachineTelemetry'
import { useLastShot } from '@/hooks/useLastShot'
import { useSmartGreeting } from '@/hooks/useSmartGreeting'
import { useProfileImageSrc, getProfileImageValue, resolveDisplayImage } from '@/hooks/useProfileImageSrc'
import { ControlCenter } from '@/components/ControlCenter'
import { LastShotBanner } from '@/components/LastShotBanner'
import { BetaBanner } from '@/components/BetaBanner'
import { DemoModeBanner } from '@/components/DemoModeBanner'
import { FeatureErrorBoundary } from '@/components/FeatureErrorBoundary'
import { ProfileImportDialog } from '@/components/ProfileImportDialog'
import { ShareImportResultDialog, type ShareImportState } from '@/components/ShareImportResultDialog'
import type { ProfileData } from '@/components/ProfileBreakdown'

const LiveShotView = lazy(() => import('./components/LiveShotView').then(m => ({ default: m.LiveShotView })))
const PourOverView = lazy(() => import('./components/PourOverView').then(m => ({ default: m.PourOverView })))
const ShotHistoryView = lazy(() => import('./components/ShotHistoryView').then(m => ({ default: m.ShotHistoryView })))
const ShotAnalysisView = lazy(() => import('./components/ShotAnalysisView').then(m => ({ default: m.ShotAnalysisView })))
const ProfileCatalogueView = lazy(() => import('./components/ProfileCatalogueView').then(m => ({ default: m.ProfileCatalogueView })))
const EspressoCompass = lazy(() => import('./components/EspressoCompass').then(m => ({ default: m.EspressoCompass })))
const ProfileBreakdown = lazy(() => import('./components/ProfileBreakdown').then(m => ({ default: m.ProfileBreakdown })))
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })))

// Storage migration — initialises IndexedDB in direct/PWA mode
import { useStorageMigration } from '@/services/storage'
import { registerShareTargetListener } from '@/services/shareImport'
import { importProfileFromSource } from '@/services/importProfile'

// Capacitor plugin hooks
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useBrewNotifications } from '@/hooks/useBrewNotifications'
import { useSoundEffects, useGlobalSoundDelegation } from '@/hooks/useSoundEffects'
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton'
import { closeTopmostOverlay } from '@/lib/backNavigation'
import { hasUnsavedChanges } from '@/lib/unsavedChanges'

function App() {
  const { t } = useTranslation()
  useStorageMigration()
  const [isInitializing, setIsInitializing] = useState(() => {
    // On native/direct, never block render waiting for network
    return !(isDemoMode() || isDirectMode())
  })
  const [viewState, setViewState] = useState<ViewState>(() => {
    // Show onboarding on first launch in native/direct mode
    if ((isNativePlatform() || isDirectMode()) && !localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE)) {
      return 'onboarding'
    }
    return 'start'
  })
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
  const [shareImportState, setShareImportState] = useState<ShareImportState | null>(null)
  const [showAddProfileDialog, setShowAddProfileDialog] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsCardRef = useRef<HTMLDivElement>(null)
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Desktop detection for QR code feature
  const isDesktop = useIsDesktop()
  const isMobile = useIsMobile()

  // Background blobs preference (localStorage)
  const { showBlobs, toggleBlobs } = useBackgroundBlobs()

  // Phase 3 — MQTT / WebSocket telemetry (mode-aware: proxy=WS, direct=Socket.IO)
  const [mqttEnabled, setMqttEnabled] = useState(false)
  const [isAiConfigured, setIsAiConfigured] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [hideAiWhenUnavailable, setHideAiWhenUnavailable] = useState(false)
  const machineState = useMachineTelemetry(mqttEnabled)
  const lastShotHook = useLastShot(mqttEnabled)
  const smartGreeting = useSmartGreeting(mqttEnabled && viewState === 'start')
  const prevBrewingRef = useRef(false)
  const prevMachineStateRef = useRef<string | null>(null)

  // Capacitor plugin hooks
  const { isConnected } = useNetworkStatus()
  const { notifyPreheatComplete } = useBrewNotifications()
  const { machineReady: playMachineReady, brewingStarted: playBrewingStarted, generationComplete: playGenerationComplete, islandExpand: playIslandExpand, islandContract: playIslandContract } = useSoundEffects()
  useGlobalSoundDelegation()

  // Live profile breakdown data (fetched when in live-shot view)
  const [liveProfileData, setLiveProfileData] = useState<ProfileData | null>(null)
  const [liveProfileDescription, setLiveProfileDescription] = useState<string>('')
  const liveProfileFetchedRef = useRef<string | null>(null)

  // Resolve profile image for the desktop right-column header
  const liveProfileName = viewState === 'live-shot' ? machineState.active_profile : null
  const liveProfileImageUrl = useProfileImageSrc(liveProfileName)

  // Fetch full profile data (with stages) when in live-shot view
  useEffect(() => {
    if (viewState !== 'live-shot') {
      liveProfileFetchedRef.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state on view change
      setLiveProfileData(null)
      setLiveProfileDescription('')
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
          // The pre-shot heating view always shows the auto-generated one-line
          // summary derived from stage structure — never an author's freeform
          // description — so it reads as "what this specific shot will do".
          try {
            const { generateStaticProfileSummary } = await import('@/lib/staticProfileDescription')
            setLiveProfileDescription(generateStaticProfileSummary(data.profile))
          } catch { /* description is optional */ }
        }
      } catch { /* non-critical */ }
    })()
  }, [viewState, machineState.active_profile])

  // Fetch mqttEnabled from settings on mount and when returning from Settings view
  const prevViewStateRef = useRef<ViewState | null>(null)
  useEffect(() => {
    const fetchMqttSetting = async () => {
      // In direct or demo mode, no MeticAI backend — use sensible defaults
      if (isDemoMode() || isDirectMode()) {
        setMqttEnabled(true) // DemoAdapter / Socket.IO provides telemetry
        // On native, the active hosted provider's key may be in SecureStorage
        // (Keychain) but not in localStorage. Mirror the ACTIVE provider's slot
        // (not just Gemini) so synchronous checks (BrowserAIService, feature
        // flags, the AI gate) find it and the key takes effect without
        // re-onboarding.
        const activeKeySlot = apiKeyStorageKey(getActiveProviderId())
        if (isNativePlatform() && !localStorage.getItem(activeKeySlot)?.trim()) {
          try {
            const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
            const secureKey = await SecureStorage.getItem(activeKeySlot)
            if (secureKey?.trim()) {
              localStorage.setItem(activeKeySlot, secureKey)
            }
          } catch {
            // SecureStorage unavailable — skip migration
          }
        }
        setIsAiConfigured(isAIConfigured())
        return
      }
      try {
        const serverUrl = await getServerUrl()
        const res = await fetch(`${serverUrl}/api/settings`)
        if (res.ok) {
          const data = await res.json()
          setMqttEnabled(data.mqttEnabled !== false)
          const hasGeminiKey = Boolean((data.geminiApiKey || '').trim())
          setIsAiConfigured(data.geminiApiKeyConfigured === true || hasGeminiKey)
          if (hasFeature('cloudSync')) syncAutoSyncFromServer(data)
        }
      } catch {
        // default false if unreachable
      }
    }
    // Fetch on mount, when leaving settings, or after onboarding completes
    if (prevViewStateRef.current === null ||
        (prevViewStateRef.current === 'settings' && viewState !== 'settings') ||
        (prevViewStateRef.current === 'onboarding' && viewState !== 'onboarding')) {
      console.info('[App] fetchMqttSetting triggered, prevView:', prevViewStateRef.current, '→', viewState)
      fetchMqttSetting()
    }
    prevViewStateRef.current = viewState
  }, [viewState])

  // Scroll to top on view transitions
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [viewState])

  // Track session count (once per browser session)
  useEffect(() => {
    if (sessionStorage.getItem('meticai-session-counted')) return
    sessionStorage.setItem('meticai-session-counted', '1')
    const prev = parseInt(localStorage.getItem(STORAGE_KEYS.SESSION_COUNT) ?? '0', 10)
    localStorage.setItem(STORAGE_KEYS.SESSION_COUNT, String(prev + 1))
    // Backfill install date for users who onboarded before tracking was added
    if (!localStorage.getItem(STORAGE_KEYS.INSTALL_DATE) && localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE)) {
      localStorage.setItem(STORAGE_KEYS.INSTALL_DATE, new Date().toISOString())
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      setAiEnabled(getAiEnabled())
      setHideAiWhenUnavailable(getHideAiWhenUnavailable())
      // Re-check API key availability (may have been added/removed in Settings)
      if (isDemoMode() || isDirectMode()) {
        setIsAiConfigured(isAIConfigured())
      } else {
        // Proxy/server mode: re-fetch from the backend so the AI gate refreshes
        // immediately when a key is added in Settings, without waiting to leave
        // the Settings view.
        void fetchProxyAiConfigured().then(configured => {
          if (configured !== null) setIsAiConfigured(configured)
        })
      }
    }
    // Sync initial values in handler to avoid direct setState in effect
    handler()

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

    if (!hasFeature('cloudSync')) return

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
          notify.success(
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

  // Shot detection toast + sound on brewing start/stop
  useEffect(() => {
    if (prevBrewingRef.current && !machineState.brewing) {
      toast.dismiss('shot-running')
    }
    if (!prevBrewingRef.current && machineState.brewing) {
      playBrewingStarted()
      if (viewState !== 'live-shot' && viewState !== 'pour-over') {
        toast.info(t('controlCenter.shotDetected.title'), {
          id: 'shot-running',
          duration: Infinity,
          action: {
            label: t('controlCenter.shotDetected.watch'),
            onClick: () => setViewState('live-shot'),
          },
        })
      }
    }
    prevBrewingRef.current = machineState.brewing
  }, [machineState.brewing, playBrewingStarted, viewState, t])

  // Dismiss shot toast when navigating to live-shot view
  useEffect(() => {
    if (viewState === 'live-shot') toast.dismiss('shot-running')
  }, [viewState])

  // Notify + sound when preheat completes (state transitions from preheating/heating → ready)
  useEffect(() => {
    const currentState = machineState.state?.toLowerCase() ?? null
    const prevState = prevMachineStateRef.current
    prevMachineStateRef.current = currentState

    if (
      prevState &&
      (prevState === 'preheating' || prevState === 'heating') &&
      currentState?.startsWith('click to start')
    ) {
      notifyPreheatComplete()
      playMachineReady()
      // Surface an in-app Dynamic Island notification when the machine becomes
      // ready while the user is watching the home screen (#439). Off-home this
      // is skipped — the sound + backgrounded OS notification already cover it.
      if (isHomeActive()) notify.success(t('notifications.machineReady'))
    }
  }, [machineState.state, notifyPreheatComplete, playMachineReady, t])

  // WKWebView layout fix: force reflow when app resumes from background.
  // iPadOS WKWebView can fail to recompute CSS grid after backgrounding.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Nudge layout by toggling a harmless property — avoids visible flash
        const root = document.documentElement
        root.style.zoom = '0.9999'
        requestAnimationFrame(() => { root.style.zoom = '' })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // Theme preference (light/dark/system)
  const { mounted: themeMounted, isDark, isFollowSystem, toggleTheme, setFollowSystem } = useThemePreference()

  const isHome = viewState === 'start'

  // Dynamic Island animation: title → pill with greeting after 3s, tappable to toggle
  const [islandExpanded, setIslandExpanded] = useState(false)
  const islandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const greetingTextRef = useRef<HTMLElement | null>(null)
  const greetingInnerRef = useRef<HTMLElement | null>(null)
  const [isScrollActive, setIsScrollActive] = useState(false)
  const playIslandExpandRef = useRef(playIslandExpand)
  useEffect(() => { playIslandExpandRef.current = playIslandExpand }, [playIslandExpand])

  // In-app Dynamic Island notification (#439): when active, the island shows the
  // notification (tinted by tone) instead of the smart greeting, then restores
  // the greeting once it dismisses.
  const [islandNote, setIslandNote] = useState<IslandNotification | null>(null)
  useEffect(() => subscribeIslandNotifications(setIslandNote), [])

  // Keep the notification router aware of whether the home screen is active so
  // it can route toasts into the island vs. the standard toast system.
  useEffect(() => { setHomeActive(isHome) }, [isHome])

  useEffect(() => {
    if (islandNote) {
      // A notification takes over the island immediately, fully expanded.
      if (islandTimerRef.current) { clearTimeout(islandTimerRef.current); islandTimerRef.current = null }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- expand to show notification
      setIslandExpanded(true)
      playIslandExpandRef.current()
    } else if (isHome && smartGreeting) {
      islandTimerRef.current = setTimeout(() => { setIslandExpanded(true); playIslandExpandRef.current() }, 3000)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when leaving home
      setIslandExpanded(false)
    }
    return () => { if (islandTimerRef.current) clearTimeout(islandTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHome, smartGreeting, islandNote])

  // Detect vertical text overflow and enable scroll animation
  useEffect(() => {
    if (!islandExpanded || !greetingTextRef.current || !greetingInnerRef.current) {
      setIsScrollActive(false)
      return
    }
    const container = greetingTextRef.current
    const inner = greetingInnerRef.current

    const checkOverflow = () => {
      const overflow = inner.scrollHeight - container.clientHeight
      if (overflow > 4) {
        // Set CSS variable BEFORE adding active class (Safari safety)
        inner.style.setProperty('--island-scroll-y', `-${overflow}px`)
        // Scale duration: ~6s base + 1s per extra line of overflow
        const lineHeight = parseFloat(getComputedStyle(container).lineHeight) || 16.8
        const extraLines = Math.max(0, Math.round(overflow / lineHeight))
        inner.style.setProperty('--island-scroll-duration', `${6 + extraLines * 1}s`)
        setIsScrollActive(true)
      } else {
        setIsScrollActive(false)
      }
    }

    // Initial check after expansion transition completes
    const timer = setTimeout(checkOverflow, 600)
    // Re-check on resize (responsive width changes, font loading)
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(container)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [islandExpanded, smartGreeting, islandNote])

  const toggleIsland = useCallback(() => {
    if (islandTimerRef.current) { clearTimeout(islandTimerRef.current); islandTimerRef.current = null }
    setIslandExpanded(prev => {
      if (prev) playIslandContract(); else playIslandExpand()
      return !prev
    })
  }, [playIslandExpand, playIslandContract])

  // Derived island display: a notification (#439) takes precedence over the
  // smart greeting. Notifications are non-interactive (auto-dismiss) and carry
  // no action chevron; the greeting remains tappable to toggle.
  const islandMessage = islandNote?.message ?? smartGreeting?.message
  const islandAction = islandNote ? undefined : smartGreeting?.action
  const islandHasContent = !!(islandNote || smartGreeting)
  const islandToggleable = !islandNote && !!smartGreeting
  const islandTint = useMemo(() => {
    if (!islandNote) return null
    switch (islandNote.tone) {
      case 'success': return { bg: 'rgba(16,185,129,0.20)', border: 'rgba(16,185,129,0.45)' }
      case 'warning': return { bg: 'rgba(245,158,11,0.20)', border: 'rgba(245,158,11,0.45)' }
      case 'error': return { bg: 'rgba(239,68,68,0.20)', border: 'rgba(239,68,68,0.45)' }
      default: return { bg: 'rgba(59,130,246,0.18)', border: 'rgba(59,130,246,0.45)' }
    }
  }, [islandNote])

  // Check for existing profiles on mount.
  //
  // In proxy/server mode the `/api/history` endpoint is backed by the espresso
  // machine's shot log, which can take 10s+ to respond (and much longer under
  // concurrent load). Init must never hard-block on it, otherwise the whole app
  // is stuck on the loading screen until the machine replies. Clear the
  // initializing gate immediately and let the profile count populate in the
  // background, guarded by a timeout so a slow or hanging machine never leaves
  // the request pending indefinitely.
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const checkProfiles = async () => {
      // In direct or demo mode, skip proxy API — default to form view
      if (isDemoMode() || isDirectMode()) {
        setProfileCount(0)
        setIsInitializing(false)
        return
      }

      // Never block the UI on the (potentially slow) machine-backed history call.
      setIsInitializing(false)

      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/history?limit=1&offset=0`, {
          signal: controller.signal,
        })
        if (response.ok) {
          const data = await response.json()
          setProfileCount(data.total || 0)
        }
      } catch (err) {
        // Ignore aborts (timeout/unmount); default to form view otherwise
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('Failed to check profiles:', err)
          setProfileCount(0)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
    checkProfiles()

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  // Update profile count when returning from history view
  const refreshProfileCount = useCallback(async () => {
    if (isDemoMode() || isDirectMode()) return
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

  // Automatic profile import used by the share sheet and the `?import=` deep
  // link. The profile is added without any dialog interaction; a central
  // popover then reports success (with the profile name) or failure (with a
  // reason when the server provides one).
  const runAutoImport = useCallback(async (source: string) => {
    const trimmed = source.trim()
    if (!trimmed) return
    setShareImportState({ status: 'importing' })
    const result = await importProfileFromSource(trimmed)
    setShareImportState(result)
    if (result.status === 'success' || result.status === 'exists') {
      refreshProfileCount()
      setViewState('profile-catalogue')
    }
  }, [refreshProfileCount])

  // The share sheet and the `?import=` deep link both import automatically and
  // then surface the central result popover. Both run once on mount because
  // runAutoImport is stable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const importParam = params.get('import')
    if (importParam) {
      const url = new URL(window.location.href)
      url.searchParams.delete('import')
      window.history.replaceState({}, '', url.toString())
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time deep-link import on mount
      runAutoImport(importParam)
    }
  }, [runAutoImport])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void registerShareTargetListener((source) => {
      runAutoImport(source)
    }).then((fn) => {
      cleanup = fn
    })
    return () => {
      cleanup?.()
    }
  }, [runAutoImport])

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
        ? prev.filter(item => item !== tag)
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

      // A new profile was just created on the machine — drop the catalogue
      // cache so it shows up immediately instead of after the TTL expires.
      invalidateCatalogueCache()
      
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
      
      playGenerationComplete()
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

  // Fix iPad layout squishing when returning from background (#422)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Force layout recalculation by triggering a resize event
        window.dispatchEvent(new Event('resize'))
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const handleBackToStart = useCallback(() => {
    refreshProfileCount()
    setViewState('start')
  }, [refreshProfileCount])

  // Shared back-navigation mapping used by both the mobile swipe gesture and
  // the Android hardware back button. Returns true if it navigated, false if
  // there was nowhere to go back to (e.g. the main screen).
  const navigateBack = useCallback((): boolean => {
    switch (viewState) {
      case 'form':
        handleBackToStart()
        return true
      case 'results':
        handleReset()
        return true
      case 'history-detail':
        setViewState('profile-catalogue')
        return true
      case 'profile-catalogue':
        handleBackToStart()
        return true
      case 'settings':
      case 'pour-over':
      case 'live-shot':
      case 'shot-analysis':
      case 'dial-in':
      case 'machine-status':
        handleBackToStart()
        return true
      case 'shot-history': {
        const prev = previousViewStateRef.current
        if (prev === 'shot-analysis' || prev === 'history-detail') {
          setViewState(prev)
        } else {
          handleBackToStart()
        }
        return true
      }
      // start, loading, onboarding, error: nowhere to go back to.
      default:
        return false
    }
  }, [viewState, handleBackToStart, handleReset, setViewState])

  // Swipe navigation for mobile - back navigation via swipe right
  const handleSwipeRight = useCallback(() => {
    if (!isMobile) return
    navigateBack()
  }, [isMobile, navigateBack])

  useSwipeNavigation({
    onSwipeRight: handleSwipeRight,
    // Keep enabled on mobile to always block browser's native back gesture
    enabled: isMobile,
  })

  // Android hardware back button. Priority: close an open modal/dialog/menu,
  // otherwise confirm before discarding unsaved edits and navigate to the
  // previous view. On the main screen there is nowhere to go back to, so the
  // press is intentionally a no-op (the app is not exited).
  const handleAndroidBack = useCallback(() => {
    if (closeTopmostOverlay()) return
    if (qrDialogOpen) { setQrDialogOpen(false); return }
    if (showAddProfileDialog) { setShowAddProfileDialog(false); return }
    if (shareImportState && shareImportState.status !== 'importing') { setShareImportState(null); return }
    if (hasUnsavedChanges() && !window.confirm(t('profileEdit.unsavedChanges'))) return
    navigateBack()
  }, [qrDialogOpen, showAddProfileDialog, shareImportState, navigateBack, t])

  useAndroidBackButton(handleAndroidBack)

  const handleViewHistoryEntry = (entry: HistoryEntry, cachedImageUrl?: string) => {
    document.getElementById('root')?.scrollTo(0, 0)
    setSelectedHistoryEntry(entry)
    setSelectedHistoryImageUrl(cachedImageUrl)
    setViewState('history-detail')
  }

  const handleViewProfileByName = async (profileName: string) => {
    try {
      const serverUrl = await getServerUrl()

      if (isDemoMode()) return

      if (isDirectMode() || isNativePlatform()) {
        // In direct/Capacitor mode, look up profile from the machine's profile list
        let profileId = profileName
        let displayImage: string | undefined

        // Try cache first
        const cacheRes = await fetch(`/api/profile/${encodeURIComponent(profileName)}`)
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json()
          if (cacheData?.profile?.id) {
            profileId = cacheData.profile.id
            displayImage = getProfileImageValue(cacheData.profile) ?? undefined
          }
        }

        // If cache didn't resolve an actual ID, try the full profile list from machine
        if (profileId === profileName) {
          try {
            const listRes = await fetch('/api/v1/profile/list')
            if (listRes.ok) {
              const profiles = await listRes.json()
              const match = Array.isArray(profiles) && profiles.find(
                (p: { name?: string; id?: string }) => p.name === profileName
              )
              if (match?.id) profileId = match.id
            }
          } catch { /* proceed with name as ID */ }
        }

        // Fetch profile JSON for the breakdown view
        const jsonRes = await fetch(`/api/machine/profile/${encodeURIComponent(profileId)}/json`)
        const jsonData = jsonRes.ok ? await jsonRes.json() : {}
        const profileJson = jsonData?.profile ?? null

        const descCache = (window as unknown as Record<string, unknown>).__meticaiDescriptionCache as Map<string, string> | undefined
        let reply = descCache?.get(profileId) ?? descCache?.get(profileName) ?? ''
        if (!reply && profileJson) {
          const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
          reply = buildStaticProfileDescription(profileJson)
          descCache?.set(profileId, reply)
        }

        // Fetch any saved notes
        let notes: string | undefined
        try {
          const notesRes = await fetch(`/api/history/${encodeURIComponent(profileId)}/notes`)
          if (notesRes.ok) {
            const notesData = await notesRes.json()
            notes = notesData.notes || undefined
          }
        } catch { /* non-critical */ }

        const entry: HistoryEntry = {
          id: profileId,
          profile_name: profileName,
          created_at: new Date().toISOString(),
          coffee_analysis: null,
          user_preferences: null,
          reply,
          notes,
          profile_json: profileJson,
        }
        const imageUrl = resolveDisplayImage(displayImage) ?? undefined
        handleViewHistoryEntry(entry, imageUrl)
      } else {
        // Proxy mode: search history for matching entry
        const response = await fetch(`${serverUrl}/api/history?limit=500&offset=0`)
        if (!response.ok) return
        const data = await response.json()
        const match = data.entries?.find((e: HistoryEntry) => e.profile_name === profileName)
        if (match) {
          handleViewHistoryEntry(match)
        }
      }
    } catch {
      // Silently fail — profile may not exist
    }
  }

  const handleViewMachineProfile = async (profile: { id: string; name: string; image?: string; display?: { image?: string; description?: string } }) => {
    // Navigate immediately with cached data — fetch full profile in background
    const descCache = (window as unknown as Record<string, unknown>).__meticaiDescriptionCache as Map<string, string> | undefined
    const reply = descCache?.get(profile.id) ?? descCache?.get(profile.name) ?? ''
    const profileImage = getProfileImageValue(profile)
    const imageUrl = (isDirectMode() || isNativePlatform())
      ? resolveDisplayImage(profileImage) ?? undefined
      : profileImage || undefined

    const entry: HistoryEntry = {
      id: profile.id,
      profile_name: profile.name,
      created_at: new Date().toISOString(),
      coffee_analysis: null,
      user_preferences: null,
      reply,
      profile_json: null,
    }
    previousViewStateRef.current = 'profile-catalogue'
    handleViewHistoryEntry(entry, imageUrl)

    // Fetch full profile and notes in background, then update entry
    try {
      const serverUrl = await getServerUrl()
      const [jsonRes, notesRes] = await Promise.all([
        fetch(`${serverUrl}/api/machine/profile/${profile.id}/json`),
        fetch(`${serverUrl}/api/history/${encodeURIComponent(profile.id)}/notes`).catch(() => null),
      ])
      const jsonData = jsonRes.ok ? await jsonRes.json() : {}
      const profileJson = jsonData.profile ?? null

      let notes: string | undefined
      if (notesRes?.ok) {
        const notesData = await notesRes.json()
        notes = notesData.notes || undefined
      }

      // Generate description if we didn't have one cached
      let updatedReply = reply
      if (!updatedReply && profileJson) {
        const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
        updatedReply = buildStaticProfileDescription(profileJson)
        descCache?.set(profile.id, updatedReply)
      }

      const updated: HistoryEntry = {
        id: profile.id,
        profile_name: profile.name,
        created_at: entry.created_at,
        coffee_analysis: null,
        user_preferences: null,
        reply: updatedReply,
        notes,
        profile_json: profileJson,
      }
      setSelectedHistoryEntry(updated)
    } catch {
      // Non-critical — view already shows basic info
    }
  }

  const handleDownloadJson = async () => {
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

    const jsonString = JSON.stringify(jsonData, null, 2)

    if (isNativePlatform()) {
      // On native, use Share API (WKWebView can't open blob: URLs)
      const { Share } = await import('@capacitor/share')
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      try {
        // Write to temp file and share
        const filename = `${safeName || 'profile'}.json`
        const result = await Filesystem.writeFile({
          path: filename,
          data: btoa(unescape(encodeURIComponent(jsonString))),
          directory: Directory.Cache,
        })
        await Share.share({
          title: profileName,
          files: [result.uri],
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        // Fallback: share as text
        await Share.share({
          title: profileName,
          text: jsonString,
        })
      }
    } else {
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName || 'profile'}.json`
      link.click()
      URL.revokeObjectURL(url)
    }
    
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

  const aiAvailable = isAiConfigured && aiEnabled
  const canSubmit = !!(aiAvailable && (imageFile || userPrefs.trim().length > 0 || selectedTags.length > 0))

  // Phase 3 layout helpers
  const showControlCenter = mqttEnabled
  const showRightColumn = showControlCenter && ['start', 'live-shot'].includes(viewState)

  const prefersReducedMotion = useReducedMotion()

  // Greeting action handler (shared between header pill and StartView)
  const viewMachineProfileRef = useRef(handleViewMachineProfile)
  useEffect(() => { viewMachineProfileRef.current = handleViewMachineProfile }, [handleViewMachineProfile])

  const handleGreetingAction = useCallback((target: string, context?: Record<string, string>) => {
    try {
      switch (target) {
        case 'shot-analysis':
          if (context?.date && context?.filename) {
            setShotHistoryProfileName(context.profileName || machineState.active_profile || 'Unknown')
            setShotHistoryInitialDate(context.date)
            setShotHistoryInitialFilename(context.filename)
            previousViewStateRef.current = 'start'
            setViewState('shot-history')
          } else {
            setViewState('shot-analysis')
          }
          break
        case 'dial-in':
          setViewState('dial-in')
          break
        case 'history':
        case 'profile-catalogue':
          setViewState('profile-catalogue')
          break
        case 'view-profile':
          if (context?.profileId && context?.profileName) {
            viewMachineProfileRef.current({ id: context.profileId, name: context.profileName })
          } else if (context?.profileName) {
            // No profileId — try to find the profile by name from the machine
            (async () => {
              try {
                const serverUrl = await getServerUrl()
                const res = await fetch(`${serverUrl}/api/machine/profiles`)
                if (res.ok) {
                  const data = await res.json()
                  const profiles = (data.profiles ?? []) as { id: string; name: string; display?: { image?: string; description?: string } }[]
                  const match = profiles.find((p: { name: string }) => p.name.toLowerCase() === context.profileName!.toLowerCase())
                  if (match) {
                    viewMachineProfileRef.current(match)
                    return
                  }
                }
              } catch {
                // Profile lookup failed
              }
              setViewState('profile-catalogue')
            })()
          } else {
            console.warn('[DynamicIsland] view-profile action missing context, falling back to catalogue', context)
            setViewState('profile-catalogue')
          }
          break
        case 'add-profile':
          setShowAddProfileDialog(true)
          break
        case 'shot-history':
          previousViewStateRef.current = 'start'
          setViewState('shot-history')
          break
        default:
          console.warn('[DynamicIsland] Unknown greeting action target:', target)
          break
      }
    } catch (err) {
      console.error('[DynamicIsland] Error handling greeting action:', target, err)
    }
  }, [machineState.active_profile])

  const motionTransition = prefersReducedMotion ? { duration: 0 } : undefined

  const appContent = (
    <>
      <Toaster richColors />
      <SkipNavigation />
      {showBlobs && <AmbientBackground />}

      {/* Beta version banner — fixed at top */}
      <BetaBanner />

      {/* Network status banner */}
      {!isConnected && (
        <div
          className="bg-destructive/90 text-destructive-foreground text-center py-1 text-xs font-medium"
          style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top))' }}
        >
          {t('common.noInternetConnection')}
        </div>
      )}

      {/* Demo mode indicator */}
      <DemoModeBanner />

      <div className={`flex-1 text-foreground flex justify-center px-5 md:px-8 overflow-x-hidden overflow-y-auto relative ${isHome ? 'items-start pt-[calc(var(--safe-pt)+1.25rem)] pb-[var(--safe-pb)] xl:items-center xl:pb-[var(--safe-pb)]' : 'items-start pt-[calc(var(--safe-pt)+0.75rem)] pb-[var(--safe-pb)]'}`} style={{ zIndex: 1 }}>
      <div className="w-full max-w-md md:max-w-3xl lg:max-w-5xl relative">
        {isHome && (
        <header>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTransition ?? { duration: 0.5, ease: "easeOut" }}
          className="text-center mb-3 md:mb-4"
        >
          <div className="flex items-center justify-center gap-3 mb-1 relative" style={{ minHeight: 48 }}>
            {/* Settings gear — left side */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-primary transition-colors h-8 w-8"
                onClick={() => setViewState('settings')}
                aria-label={t('navigation.settings')}
              >
                <Gear size={18} weight="duotone" />
              </Button>
            </div>

            {/* Theme toggle + QR — right side */}
            <nav className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10" id="navigation" aria-label={t('navigation.settings')}>
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
              {isDesktop && !isNativePlatform() && (
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

            {/* Centered island + title unit */}
            <div className="flex items-center justify-center">
              {/* Dynamic Island — circle→pill CSS transition */}
              <div
                  className={`inline-flex items-center select-none${!islandExpanded && islandToggleable ? ' cursor-pointer' : ''}`}
                  data-sound="none"
                  onClick={!islandExpanded && islandToggleable ? toggleIsland : undefined}
                  role={!islandExpanded && islandToggleable ? 'button' : undefined}
                  tabIndex={!islandExpanded && islandToggleable ? 0 : undefined}
                  onKeyDown={!islandExpanded && islandToggleable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIsland() } } : undefined}
                  style={{
                    height: islandExpanded ? 48 : 40,
                    width: islandExpanded ? 'min(20rem, calc(100vw - 7rem))' : 40,
                    background: islandExpanded
                      ? (islandTint ? islandTint.bg : (isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.75)'))
                      : 'transparent',
                    backdropFilter: islandExpanded ? (isDark ? 'none' : 'blur(16px) saturate(1.4)') : 'none',
                    WebkitBackdropFilter: islandExpanded ? (isDark ? 'none' : 'blur(16px) saturate(1.4)') : 'none',
                    borderRadius: 9999,
                    border: islandExpanded
                      ? (islandTint ? `1px solid ${islandTint.border}` : (isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(0,0,0,0.08)'))
                      : '1px solid transparent',
                    padding: islandExpanded ? '4px 4px 4px 4px' : '0',
                    overflow: 'hidden',
                    justifyContent: islandExpanded ? 'flex-start' : 'center',
                    transition: 'width 0.55s cubic-bezier(0.32, 0.72, 0, 1), height 0.45s cubic-bezier(0.32, 0.72, 0, 1), background 0.45s cubic-bezier(0.32, 0.72, 0, 1), backdrop-filter 0.4s ease, border-color 0.4s ease, padding 0.45s cubic-bezier(0.32, 0.72, 0, 1)',
                  }}
                >
                  {/* Logo — tap to collapse when expanded */}
                  <button
                    type="button"
                    data-sound="none"
                    className="shrink-0 flex items-center justify-center bg-transparent border-none p-0"
                    onClick={islandExpanded && islandToggleable ? (e) => { e.stopPropagation(); toggleIsland() } : undefined}
                    tabIndex={islandExpanded && islandToggleable ? 0 : -1}
                    aria-label={islandExpanded && islandToggleable ? t('a11y.collapseGreeting', 'Collapse greeting') : t('a11y.appLogo', 'Metic logo')}
                    aria-hidden={islandExpanded && islandToggleable ? undefined : true}
                    style={{
                      width: 32,
                      height: 32,
                      cursor: islandExpanded && islandToggleable ? 'pointer' : 'default',
                      transition: 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
                      transform: islandExpanded ? 'scale(0.85)' : 'scale(1)',
                    }}
                  >
                    <MeticLogo
                      size={32}
                      variant={isDark ? 'white' : 'default'}
                      className="rounded-full"
                      style={{
                        background: islandExpanded ? 'transparent' : (isDark ? '#000' : '#fff'),
                        padding: islandExpanded ? 0 : 2,
                        transition: 'background 0.4s ease, padding 0.3s ease',
                      }}
                    />
                  </button>

                  {/* Greeting / notification text — always in DOM for smooth animation, zero-width when collapsed */}
                  {islandHasContent && (
                    <div
                      className="min-w-0 overflow-hidden"
                      style={{
                        flex: islandExpanded ? '1 1 0%' : '0 0 0px',
                        width: islandExpanded ? undefined : 0,
                        marginLeft: islandExpanded ? 6 : 0,
                        opacity: islandExpanded ? 1 : 0,
                        transition: 'flex 0.45s cubic-bezier(0.32, 0.72, 0, 1), width 0.45s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease 0.25s, margin-left 0.45s cubic-bezier(0.32, 0.72, 0, 1)',
                        pointerEvents: islandExpanded ? 'auto' : 'none',
                        maskImage: islandExpanded && !islandAction ? 'linear-gradient(to right, black 0px, black calc(100% - 8px), transparent 100%)' : 'none',
                        WebkitMaskImage: islandExpanded && !islandAction ? 'linear-gradient(to right, black 0px, black calc(100% - 8px), transparent 100%)' : 'none',
                      }}
                    >
                      <div
                        ref={greetingTextRef as React.RefObject<HTMLDivElement>}
                        className={`text-xs island-greeting-text${isScrollActive ? ' island-scroll-active' : ''} ${isDark ? 'text-white/85' : 'text-foreground/80'}`}
                        role={islandNote ? 'status' : undefined}
                        aria-live={islandNote ? 'polite' : undefined}
                      >
                        <span ref={greetingInnerRef as React.RefObject<HTMLSpanElement>} className="island-marquee-inner">{islandMessage}</span>
                      </div>
                    </div>
                  )}

                  {/* Action button — circular chevron on the right */}
                  {islandAction && islandExpanded && (
                    <button
                      type="button"
                      className={`shrink-0 flex items-center justify-center rounded-full transition-all ${isDark ? 'bg-white/10 hover:bg-white/20 text-white/80' : 'bg-black/5 hover:bg-black/10 text-foreground/60'}`}
                      onClick={(e) => { e.stopPropagation(); handleGreetingAction(islandAction.target, islandAction.context) }}
                      aria-label={islandAction.label}
                      style={{
                        width: 32,
                        height: 32,
                        marginLeft: 4,
                        opacity: islandExpanded ? 1 : 0,
                        transition: 'opacity 0.3s ease 0.4s, background 0.2s ease',
                      }}
                    >
                      <ArrowRight size={16} weight="bold" />
                    </button>
                  )}
                </div>

              {/* Title — collapses when island expands */}
              <h1
                role={smartGreeting ? "button" : undefined}
                data-sound="none"
                tabIndex={smartGreeting ? 0 : undefined}
                onClick={smartGreeting ? toggleIsland : undefined}
                onKeyDown={smartGreeting ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIsland() } } : undefined}
                className={`font-bold tracking-tight text-3xl whitespace-nowrap overflow-hidden select-none${smartGreeting ? ' cursor-pointer' : ''}`}
                style={{
                  maxWidth: islandExpanded ? 0 : 140,
                  opacity: islandExpanded ? 0 : 1,
                  padding: islandExpanded ? '0' : '4px 6px',
                  margin: islandExpanded ? '0' : '-4px -6px -4px 8px',
                  transition: 'max-width 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease, margin 0.4s cubic-bezier(0.32, 0.72, 0, 1), padding 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
                }}
              >
                Metic<span className="header-dot">.</span>
              </h1>
            </div>
          </div>

        </motion.div>
        </header>
        )}

        {/* Two-column grid wrapper (desktop, specific views only) */}
        <div className={showRightColumn ? 'md:grid md:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)] lg:grid-cols-[minmax(0,3fr)_minmax(340px,1.2fr)] md:gap-6' : ''}>
          {/* ── Main content column ─────────────────────── */}
          <main id="main-content">
            <Suspense fallback={
              <Card className="p-6">
                <div className="flex items-center justify-center h-32">
                  <div className="animate-pulse text-muted-foreground text-sm">{t('app.loading')}</div>
                </div>
              </Card>
            }>
            <AnimatePresence mode="wait">
              {isInitializing && viewState !== 'onboarding' && (
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
              
              {viewState === 'onboarding' && (
                <motion.div
                  key="onboarding"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionTransition ?? { duration: 0.15 }}
                >
                  <OnboardingWizard onComplete={() => {
                    setViewState('start')
                    setIsInitializing(false)
                  }} />
                </motion.div>
              )}

              {!isInitializing && viewState === 'start' && (
                <StartView
                  profileCount={profileCount}
                  onAddProfile={() => setShowAddProfileDialog(true)}
                  onViewHistory={() => setViewState('profile-catalogue')}
                  onProfileCatalogue={() => setViewState('profile-catalogue')}
                  onRunShot={() => {
                    setRunShotProfileId(undefined)
                    setRunShotProfileName(undefined)
                    setViewState('run-shot')
                  }}
                  onPourOver={() => setViewState('pour-over')}
                  onDialIn={() => setViewState('dial-in')}
                  onShotAnalysis={() => setViewState('shot-analysis')}
                  onSettings={() => setViewState('settings')}
                  controlCenter={
                    showControlCenter && isMobile ? (
                      <ControlCenter
                        machineState={machineState}
                        onOpenLiveView={() => setViewState('live-shot')}
                      />
                    ) : undefined
                  }
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
                <FeatureErrorBoundary feature="Profile Creator">
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
                    onViewHistory={() => setViewState('profile-catalogue')}
                    onViewProfile={handleViewProfileByName}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'history-detail' && selectedHistoryEntry && (
                <FeatureErrorBoundary feature="Profile Detail">
                  <ProfileDetailView
                    key={selectedHistoryEntry.id}
                    entry={selectedHistoryEntry}
                    onBack={() => {
                      setViewState('profile-catalogue')
                    }}
                    cachedImageUrl={selectedHistoryImageUrl}
                    aiConfigured={aiAvailable}
                    hideAiWhenUnavailable={hideAiWhenUnavailable}
                    onEntryUpdated={(updated) => setSelectedHistoryEntry(updated)}
                    onViewProfile={handleViewProfileByName}
                    onRunProfile={(profileId, profileName) => {
                      setRunShotProfileId(profileId)
                      setRunShotProfileName(profileName)
                      setViewState('run-shot')
                    }}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'settings' && (
                <FeatureErrorBoundary feature="Settings">
                  <SettingsView
                    onBack={handleBackToStart}
                    onRestartOnboarding={() => {
                      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE)
                      setViewState('onboarding')
                    }}
                    showBlobs={showBlobs}
                    onToggleBlobs={toggleBlobs}
                    isDark={isDark}
                    isFollowSystem={isFollowSystem}
                    onToggleTheme={toggleTheme}
                    onSetFollowSystem={setFollowSystem}
                    onNavigateToStatus={() => setViewState('machine-status')}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'machine-status' && (
                <FeatureErrorBoundary feature="Machine Status">
                  <MachineStatusCenter onBack={() => setViewState('settings')} />
                </FeatureErrorBoundary>
              )}

              {viewState === 'run-shot' && (
                <FeatureErrorBoundary feature="Run Shot">
                  <RunShotView
                    onBack={handleBackToStart}
                    onNavigateToLive={() => setViewState('live-shot')}
                    initialProfileId={runShotProfileId}
                    initialProfileName={runShotProfileName}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'live-shot' && (
                <FeatureErrorBoundary feature="Live Shot">
                  <LiveShotView
                    machineState={machineState}
                    onBack={handleBackToStart}
                    profileData={liveProfileData}
                    profileDescription={liveProfileDescription}
                    onAnalyzeShot={(profileName) => {
                      setShotHistoryProfileName(profileName)
                      setShotHistoryInitialDate(undefined)
                      setShotHistoryInitialFilename(undefined)
                      previousViewStateRef.current = 'live-shot'
                      setViewState('shot-history')
                    }}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'pour-over' && (
                <FeatureErrorBoundary feature="Pour Over">
                  <PourOverView
                    machineState={machineState}
                    onBack={handleBackToStart}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'dial-in' && (
                <FeatureErrorBoundary feature="Espresso Compass">
                  <EspressoCompass
                    onBack={handleBackToStart}
                  />
                </FeatureErrorBoundary>
              )}

              {viewState === 'shot-history' && shotHistoryProfileName && (
                <FeatureErrorBoundary feature="Shot History">
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
                </FeatureErrorBoundary>
              )}

              {viewState === 'shot-analysis' && (
                <FeatureErrorBoundary feature="Shot Analysis">
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
                </FeatureErrorBoundary>
              )}

              {viewState === 'profile-catalogue' && (
                <FeatureErrorBoundary feature="Profile Catalogue">
                  <ProfileCatalogueView onBack={() => setViewState('start')} onViewProfile={handleViewMachineProfile} />
                </FeatureErrorBoundary>
              )}

              {viewState === 'loading' && (
                <LoadingView currentMessage={currentMessage} progress={generationProgress} />
              )}

              {viewState === 'results' && apiResponse && (
                <FeatureErrorBoundary feature="Results">
                  <ResultsView
                    apiResponse={apiResponse}
                    currentProfileJson={currentProfileJson}
                    createdProfileId={createdProfileId}
                    isCapturing={isCapturing}
                    resultsCardRef={resultsCardRef}
                    onBack={handleReset}
                    onSaveResults={handleSaveResults}
                    onDownloadJson={handleDownloadJson}
                    onViewHistory={() => setViewState('profile-catalogue')}
                    onRunProfile={() => {
                      if (createdProfileId && currentProfileJson?.name) {
                        setRunShotProfileId(createdProfileId)
                        setRunShotProfileName(currentProfileJson.name as string)
                        setViewState('run-shot')
                      }
                    }}
                  />
                </FeatureErrorBoundary>
              )}


              {viewState === 'error' && (
                <ErrorView
                  errorMessage={errorMessage}
                  onRetry={handleSubmit}
                  onBack={handleReset}
                />
              )}
            </AnimatePresence>
            </Suspense>

            {/* Mobile Control Center — now rendered inside StartView */}

            {/* Desktop-only footer — home view, non-demo, single-column only */}
            {!isMobile && isHome && !isDemoMode() && !showRightColumn && (
              <footer className="text-center py-4 mt-2">
                <a
                  href="https://buymeacoffee.com/HSUS"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  {t('common.supportProject')}
                </a>
              </footer>
            )}
          </main>

          {/* ── Right column — desktop Control Center ─── */}
          {showRightColumn && !isMobile && (
            <aside className="hidden md:block">
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
                      <Suspense fallback={<div className="animate-pulse p-4 text-muted-foreground text-sm">{t('app.loading')}</div>}>
                      <ProfileBreakdown
                        profile={liveProfileData}
                        currentStage={machineState.state ?? null}
                      />
                      </Suspense>
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
        <ProfileImportDialog
          isOpen={showAddProfileDialog}
          aiConfigured={aiAvailable}
          hideAiWhenUnavailable={hideAiWhenUnavailable}
          onClose={() => {
            setShowAddProfileDialog(false)
          }}
          onImported={() => {
            setShowAddProfileDialog(false)
            setViewState('profile-catalogue')
          }}
          onGenerateNew={() => {
            setShowAddProfileDialog(false)
            setViewState('form')
          }}
        />
        <ShareImportResultDialog
          state={shareImportState}
          onClose={() => setShareImportState(null)}
        />
      </div>
    </div>
    </>
  )

  return appContent
}

export default App
