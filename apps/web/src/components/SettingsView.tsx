import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { 
  CaretLeft, 
  GithubLogo, 
  FloppyDisk, 
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
  Copy
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'
import { useUpdateTrigger } from '@/hooks/useUpdateTrigger'
import { MarkdownText } from '@/components/MarkdownText'
import { LanguageSelector } from '@/components/LanguageSelector'

interface SettingsViewProps {
  onBack: () => void
  showBlobs?: boolean
  onToggleBlobs?: () => void
  isDark?: boolean
  isFollowSystem?: boolean
  onToggleTheme?: () => void
  onSetFollowSystem?: (follow: boolean) => void
}

interface Settings {
  geminiApiKey: string
  meticulousIp: string
  authorName: string
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
  method: 'watchtower' | 'watcher' | 'manual'
  watchtower_running: boolean
  watcher_running: boolean
  can_trigger_update: boolean
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

export function SettingsView({ onBack, showBlobs, onToggleBlobs, isDark, isFollowSystem, onToggleTheme, onSetFollowSystem }: SettingsViewProps) {
  const { t } = useTranslation()
  
  const [settings, setSettings] = useState<Settings>({
    geminiApiKey: '',
    meticulousIp: '',
    authorName: '',
    mqttEnabled: true
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [restartStatus, setRestartStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  
  // Version info
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  
  // Changelog
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([])
  const [changelogExpanded, setChangelogExpanded] = useState(false)
  const [changelogLoading, setChangelogLoading] = useState(false)
  
  // About section
  const [aboutExpanded, setAboutExpanded] = useState(false)
  
  // Update functionality
  const { updateAvailable, checkForUpdates, isChecking } = useUpdateStatus()
  const { triggerUpdate, isUpdating, updateError } = useUpdateTrigger()
  const [updateProgress, setUpdateProgress] = useState(0)
  
  // Watcher status (legacy - now handled by updateMethod)
  
  // Update method detection
  const [updateMethod, setUpdateMethod] = useState<UpdateMethod | null>(null)
  
  // Tailscale status
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null)
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState('')
  const [tailscaleSaving, setTailscaleSaving] = useState(false)
  const [tailscaleSaveStatus, setTailscaleSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [tailscaleMessage, setTailscaleMessage] = useState('')

  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/settings`)
        if (response.ok) {
          const data = await response.json()
          setSettings({
            geminiApiKey: data.geminiApiKey || '',
            meticulousIp: data.meticulousIp || '',
            authorName: data.authorName || '',
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

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage('')

    try {
      const serverUrl = await getServerUrl()
      
      // Build the payload, only including fields that should be sent
      const payload: Record<string, string | boolean | undefined> = {
        authorName: settings.authorName,
        meticulousIp: settings.meticulousIp,
        mqttEnabled: settings.mqttEnabled,
      }
      
      // Only send API key if user actually typed a new value (not the masked stars)
      if (settings.geminiApiKey && !settings.geminiApiKey.startsWith('*')) {
        payload.geminiApiKey = settings.geminiApiKey
        payload.geminiApiKeyMasked = false
      }
      
      const response = await fetch(`${serverUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        let errorMsg = t('settings.settingsSaveFailed')
        try {
          const error = await response.json()
          errorMsg = error.detail?.message || error.detail || errorMsg
        } catch {
          // Use default message
        }
        throw new Error(errorMsg)
      }
    } catch (err) {
      setSaveStatus('error')
      setErrorMessage(err instanceof Error ? err.message : t('settings.settingsSaveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (field: keyof Settings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }))
    setSaveStatus('idle')
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
      } else {
        const error = await response.json()
        throw new Error(error.detail?.message || t('settings.restartFailed'))
      }
    } catch (err) {
      setRestartStatus('error')
      setErrorMessage(err instanceof Error ? err.message : t('settings.restartFailed'))
    } finally {
      setIsRestarting(false)
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
        <h2 className="text-xl font-bold">{t('settings.title')}</h2>
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

            {/* Gemini API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="apiKey" className="text-sm font-medium">
                  {t('settings.geminiApiKey')}
                </Label>
                {settings.geminiApiKeyConfigured && (
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
                  placeholder={settings.geminiApiKeyConfigured ? t('settings.apiKeyPlaceholderNew') : t('settings.apiKeyPlaceholder')}
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
                {settings.geminiApiKeyConfigured 
                  ? t('settings.apiKeyConfigured')
                  : <>{t('settings.getApiKey')}{' '}
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

            {/* Meticulous IP */}
            <div className="space-y-2">
              <Label htmlFor="meticulousIp" className="text-sm font-medium">
                {t('settings.meticulousIp')}
              </Label>
              <Input
                id="meticulousIp"
                type="text"
                value={settings.meticulousIp}
                onChange={(e) => handleChange('meticulousIp', e.target.value)}
                placeholder={t('settings.meticulousIpPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.meticulousIpDescription')}
              </p>
            </div>

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
            <div className="space-y-3 pt-2 border-t border-border">
              <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Control Center</h3>
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
                    setSettings(prev => ({ ...prev, mqttEnabled: checked as boolean }))
                    setSaveStatus('idle')
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
            </div>

            {/* Appearance */}
            {(onToggleBlobs !== undefined || onToggleTheme !== undefined) && (
              <div className="space-y-3 pt-2 border-t border-border">
                <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Appearance</h3>
                
                {/* Theme toggle */}
                {onToggleTheme !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="theme-toggle" className="text-sm font-medium">
                        {isDark ? 'Dark mode' : 'Light mode'}
                      </Label>
                      <p className="text-xs text-muted-foreground">Toggle between light and dark theme</p>
                    </div>
                    <Switch
                      id="theme-toggle"
                      checked={isDark}
                      onCheckedChange={onToggleTheme}
                    />
                  </div>
                )}

                {/* Follow system setting */}
                {onSetFollowSystem !== undefined && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="system-theme-toggle" className="text-sm font-medium">Follow system theme</Label>
                      <p className="text-xs text-muted-foreground">Automatically match your device settings</p>
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
                      <Label htmlFor="blob-toggle" className="text-sm font-medium">Background animations</Label>
                      <p className="text-xs text-muted-foreground">Animated ambient blobs behind content</p>
                    </div>
                    <Switch
                      id="blob-toggle"
                      checked={showBlobs}
                      onCheckedChange={onToggleBlobs}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Save Button */}
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? (
                t('settings.saving')
              ) : (
                <>
                  <FloppyDisk size={18} className="mr-2" weight="bold" />
                  {t('settings.saveSettings')}
                </>
              )}
            </Button>

            {/* Status Messages */}
            {saveStatus === 'success' && (
              <Alert className="bg-success/10 border-success/20">
                <CheckCircle size={16} className="text-success" weight="fill" />
                <AlertDescription className="text-sm text-success">
                  {t('settings.settingsSaved')}
                </AlertDescription>
              </Alert>
            )}

            {saveStatus === 'error' && (
              <Alert variant="destructive">
                <Warning size={16} weight="fill" />
                <AlertDescription className="text-sm">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </Card>

      {/* Changelog Section */}
      <Card className="p-6 space-y-4">
        <button
          onClick={() => setChangelogExpanded(!changelogExpanded)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={changelogExpanded}
          aria-controls="changelog-content"
        >
          <h3 className="text-lg font-semibold text-primary">{t('settings.changelog')}</h3>
          {changelogExpanded ? (
            <CaretUp size={20} className="text-muted-foreground" />
          ) : (
            <CaretDown size={20} className="text-muted-foreground" />
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
      </Card>

      {/* Remote Access (Tailscale) Section — always visible */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary">{t('settings.tailscale.title')}</h3>
          {tailscaleStatus?.connected && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">{t('settings.tailscale.connected')}</span>
            </div>
          )}
        </div>
        
        <div className="space-y-4">
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
        </div>
      </Card>

      {/* Version Info Section - Unified */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">{t('settings.versionInfo')}</h3>
        
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
      </Card>

      {/* Updates Section */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">{t('settings.updates')}</h3>
        
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
      </Card>

      {/* System Section */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">{t('settings.system')}</h3>
        
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('settings.restartDescription')}
          </p>
          
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
      </Card>

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
