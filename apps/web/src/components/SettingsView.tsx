import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
// Konsta UI settings temporarily hidden — uncomment when re-enabling
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { hasFeature } from '@/lib/featureFlags'
// Konsta UI settings temporarily hidden — uncomment when re-enabling
// import { useKonstaToggle } from '@/hooks/useKonstaOverride'
import { 
  CaretLeft, 
  GithubLogo, 
  CheckCircle, 
  Warning, 
  ArrowsClockwise,
  ArrowClockwise,
  DownloadSimple,
  CaretDown,
  CaretUp,
  Globe,
  WifiHigh,
  WifiSlash,
  House,
  Key,
  Link as LinkIcon,
  Copy,
  Question,
  Code,
  Info
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { isDirectMode, isNativePlatform } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'
import { getAiEnabled, getHideAiWhenUnavailable, setAiEnabled, setHideAiWhenUnavailable } from '@/lib/aiPreferences'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'
import { useUpdateTrigger } from '@/hooks/useUpdateTrigger'
import { MarkdownText } from '@/components/MarkdownText'
import { LanguageSelector } from '@/components/LanguageSelector'
import type { PlatformTheme } from '@/hooks/usePlatformTheme'

interface SettingsViewProps {
  onBack: () => void
  showBlobs?: boolean
  onToggleBlobs?: () => void
  isDark?: boolean
  isFollowSystem?: boolean
  onToggleTheme?: () => void
  onSetFollowSystem?: (follow: boolean) => void
  platformTheme?: PlatformTheme
  onSetPlatformTheme?: (theme: PlatformTheme) => void
}

interface Settings {
  geminiApiKey: string
  meticulousIp: string
  authorName: string
  geminiModel?: string
  mqttEnabled?: boolean
  geminiApiKeyMasked?: boolean
  geminiApiKeyConfigured?: boolean
}

interface VersionInfo {
  version: string
  commit?: string
  repoUrl: string
}

interface ReleaseNote {
  version: string
  date: string
  body: string
}

interface UpdateMethod {
  method: 'watchtower' | 'manual'
  watchtower_running: boolean
  can_trigger_update: boolean
  watchtower_endpoint?: string | null
  watchtower_error?: string | null
}

interface TailscaleStatus {
  enabled: boolean
  auth_key_configured: boolean
  installed: boolean
  connected: boolean
  hostname: string | null
  dns_name: string | null
  ip: string | null
  external_url: string | null
  auth_key_expired: boolean
  login_url: string | null
}

// Maximum expected update duration (3 minutes)
const MAX_UPDATE_DURATION = 180000
const PROGRESS_UPDATE_INTERVAL = 500
const METICULOUS_ADDON_INSTALL_SNIPPET = 'docker exec -it meticai bash -lc "cd /app/meticulous-addon && python3 -m pip install -r requirements.txt && python3 -m pip install ."'
const METICULOUS_ADDON_UPDATE_SNIPPET = 'docker exec -it meticai bash -lc "cd /app/meticulous-addon && git pull --ff-only && python3 -m pip install ."'

export function SettingsView({ onBack, showBlobs, onToggleBlobs, isDark, isFollowSystem, onToggleTheme, onSetFollowSystem, platformTheme: _platformTheme, onSetPlatformTheme: _onSetPlatformTheme }: SettingsViewProps) {
  const { t } = useTranslation()
  // Konsta UI settings temporarily hidden — uncomment when re-enabling
  // const { enabled: useKonstaUi, setEnabled: setUseKonstaUi } = useKonstaToggle()
  void _platformTheme; void _onSetPlatformTheme
  
  const [settings, setSettings] = useState<Settings>({
    geminiApiKey: '',
    meticulousIp: '',
    authorName: '',
    geminiModel: 'gemini-2.5-flash',
    mqttEnabled: true
  })
  const [isRestarting, setIsRestarting] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [restartStatus, setRestartStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  
  // Machine auto-detect
  const [isDetecting, setIsDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<{
    found: boolean
    ip?: string
    hostname?: string
    guidance?: string
    guidance_key?: string
    guidance_hints?: string[]
  } | null>(null)
  
  // Version info
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  
  // Changelog
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([])
  const [changelogExpanded, setChangelogExpanded] = useState(false)
  const [changelogLoading, setChangelogLoading] = useState(false)
  
  // About section
  const [aboutExpanded, setAboutExpanded] = useState(false)
  
  // Update functionality
  const { updateAvailable, checkForUpdates, isChecking, latestStableVersion, latestBetaVersion } = useUpdateStatus()
  const { triggerUpdate, isUpdating, updateError } = useUpdateTrigger()
  const [updateProgress, setUpdateProgress] = useState(0)
  
  
  // Update method detection
  const [updateMethod, setUpdateMethod] = useState<UpdateMethod | null>(null)
  
  // Tailscale status
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null)
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState('')
  const [tailscaleSaving, setTailscaleSaving] = useState(false)
  const [tailscaleSaveStatus, setTailscaleSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [tailscaleMessage, setTailscaleMessage] = useState('')
  const [aiEnabled, setAiEnabledState] = useState(true)
  const [hideAiWhenUnavailable, setHideAiWhenUnavailableState] = useState(false)
  const hasGeminiKey = Boolean((settings.geminiApiKey || '').trim()) || settings.geminiApiKeyConfigured === true

  // Beta channel state
  const [betaChannelEnabled, setBetaChannelEnabled] = useState(false)
  const [betaSwitching, setBetaSwitching] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature' | 'question' | 'general'>('general')
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackDescription, setFeedbackDescription] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackResult, setFeedbackResult] = useState<{ status: string; url?: string; message?: string } | null>(null)

  // Cross-channel version notifications
  const parseBaseVersion = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, '').split('-')[0].split('.')
    return [parseInt(parts[0] || '0'), parseInt(parts[1] || '0'), parseInt(parts[2] || '0')]
  }

  const currentVersion = versionInfo?.version || ''
  const isOnBeta = currentVersion ? ['-beta', '-alpha', '-rc'].some(suffix => currentVersion.toLowerCase().includes(suffix)) : false

  // Show "newer beta available" when on stable and a beta exists with a higher base version
  const showBetaAvailable = !betaChannelEnabled && !isOnBeta && !!latestBetaVersion && !!currentVersion && currentVersion !== 'unknown' && (() => {
    const [cMaj, cMin, cPat] = parseBaseVersion(currentVersion)
    const [bMaj, bMin, bPat] = parseBaseVersion(latestBetaVersion)
    return bMaj > cMaj || (bMaj === cMaj && (bMin > cMin || (bMin === cMin && bPat > cPat)))
  })()

  // Show "stable caught up" when on beta and stable base >= current base
  const showStableCaughtUp = isOnBeta && !!latestStableVersion && !!currentVersion && currentVersion !== 'unknown' && (() => {
    const [cMaj, cMin, cPat] = parseBaseVersion(currentVersion)
    const [sMaj, sMin, sPat] = parseBaseVersion(latestStableVersion)
    return sMaj > cMaj || (sMaj === cMaj && (sMin > cMin || (sMin === cMin && sPat >= cPat)))
  })()

  useEffect(() => {
    setAiEnabledState(getAiEnabled())
    setHideAiWhenUnavailableState(getHideAiWhenUnavailable())
  }, [])

  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (isDirectMode()) {
        // In direct mode, load from localStorage
        setSettings({
          geminiApiKey: localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || '',
          meticulousIp: window.location.hostname,
          authorName: localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || '',
          geminiModel: localStorage.getItem(STORAGE_KEYS.GEMINI_MODEL) || 'gemini-2.5-flash',
          mqttEnabled: true,
          geminiApiKeyMasked: false,
          geminiApiKeyConfigured: Boolean(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)?.trim()),
        })
        setIsLoading(false)
        return
      }
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/settings`)
        if (response.ok) {
          const data = await response.json()
          setSettings({
            geminiApiKey: data.geminiApiKey || '',
            meticulousIp: data.meticulousIp || '',
            authorName: data.authorName || '',
            geminiModel: data.geminiModel || 'gemini-2.5-flash',
            mqttEnabled: data.mqttEnabled !== false,
            geminiApiKeyMasked: data.geminiApiKeyMasked || false,
            geminiApiKeyConfigured: data.geminiApiKeyConfigured || false
          })
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    const loadUpdateMethod = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/update-method`)
        if (response.ok) {
          const data = await response.json()
          setUpdateMethod(data)
        }
      } catch (err) {
        console.error('Failed to load update method:', err)
      }
    }
    
    const loadTailscaleStatus = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/tailscale-status`)
        if (response.ok) {
          const data = await response.json()
          setTailscaleStatus(data)
        }
      } catch {
        // Tailscale may not be installed — this is expected
      }
    }
    
    loadSettings()
    loadUpdateMethod()
    loadTailscaleStatus()
  }, [])

  // Load version info
  useEffect(() => {
    const loadVersionInfo = async () => {
      if (isDirectMode()) {
        setVersionInfo({ version: __APP_VERSION__ || 'PWA', repoUrl: 'https://github.com/hessius/MeticAI' })
        return
      }
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/version`)
        if (response.ok) {
          const data = await response.json()
          setVersionInfo({
            version: data.version || 'unknown',
            commit: data.commit || undefined,
            repoUrl: data.repo_url || 'https://github.com/hessius/MeticAI'
          })
          // Also set beta channel status from version endpoint
          setBetaChannelEnabled(data.beta_channel_enabled || false)
        }
      } catch (err) {
        console.error('Failed to load version info:', err)
      }
    }
    loadVersionInfo()
  }, [])

  // Load release notes when changelog is expanded (using server-side cache)
  const loadReleaseNotes = useCallback(async () => {
    if (releaseNotes.length > 0) return // Already loaded
    
    setChangelogLoading(true)
    try {
      // Fetch releases from server (which caches GitHub API responses)
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/changelog`)
      
      if (response.ok) {
        const data = await response.json()
        
        if (data.error && data.releases.length === 0) {
          setReleaseNotes([
            {
              version: 'Error',
              date: '',
              body: data.error,
            },
          ])
        } else {
          const notes: ReleaseNote[] = data.releases.map((release: { version: string; date: string; body: string }) => ({
            version: release.version,
            date: release.date ? new Date(release.date).toLocaleDateString() : '',
            body: release.body || 'No release notes available.'
          }))
          setReleaseNotes(notes)
        }
      } else {
        // Handle non-OK responses explicitly and surface feedback to the user
        const message = `Failed to load release notes (status ${response.status})`
        setReleaseNotes([
          {
            version: 'Error',
            date: '',
            body: message,
          },
        ])
      }
    } catch (err) {
      console.error('Failed to load release notes:', err)
      setReleaseNotes([
        {
          version: 'Error',
          date: '',
          body:
            'An unexpected error occurred while loading release notes. Please check your network connection and try again.',
        },
      ])
    } finally {
      setChangelogLoading(false)
    }
  }, [releaseNotes.length])

  useEffect(() => {
    if (changelogExpanded) {
      loadReleaseNotes()
    }
  }, [changelogExpanded, loadReleaseNotes])

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSave = useCallback((nextSettings: Settings) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        if (isDirectMode()) {
          if (nextSettings.geminiApiKey && !nextSettings.geminiApiKey.startsWith('*')) {
            localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, nextSettings.geminiApiKey)
          }
          if (nextSettings.authorName) {
            localStorage.setItem(STORAGE_KEYS.AUTHOR_NAME, nextSettings.authorName)
          }
          if (nextSettings.geminiModel) {
            localStorage.setItem(STORAGE_KEYS.GEMINI_MODEL, nextSettings.geminiModel)
          }
        } else {
          const serverUrl = await getServerUrl()
          const payload: Record<string, string | boolean | undefined> = {
            authorName: nextSettings.authorName,
            meticulousIp: nextSettings.meticulousIp,
            mqttEnabled: nextSettings.mqttEnabled,
            geminiModel: nextSettings.geminiModel,
          }
          if (nextSettings.geminiApiKey && !nextSettings.geminiApiKey.startsWith('*')) {
            payload.geminiApiKey = nextSettings.geminiApiKey
            payload.geminiApiKeyMasked = false
          }
          const response = await fetch(`${serverUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) {
            let errorMsg = t('settings.settingsSaveFailed')
            try {
              const error = await response.json()
              errorMsg = error.detail?.message || error.detail || errorMsg
            } catch { /* use default */ }
            throw new Error(errorMsg)
          }
        }
        setAutoSaveStatus('saved')
        if (autoSaveFadeRef.current) clearTimeout(autoSaveFadeRef.current)
        autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000)
      } catch (err) {
        setAutoSaveStatus('error')
        setErrorMessage(err instanceof Error ? err.message : t('settings.settingsSaveFailed'))
        if (autoSaveFadeRef.current) clearTimeout(autoSaveFadeRef.current)
        autoSaveFadeRef.current = setTimeout(() => setAutoSaveStatus('idle'), 4000)
      }
    }, 800)
  }, [t])

  const handleChange = (field: keyof Settings, value: string) => {
    setSettings(prev => {
      const next = { ...prev, [field]: value }
      debouncedSave(next)
      return next
    })
  }

  const handleDetectMachine = async () => {
    setIsDetecting(true)
    setDetectResult(null)
    
    try {
      const response = await fetch(`${await getServerUrl()}/api/machine/detect`, {
        method: 'POST',
      })
      
      const result = await response.json()
      setDetectResult(result)
      
      if (result.found && result.ip) {
        // Auto-fill the IP field
        handleChange('meticulousIp', result.ip)
      }
    } catch (error) {
      console.error('Machine detection failed:', error)
      setDetectResult({
        found: false,
        guidance_key: 'networkError',
      })
    } finally {
      setIsDetecting(false)
    }
  }

  const handleCopyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (err) {
      console.error('Failed to copy snippet:', err)
    }
  }

  const handleUpdate = async () => {
    setUpdateProgress(0)
    
    // Start progress animation
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const percentage = Math.min((elapsed / MAX_UPDATE_DURATION) * 100, 95)
      setUpdateProgress(percentage)
    }, PROGRESS_UPDATE_INTERVAL)
    
    let succeeded = false
    try {
      await triggerUpdate()
      succeeded = true
    } finally {
      clearInterval(interval)
      setUpdateProgress(succeeded ? 100 : 0)
    }
  }

  const handleRestart = async () => {
    if (!confirm(t('settings.restartConfirm'))) {
      return
    }
    
    setIsRestarting(true)
    setRestartStatus('idle')

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/restart`, {
        method: 'POST'
      })

      if (response.ok) {
        setRestartStatus('success')
        
        // The container will actually restart — wait for it to come back
        // Poll the health endpoint until the server is reachable again
        const pollHealth = async () => {
          const maxAttempts = 30 // ~30 seconds
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1000))
            try {
              const healthResp = await fetch(`${serverUrl}/api/health`, {
                signal: AbortSignal.timeout(2000)
              })
              if (healthResp.ok) {
                window.location.reload()
                return
              }
            } catch {
              // Server still down, keep polling
            }
          }
          // If we get here, server didn't come back — reload anyway
          window.location.reload()
        }
        pollHealth()
      } else {
        const error = await response.json()
        throw new Error(error.detail?.message || t('settings.restartFailed'))
      }
    } catch (err) {
      // Network errors are expected — the server may have already started shutting down
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setRestartStatus('success')
        // Server went down before we got a response — poll for it to come back
        const serverUrl = await getServerUrl()
        const pollHealth = async () => {
          const maxAttempts = 30
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 1000))
            try {
              const healthResp = await fetch(`${serverUrl}/api/health`, {
                signal: AbortSignal.timeout(2000)
              })
              if (healthResp.ok) {
                window.location.reload()
                return
              }
            } catch {
              // Still down
            }
          }
          window.location.reload()
        }
        pollHealth()
      } else {
        setRestartStatus('error')
        setErrorMessage(err instanceof Error ? err.message : t('settings.restartFailed'))
        setIsRestarting(false)
      }
    }
  }

  const canTriggerUpdate = updateMethod?.can_trigger_update ?? false

  const handleTailscaleToggle = async (enabled: boolean) => {
    setTailscaleSaving(true)
    setTailscaleSaveStatus('idle')
    setTailscaleMessage('')
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/tailscale/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      
      if (response.ok) {
        const data = await response.json()
        setTailscaleStatus(prev => prev ? { ...prev, enabled } : null)
        setTailscaleSaveStatus('success')
        setTailscaleMessage(data.restart_required 
          ? t('settings.tailscale.restartRequired')
          : t('settings.tailscale.saved'))
        setTimeout(() => setTailscaleSaveStatus('idle'), 5000)
      } else {
        throw new Error(t('settings.tailscale.saveFailed'))
      }
    } catch (err) {
      setTailscaleSaveStatus('error')
      setTailscaleMessage(err instanceof Error ? err.message : t('settings.tailscale.saveFailed'))
    } finally {
      setTailscaleSaving(false)
    }
  }

  const handleTailscaleAuthKeySave = async () => {
    if (!tailscaleAuthKey.trim()) return
    
    setTailscaleSaving(true)
    setTailscaleSaveStatus('idle')
    setTailscaleMessage('')
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/tailscale/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey: tailscaleAuthKey })
      })
      
      if (response.ok) {
        setTailscaleStatus(prev => prev ? { ...prev, auth_key_configured: true } : null)
        setTailscaleAuthKey('')
        setTailscaleSaveStatus('success')
        setTailscaleMessage(t('settings.tailscale.authKeySaved'))
        setTimeout(() => setTailscaleSaveStatus('idle'), 5000)
      } else {
        throw new Error(t('settings.tailscale.saveFailed'))
      }
    } catch (err) {
      setTailscaleSaveStatus('error')
      setTailscaleMessage(err instanceof Error ? err.message : t('settings.tailscale.saveFailed'))
    } finally {
      setTailscaleSaving(false)
    }
  }

  const handleBetaChannelToggle = async (enabled: boolean) => {
    setBetaSwitching(true)
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/beta-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      
      if (response.ok) {
        setBetaChannelEnabled(enabled)
      } else {
        throw new Error('Failed to switch beta channel')
      }
    } catch (err) {
      console.error('Beta channel toggle failed:', err)
      // Revert the toggle state
      setBetaChannelEnabled(!enabled)
    } finally {
      setBetaSwitching(false)
    }
  }

  const handleFeedbackSubmit = async () => {
    if (!feedbackTitle.trim() || !feedbackDescription.trim()) return
    
    setFeedbackSubmitting(true)
    setFeedbackResult(null)
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: feedbackType,
          title: feedbackTitle,
          description: feedbackDescription,
          include_logs: false
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        setFeedbackResult({
          status: data.status,
          url: data.issue_url,
          message: data.message
        })
        // Clear form on success
        if (data.status === 'success') {
          setFeedbackTitle('')
          setFeedbackDescription('')
        }
      } else {
        throw new Error(t('settings.feedbackFailed'))
      }
    } catch (err) {
      setFeedbackResult({
        status: 'error',
        message: err instanceof Error ? err.message : t('settings.feedbackFailed')
      })
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="shrink-0"
          title={t('common.back')}
        >
          <CaretLeft size={22} weight="bold" />
        </Button>
        <div>
          <h2 className="text-xl font-bold">{t('settings.title')}</h2>
          {versionInfo?.version && (
            <p className="text-xs text-muted-foreground">v{versionInfo.version.replace(/^v/, '')}</p>
          )}
        </div>
        {/* Auto-save indicator */}
        <AnimatePresence>
          {autoSaveStatus === 'saved' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="ml-auto"
            >
              <CheckCircle size={18} className="text-success" weight="fill" />
            </motion.div>
          )}
          {autoSaveStatus === 'error' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="ml-auto"
            >
              <Warning size={18} className="text-destructive" weight="fill" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* About Section - Collapsible, collapsed by default */}
      <Card className="p-6 space-y-4">
        <button
          onClick={() => setAboutExpanded(!aboutExpanded)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={aboutExpanded}
          aria-controls="about-content"
        >
          <h3 className="text-lg font-semibold text-primary">{t('settings.aboutMeticAI')}</h3>
          {aboutExpanded ? (
            <CaretUp size={20} className="text-muted-foreground" />
          ) : (
            <CaretDown size={20} className="text-muted-foreground" />
          )}
        </button>
        
        <AnimatePresence>
          {aboutExpanded && (
            <motion.div
              id="about-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden space-y-4"
            >
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('settings.aboutDescription1')}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('settings.aboutDescription2')}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open('https://github.com/hessius/MeticAI', '_blank')}
              >
                <GithubLogo size={18} className="mr-2" weight="bold" />
                {t('settings.viewOnGitHub')}
              </Button>

              {/* Powered By */}
              <div className="pt-3 border-t border-border/50">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                  {t('settings.poweredBy')}
                </h4>
                <div className="space-y-1.5">
                  <a
                    href="https://github.com/MeticulousHome/pyMeticulous"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <GithubLogo size={14} weight="bold" />
                    <span><strong>pyMeticulous</strong> — {t('settings.credits.pyMeticulous')}</span>
                  </a>
                  <a
                    href="https://github.com/twchad/meticulous-mcp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <GithubLogo size={14} weight="bold" />
                    <span><strong>meticulous-mcp</strong> — {t('settings.credits.meticulousMcp')}</span>
                  </a>
                  <a
                    href="https://github.com/nickwilsonr/meticulous-addon"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <GithubLogo size={14} weight="bold" />
                    <span><strong>meticulous-addon</strong> — {t('settings.credits.meticulousAddon')}</span>
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Configuration Section */}
      <Card className="p-6 space-y-5">
        <h3 className="text-lg font-semibold text-primary">{t('settings.configuration')}</h3>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">{t('settings.loadingSettings')}</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Language Selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t('settings.language.label')}
              </Label>
              <LanguageSelector variant="outline" showLabel={true} />
            </div>

            {/* AI Settings — CollapsibleSection */}
            <CollapsibleSection title={t('settings.aiSettings')} defaultOpen={false}>
              <p className="text-xs text-muted-foreground">{t('settings.aiAssistantDescription')}</p>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-enabled-toggle" className="text-sm font-medium">{t('settings.enableAiFeatures')}</Label>
                  <p className="text-xs text-muted-foreground">{t('settings.enableAiFeaturesDescription')}</p>
                </div>
                <Switch
                  id="ai-enabled-toggle"
                  checked={aiEnabled}
                  onCheckedChange={(checked) => {
                    const next = checked as boolean
                    setAiEnabledState(next)
                    setAiEnabled(next)
                  }}
                  disabled={!hasGeminiKey}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="apiKey" className="text-sm font-medium">
                    {t('settings.geminiApiKey')}
                  </Label>
                  {hasGeminiKey && (
                    <span className="text-xs text-success flex items-center gap-1">
                      <CheckCircle size={12} weight="fill" />
                      {t('settings.configured')}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type="password"
                    value={settings.geminiApiKey}
                    onChange={(e) => handleChange('geminiApiKey', e.target.value)}
                    placeholder={hasGeminiKey ? t('settings.apiKeyPlaceholderNew') : t('settings.apiKeyPlaceholder')}
                    className="pr-10"
                    readOnly={settings.geminiApiKeyMasked && settings.geminiApiKey.startsWith('*')}
                    onClick={() => {
                      if (settings.geminiApiKeyMasked && settings.geminiApiKey.startsWith('*')) {
                        handleChange('geminiApiKey', '')
                      }
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasGeminiKey
                    ? t('settings.apiKeyConfiguredExtended')
                    : <>{t('settings.aiAssistantOptional')} {t('settings.getApiKey')}{' '}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {t('settings.googleAIStudio')}
                      </a>
                    </>
                  }
                </p>
              </div>

              {/* Gemini Model */}
              <div className="space-y-2">
                <Label htmlFor="geminiModel" className="text-sm font-medium">
                  {t('settings.geminiModel')}
                </Label>
                <select
                  id="geminiModel"
                  value={settings.geminiModel || 'gemini-2.5-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="gemini-2.5-flash">{t('settings.geminiModel25Flash')}</option>
                  <option value="gemini-2.5-pro">{t('settings.geminiModel25Pro')}</option>
                  <option value="gemini-2.0-flash">{t('settings.geminiModel20Flash')}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {t('settings.geminiModelDescription')}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="hide-ai-toggle" className="text-sm font-medium">{t('settings.hideAiWhenUnavailable')}</Label>
                  <p className="text-xs text-muted-foreground">{t('settings.hideAiWhenUnavailableDescription')}</p>
                </div>
                <Switch
                  id="hide-ai-toggle"
                  checked={hideAiWhenUnavailable}
                  onCheckedChange={(checked) => {
                    const next = checked as boolean
                    setHideAiWhenUnavailableState(next)
                    setHideAiWhenUnavailable(next)
                  }}
                />
              </div>
            </CollapsibleSection>

            {/* Meticulous IP — hidden in direct mode (IP is implicit), but shown in native mode */}
            {(!isDirectMode() || isNativePlatform()) && (
            <div className="space-y-2">
              <Label htmlFor="meticulousIp" className="text-sm font-medium">
                {t('settings.meticulousIp')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="meticulousIp"
                  type="text"
                  value={settings.meticulousIp}
                  onChange={(e) => handleChange('meticulousIp', e.target.value)}
                  placeholder={t('settings.meticulousIpPlaceholder')}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={handleDetectMachine}
                  disabled={isDetecting}
                  className="shrink-0"
                >
                  {isDetecting ? (
                    <ArrowsClockwise className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <WifiHigh className="w-4 h-4 mr-1" />
                      {t('settings.detect')}
                    </>
                  )}
                </Button>
              </div>
              {detectResult && (
                <div className={`text-xs p-2 rounded ${detectResult.found ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'}`}>
                  {detectResult.found ? (
                    <span>
                      <CheckCircle className="w-3 h-3 inline mr-1" />
                      {t('settings.machineFound', { hostname: detectResult.hostname || detectResult.ip })}
                    </span>
                  ) : (
                    <div className="space-y-1">
                      <span className="font-medium">{t(`settings.discovery.${detectResult.guidance_key || 'notFound'}`)}</span>
                      {detectResult.guidance_hints && detectResult.guidance_hints.length > 0 && (
                        <ul className="list-disc list-inside text-[11px] space-y-0.5 ml-1">
                          {detectResult.guidance_hints.map((hint) => (
                            <li key={hint}>{t(`settings.discovery.${hint}`)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('settings.meticulousIpDescription')}
              </p>
            </div>
            )}

            {/* Author Name */}
            <div className="space-y-2">
              <Label htmlFor="authorName" className="text-sm font-medium">
                {t('settings.authorName')}
              </Label>
              <Input
                id="authorName"
                type="text"
                value={settings.authorName}
                onChange={(e) => handleChange('authorName', e.target.value)}
                placeholder={t('settings.authorNamePlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.authorNameDescription')}
              </p>
            </div>

            {/* MQTT Bridge */}
            {hasFeature('bridgeStatus') && <CollapsibleSection
              title={t('settings.mqttBridge')}
              trailing={
                <a
                  href="https://github.com/hessius/MeticAI/blob/main/HOME_ASSISTANT.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title={t('settings.homeAssistantGuide')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Question size={14} weight="bold" />
                </a>
              }
            >
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="mqtt-toggle" className="text-sm font-medium">
                    {t('settings.mqttEnabled')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.mqttEnabledDescription')}
                  </p>
                </div>
                <Switch
                  id="mqtt-toggle"
                  checked={settings.mqttEnabled}
                  onCheckedChange={(checked) => {
                    setSettings(prev => {
                      const next = { ...prev, mqttEnabled: checked as boolean }
                      debouncedSave(next)
                      return next
                    })
                  }}
                />
              </div>
              {settings.mqttEnabled && (
                <div className="space-y-2 pt-1">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open('https://my.home-assistant.io/redirect/config_flow_start?domain=mqtt', '_blank')}
                  >
                    <House size={18} className="mr-2" weight="bold" />
                    {t('settings.addToHomeAssistant')}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.homeAssistantDescription')}
                  </p>
                </div>
              )}

              <div className="space-y-2 pt-1 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Meticulous Add-on</h4>
                  <a
                    href="https://github.com/nickwilsonr/meticulous-addon"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    GitHub
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  Copy these snippets to install or update the addon manually in the running container.
                </p>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 flex items-start gap-2">
                  <Code size={14} className="mt-0.5 text-muted-foreground shrink-0" weight="bold" />
                  <code className="text-[11px] leading-relaxed text-foreground break-all flex-1">{METICULOUS_ADDON_INSTALL_SNIPPET}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopyText(METICULOUS_ADDON_INSTALL_SNIPPET)}
                    title="Copy install command"
                  >
                    <Copy size={13} />
                  </Button>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 flex items-start gap-2">
                  <Code size={14} className="mt-0.5 text-muted-foreground shrink-0" weight="bold" />
                  <code className="text-[11px] leading-relaxed text-foreground break-all flex-1">{METICULOUS_ADDON_UPDATE_SNIPPET}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopyText(METICULOUS_ADDON_UPDATE_SNIPPET)}
                    title="Copy update command"
                  >
                    <Copy size={13} />
                  </Button>
                </div>
              </div>
            </CollapsibleSection>}

            {/* Appearance */}
            {(onToggleBlobs !== undefined || onToggleTheme !== undefined || onSetPlatformTheme !== undefined) && (
              <CollapsibleSection title={t('appearance.title')} defaultOpen={false}>
                {/* Theme toggle */}
                {onToggleTheme !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="theme-toggle" className="text-sm font-medium">
                        {t('appearance.useLightMode')}
                      </Label>
                      <p className="text-xs text-muted-foreground">{t('appearance.lightModeDescription')}</p>
                    </div>
                    <Switch
                      id="theme-toggle"
                      checked={!isDark}
                      onCheckedChange={onToggleTheme}
                    />
                  </div>
                )}

                {/* Follow system setting */}
                {onSetFollowSystem !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="system-theme-toggle" className="text-sm font-medium">{t('appearance.followSystemTheme')}</Label>
                      <p className="text-xs text-muted-foreground">{t('appearance.followSystemDescription')}</p>
                    </div>
                    <Switch
                      id="system-theme-toggle"
                      checked={isFollowSystem}
                      onCheckedChange={(checked) => onSetFollowSystem(checked as boolean)}
                    />
                  </div>
                )}

                {/* Background blobs */}
                {onToggleBlobs !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="blob-toggle" className="text-sm font-medium">{t('appearance.backgroundAnimations')}</Label>
                      <p className="text-xs text-muted-foreground">{t('appearance.animationsDescription')}</p>
                    </div>
                    <Switch
                      id="blob-toggle"
                      checked={showBlobs}
                      onCheckedChange={onToggleBlobs}
                    />
                  </div>
                )}

                {/* Platform theme — temporarily hidden while Konsta UI layout issues are resolved */}
                {/* {onSetPlatformTheme !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="platform-theme-select" className="text-sm font-medium">{t('appearance.platformTheme')}</Label>
                      <p className="text-xs text-muted-foreground">{t('appearance.platformThemeDescription')}</p>
                    </div>
                    <Select
                      value={platformTheme ?? 'auto'}
                      onValueChange={(value) => onSetPlatformTheme(value as PlatformTheme)}
                    >
                      <SelectTrigger id="platform-theme-select" className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t('appearance.platformThemeAuto')}</SelectItem>
                        <SelectItem value="ios">{t('appearance.platformThemeIos')}</SelectItem>
                        <SelectItem value="material">{t('appearance.platformThemeMaterial')}</SelectItem>
                        <SelectItem value="none">{t('appearance.platformThemeNone')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )} */}

                {/* Konsta UI toggle — temporarily hidden while Konsta UI layout issues are resolved */}
                {/* <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="konsta-ui-toggle" className="text-sm font-medium">{t('appearance.useKonstaUi')}</Label>
                    <p className="text-xs text-muted-foreground">{t('appearance.useKonstaUiDescription')}</p>
                  </div>
                  <Switch
                    id="konsta-ui-toggle"
                    checked={useKonstaUi}
                    onCheckedChange={setUseKonstaUi}
                  />
                </div> */}

              </CollapsibleSection>
            )}

            {/* Remote Access (Tailscale) — hidden in direct/PWA mode */}
            {hasFeature('tailscaleConfig') && (
              <CollapsibleSection
                title={t('settings.tailscale.title')}
                trailing={
                  <>
                    {tailscaleStatus?.connected && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">{t('settings.tailscale.connected')}</span>
                      </div>
                    )}
                    <a
                      href="https://github.com/hessius/MeticAI/blob/main/TAILSCALE.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title={t('settings.tailscale.setupGuide')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Question size={14} weight="bold" />
                    </a>
                  </>
                }
              >
                {/* External URL — prominent when connected */}
                {tailscaleStatus?.connected && tailscaleStatus.external_url && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <LinkIcon size={16} className="text-primary" weight="bold" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('settings.tailscale.remoteUrl')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a 
                        href={tailscaleStatus.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-primary hover:underline break-all flex-1"
                      >
                        {tailscaleStatus.external_url}
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={() => {
                          navigator.clipboard.writeText(tailscaleStatus.external_url!)
                        }}
                        title={t('settings.tailscale.copyUrl')}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Enable/disable toggle */}
                <div className="flex items-center justify-between py-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="tailscale-toggle" className="text-sm font-medium">
                      {t('settings.tailscale.enableLabel')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.tailscale.enableDescription')}
                    </p>
                  </div>
                  <Switch
                    id="tailscale-toggle"
                    checked={tailscaleStatus?.enabled ?? false}
                    onCheckedChange={(checked) => handleTailscaleToggle(checked as boolean)}
                    disabled={tailscaleSaving}
                  />
                </div>
                
                {/* Auth key input — show when enabled */}
                {tailscaleStatus?.enabled && (
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="tailscale-auth-key" className="text-sm font-medium">
                          {t('settings.tailscale.authKeyLabel')}
                        </Label>
                        {tailscaleStatus.auth_key_configured && (
                          <span className="text-xs text-success flex items-center gap-1">
                            <CheckCircle size={12} weight="fill" />
                            {t('settings.configured')}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id="tailscale-auth-key"
                          type="password"
                          value={tailscaleAuthKey}
                          onChange={(e) => setTailscaleAuthKey(e.target.value)}
                          placeholder={tailscaleStatus.auth_key_configured 
                            ? t('settings.tailscale.authKeyPlaceholderExisting')
                            : t('settings.tailscale.authKeyPlaceholder')
                          }
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          onClick={handleTailscaleAuthKeySave}
                          disabled={tailscaleSaving || !tailscaleAuthKey.trim()}
                        >
                          <Key size={16} className="mr-1.5" weight="bold" />
                          {t('settings.tailscale.saveKey')}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.tailscale.authKeyDescription')}{' '}
                        <a 
                          href="https://login.tailscale.com/admin/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {t('settings.tailscale.getAuthKey')}
                        </a>
                      </p>
                    </div>
                  </div>
                )}

                {/* Connection status details — show when enabled */}
                {tailscaleStatus?.enabled && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">{t('settings.tailscale.status')}</span>
                      <div className="flex items-center gap-2">
                        {tailscaleStatus.connected ? (
                          <WifiHigh size={16} className="text-green-500" weight="bold" />
                        ) : tailscaleStatus.installed ? (
                          <WifiSlash size={16} className="text-yellow-500" weight="bold" />
                        ) : (
                          <WifiSlash size={16} className="text-muted-foreground" weight="bold" />
                        )}
                        <span className="text-sm">
                          {tailscaleStatus.connected 
                            ? t('settings.tailscale.connected')
                            : tailscaleStatus.installed
                              ? t('settings.tailscale.disconnected')
                              : t('settings.tailscale.notRunning')
                          }
                        </span>
                      </div>
                    </div>
                    
                    {tailscaleStatus.hostname && (
                      <div className="flex justify-between items-center py-1.5">
                        <span className="text-sm text-muted-foreground">{t('settings.tailscale.hostname')}</span>
                        <span className="text-sm font-mono">{tailscaleStatus.hostname}</span>
                      </div>
                    )}
                    
                    {tailscaleStatus.ip && (
                      <div className="flex justify-between items-center py-1.5">
                        <span className="text-sm text-muted-foreground">{t('settings.tailscale.ip')}</span>
                        <span className="text-sm font-mono">{tailscaleStatus.ip}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Auth key expired warning */}
                {tailscaleStatus?.auth_key_expired && (
                  <>
                    <Alert className="bg-yellow-500/10 border-yellow-500/20">
                      <Warning size={16} className="text-yellow-600" weight="fill" />
                      <AlertDescription className="text-sm text-yellow-700 dark:text-yellow-400">
                        {t('settings.tailscale.authKeyExpired')}
                      </AlertDescription>
                    </Alert>
                    {tailscaleStatus.login_url && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => window.open(tailscaleStatus.login_url!, '_blank')}
                      >
                        <Globe size={18} className="mr-2" />
                        {t('settings.tailscale.renewKey')}
                      </Button>
                    )}
                  </>
                )}
                
                {/* Setup guide — show when enabled but not connected */}
                {tailscaleStatus?.enabled && !tailscaleStatus?.connected && !tailscaleStatus?.auth_key_expired && (
                  <div className="rounded-md bg-muted/50 p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{t('settings.tailscale.setupTitle')}</p>
                    <ol className="text-xs text-muted-foreground/80 space-y-1 list-decimal list-inside">
                      <li>{t('settings.tailscale.setupStep1')}</li>
                      <li>{t('settings.tailscale.setupStep2')}</li>
                      <li>{t('settings.tailscale.setupStep3')}</li>
                    </ol>
                  </div>
                )}

                {/* Remote access guide — show when connected */}
                {tailscaleStatus?.connected && (
                  <div className="rounded-md bg-muted/50 p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{t('settings.tailscale.guideTitle')}</p>
                    <ol className="text-xs text-muted-foreground/80 space-y-1 list-decimal list-inside">
                      <li>{t('settings.tailscale.guideStep1')}</li>
                      <li>{t('settings.tailscale.guideStep2')}</li>
                      <li>
                        {t('settings.tailscale.guideStep3')}{' '}
                        {tailscaleStatus.external_url && (
                          <a 
                            href={tailscaleStatus.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-primary hover:underline"
                          >
                            {tailscaleStatus.external_url}
                          </a>
                        )}
                      </li>
                    </ol>
                  </div>
                )}
                
                {/* Save status messages */}
                {tailscaleSaveStatus === 'success' && (
                  <Alert className="bg-success/10 border-success/20">
                    <CheckCircle size={16} className="text-success" weight="fill" />
                    <AlertDescription className="text-sm text-success">
                      {tailscaleMessage}
                    </AlertDescription>
                  </Alert>
                )}
                
                {tailscaleSaveStatus === 'error' && (
                  <Alert variant="destructive">
                    <Warning size={16} weight="fill" />
                    <AlertDescription className="text-sm">
                      {tailscaleMessage}
                    </AlertDescription>
                  </Alert>
                )}
              </CollapsibleSection>
            )}

            {/* Beta Testing */}
            {hasFeature('watchtowerUpdate') && (
              <CollapsibleSection title={t('settings.beta.title')} defaultOpen={false}>
                {/* Beta channel toggle */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label htmlFor="beta-channel-switch" className="font-medium cursor-pointer">{t('settings.beta.enableUpdates')}</label>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.beta.enableDescription')}
                    </p>
                  </div>
                  <Switch
                    id="beta-channel-switch"
                    checked={betaChannelEnabled}
                    onCheckedChange={handleBetaChannelToggle}
                    disabled={betaSwitching}
                    aria-label={t('settings.beta.enableUpdates')}
                  />
                </div>

                {/* Warning about beta versions */}
                <Alert className="bg-yellow-500/10 border-yellow-500/30">
                  <Warning size={16} className="text-yellow-500" />
                  <AlertDescription className="text-sm">
                    {t('settings.beta.warning')}
                  </AlertDescription>
                </Alert>

                {/* Current channel indicator */}
                <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-muted/50">
                  <div className={`w-2 h-2 rounded-full ${betaChannelEnabled ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <span className="text-sm">
                    {t('settings.beta.currentChannel')}: <strong>{betaChannelEnabled ? 'Beta' : 'Stable'}</strong>
                  </span>
                </div>

                {/* Cross-channel notifications */}
                {showBetaAvailable && (
                  <Alert className="bg-blue-500/10 border-blue-500/30">
                    <Info size={16} className="text-blue-500" />
                    <AlertDescription className="text-sm">
                      {t('settings.beta.betaAvailable', { version: latestBetaVersion })}
                    </AlertDescription>
                  </Alert>
                )}

                {showStableCaughtUp && (
                  <Alert className="bg-green-500/10 border-green-500/30">
                    <CheckCircle size={16} className="text-green-500" />
                    <AlertDescription className="text-sm">
                      {t('settings.beta.stableCaughtUp', { version: latestStableVersion })}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Feedback section - only visible in beta mode */}
                {betaChannelEnabled && (
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <h4 className="font-medium">{t('settings.beta.sendFeedback')}</h4>
                    
                    {/* Feedback type selector */}
                    <div className="flex gap-2 flex-wrap">
                      {(['bug', 'feature', 'question', 'general'] as const).map((type) => (
                        <Button
                          key={type}
                          variant={feedbackType === type ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setFeedbackType(type)}
                        >
                          {t(`settings.beta.feedbackType.${type}`)}
                        </Button>
                      ))}
                    </div>

                    {/* Feedback form */}
                    <div className="space-y-2">
                      <Label htmlFor="feedback-title">{t('settings.beta.feedbackTitle')}</Label>
                      <Input
                        id="feedback-title"
                        value={feedbackTitle}
                        onChange={(e) => setFeedbackTitle(e.target.value)}
                        placeholder={t('settings.beta.feedbackTitlePlaceholder')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="feedback-description">{t('settings.beta.feedbackDescription')}</Label>
                      <textarea
                        id="feedback-description"
                        value={feedbackDescription}
                        onChange={(e) => setFeedbackDescription(e.target.value)}
                        placeholder={t('settings.beta.feedbackDescriptionPlaceholder')}
                        className="w-full h-24 px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                      />
                    </div>

                    <Button
                      onClick={handleFeedbackSubmit}
                      disabled={feedbackSubmitting || !feedbackTitle.trim() || !feedbackDescription.trim()}
                      className="w-full"
                    >
                      {feedbackSubmitting ? (
                        <ArrowClockwise size={18} className="animate-spin mr-2" />
                      ) : null}
                      {t('settings.beta.submitFeedback')}
                    </Button>

                    {/* Feedback result */}
                    {feedbackResult && (
                      <Alert className={feedbackResult.status === 'success' ? 'bg-green-500/10 border-green-500/30' : feedbackResult.status === 'error' ? 'bg-red-500/10 border-red-500/30' : 'bg-blue-500/10 border-blue-500/30'}>
                        {feedbackResult.status === 'success' ? (
                          <CheckCircle size={16} className="text-green-500" />
                        ) : feedbackResult.status === 'error' ? (
                          <Warning size={16} className="text-red-500" />
                        ) : null}
                        <AlertDescription className="text-sm">
                          {feedbackResult.message}
                          {feedbackResult.url && (
                            <a
                              href={feedbackResult.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block mt-1 text-primary hover:underline"
                            >
                              {t('settings.beta.viewOnGitHub')}
                            </a>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CollapsibleSection>
            )}

          </div>
        )}
      </Card>

      {/* Version & Changelog */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">
          {t('settings.versionAndChangelog')} — v{(versionInfo?.version || '...').replace(/^v/, '')}
        </h3>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-muted-foreground">{t('settings.version')}</span>
            <div className="text-right">
              <span className="text-sm font-mono">{versionInfo?.version || '...'}</span>
              {versionInfo?.commit && (
                <span className="text-xs text-muted-foreground/60 ml-1">({versionInfo.commit})</span>
              )}
            </div>
          </div>
        </div>

        {/* Changelog (collapsible) */}
        <div className="space-y-3 pt-2 border-t border-border/50">
          <button
            onClick={() => setChangelogExpanded(!changelogExpanded)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={changelogExpanded}
            aria-controls="changelog-content"
          >
            <span className="text-sm font-semibold text-muted-foreground">{t('settings.changelog')}</span>
            {changelogExpanded ? (
              <CaretUp size={16} className="text-muted-foreground" />
            ) : (
              <CaretDown size={16} className="text-muted-foreground" />
            )}
          </button>
          
          <AnimatePresence>
            {changelogExpanded && (
              <motion.div
                id="changelog-content"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {changelogLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <ArrowClockwise size={24} className="animate-spin text-muted-foreground" />
                  </div>
                ) : releaseNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.noReleaseNotes')}
                  </p>
                ) : (
                  <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                    {releaseNotes.map((note, index) => (
                      <div key={note.version} className="space-y-2">
                        {index > 0 && <div className="border-t border-border/50 pt-4" />}
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{note.version}</span>
                          <span className="text-xs text-muted-foreground">{note.date}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <MarkdownText>
                            {note.body.length > 500 
                              ? note.body.substring(0, 500) + '...' 
                              : note.body}
                          </MarkdownText>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Updates — hidden in direct/PWA mode (no Watchtower) */}
        {hasFeature('watchtowerUpdate') && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            <h4 className="text-sm font-semibold text-muted-foreground">{t('settings.updates')}</h4>
            
            {/* Update method indicator */}
            {updateMethod && (
              <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-muted/50">
                <div className={`w-2 h-2 rounded-full ${updateMethod.can_trigger_update ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <div className="flex-1">
                  <span className="text-xs font-medium">
                    {t(`settings.updateMethod.${updateMethod.method}`)}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t(`settings.updateMethod.${updateMethod.method}Description`)}
                  </p>
                  {updateMethod.watchtower_error && (
                    <p className="text-xs text-muted-foreground break-words mt-1">
                      {t('settings.updateMethod.watchtowerStatus')}: {updateMethod.watchtower_error}
                    </p>
                  )}
                </div>
              </div>
            )}
            
            {isUpdating ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowClockwise size={18} className="animate-spin text-primary" />
                  <span className="text-sm font-medium">{t('settings.updatingMeticAI')}</span>
                </div>
                <Progress value={updateProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {updateProgress < 30 && t('settings.startingUpdate')}
                  {updateProgress >= 30 && updateProgress < 60 && t('settings.pullingUpdates')}
                  {updateProgress >= 60 && updateProgress < 80 && t('settings.rebuildingContainers')}
                  {updateProgress >= 80 && t('settings.restartingServices')}
                </p>
              </div>
            ) : updateError ? (
              <Alert variant="destructive">
                <Warning size={16} weight="fill" />
                <AlertDescription className="text-sm">
                  {t('settings.updateFailed', { error: updateError })}
                </AlertDescription>
              </Alert>
            ) : updateAvailable ? (
              <Alert className="bg-primary/10 border-primary/30">
                <DownloadSimple size={16} className="text-primary" />
                <AlertDescription className="text-sm">
                  {t('settings.updateAvailable')}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('settings.latestVersion')}
              </p>
            )}
            
            <div className="flex gap-2">
              <Button
                onClick={handleUpdate}
                disabled={isUpdating || !updateAvailable || !canTriggerUpdate}
                variant="dark-brew"
                className="flex-1"
              >
                <DownloadSimple size={18} className="mr-2" />
                {updateAvailable ? t('settings.updateNow') : t('settings.noUpdatesAvailable')}
              </Button>
              <Button
                onClick={() => checkForUpdates()}
                disabled={isChecking || isUpdating}
                variant="outline"
                aria-label={t('settings.checkForUpdates')}
              >
                <ArrowClockwise size={18} className={isChecking ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* System Section */}
      {hasFeature('systemManagement') && <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">{t('settings.system')}</h3>
        
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('settings.restartDescription')}
          </p>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.open(`${window.location.origin}/docs`, '_blank')}
          >
            <Code size={18} className="mr-2" weight="bold" />
            {t('settings.apiDocs')}
          </Button>
          
          <Button
            onClick={handleRestart}
            disabled={isRestarting}
            variant="outline"
            className="w-full bg-destructive/15 border-destructive/25 backdrop-blur-md text-destructive dark:text-white hover:bg-destructive/25 hover:border-destructive/40"
          >
            {isRestarting ? (
              t('settings.restarting')
            ) : (
              <>
                <ArrowsClockwise size={18} className="mr-2" weight="bold" />
                {t('settings.restartMeticAI')}
              </>
            )}
          </Button>

          {restartStatus === 'success' && (
            <Alert className="bg-success/10 border-success/20">
              <CheckCircle size={16} className="text-success" weight="fill" />
              <AlertDescription className="text-sm text-success">
                {t('settings.restartTriggered')}
              </AlertDescription>
            </Alert>
          )}

          {restartStatus === 'error' && (
            <Alert variant="destructive">
              <Warning size={16} weight="fill" />
              <AlertDescription className="text-sm">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </Card>}

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground/50 pb-4 space-y-1">
        <p>{t('settings.footer')}</p>
        <p>
          {t('settings.runsOn')}{' '}
          <a href="https://github.com/MeticulousHome/pyMeticulous" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">pyMeticulous</a>,{' '}
          <a href="https://github.com/twchad/meticulous-mcp" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">meticulous-mcp</a>,{' '}
          <a href="https://github.com/nickwilsonr/meticulous-addon" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">meticulous-addon</a>,{' '}
          {t('settings.andCaffeine')}
        </p>
      </div>
    </motion.div>
  )
}
