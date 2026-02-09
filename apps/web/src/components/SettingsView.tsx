import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  CaretUp
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'
import { useUpdateTrigger } from '@/hooks/useUpdateTrigger'
import { MarkdownText } from '@/components/MarkdownText'

interface SettingsViewProps {
  onBack: () => void
}

interface Settings {
  geminiApiKey: string
  meticulousIp: string
  authorName: string
  geminiApiKeyMasked?: boolean
  geminiApiKeyConfigured?: boolean
}

interface VersionInfo {
  meticai: string
  meticaiWeb: string
  meticaiWebCommit?: string
  mcpServer: string
  mcpCommit?: string
  mcpRepoUrl: string
}

interface ReleaseNote {
  version: string
  date: string
  body: string
}

// Maximum expected update duration (3 minutes)
const MAX_UPDATE_DURATION = 180000
const PROGRESS_UPDATE_INTERVAL = 500

export function SettingsView({ onBack }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings>({
    geminiApiKey: '',
    meticulousIp: '',
    authorName: ''
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
  
  // Watcher status
  const [watcherStatus, setWatcherStatus] = useState<{ running: boolean; message: string } | null>(null)

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
    
    const loadWatcherStatus = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/watcher-status`)
        if (response.ok) {
          const data = await response.json()
          setWatcherStatus(data)
        }
      } catch (err) {
        console.error('Failed to load watcher status:', err)
      }
    }
    
    loadSettings()
    loadWatcherStatus()
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
            meticai: data.meticai || 'unknown',
            meticaiWeb: data.meticai_web || data.meticaiWeb || 'unknown',
            meticaiWebCommit: data.meticai_web_commit || undefined,
            mcpServer: data.mcp_server || data.mcpServer || 'unknown',
            mcpCommit: data.mcp_commit || undefined,
            mcpRepoUrl: data.mcp_repo_url || 'https://github.com/hessius/meticulous-mcp'
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
      const response = await fetch(`${serverUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      })

      if (response.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to save settings')
      }
    } catch (err) {
      setSaveStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save settings')
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
    if (!confirm('Are you sure you want to restart MeticAI? The system will be unavailable for a few seconds.')) {
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
        throw new Error(error.detail?.message || 'Failed to trigger restart')
      }
    } catch (err) {
      setRestartStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to restart')
    } finally {
      setIsRestarting(false)
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
          title="Back"
        >
          <CaretLeft size={22} weight="bold" />
        </Button>
        <h2 className="text-xl font-bold">Settings</h2>
      </div>

      {/* About Section - Collapsible, collapsed by default */}
      <Card className="p-6 space-y-4">
        <button
          onClick={() => setAboutExpanded(!aboutExpanded)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={aboutExpanded}
          aria-controls="about-content"
        >
          <h3 className="text-lg font-semibold text-primary">About MeticAI</h3>
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
                When I got my Meticulous, after a loooong wait, I was overwhelmed with the options — 
                dialing in was no longer just adjusting grind size, the potential was (and is) basically 
                limitless — my knowledge and time not so.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This, "MeticAI", is a growing set of AI tools to enable me, and you, to get the most 
                out of a Meticulous Espresso machine. Among other things it lets you automatically 
                create espresso profiles tailored to your preferences and coffee at hand, understand 
                your espresso profiles and shot data like never before, and ultimately — lets you 
                unleash your Meticulous.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open('https://github.com/hessius/MeticAI', '_blank')}
              >
                <GithubLogo size={18} className="mr-2" weight="bold" />
                View on GitHub
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Configuration Section */}
      <Card className="p-6 space-y-5">
        <h3 className="text-lg font-semibold text-primary">Configuration</h3>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-muted-foreground text-sm">Loading settings...</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Gemini API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="apiKey" className="text-sm font-medium">
                  Gemini API Key
                </Label>
                {settings.geminiApiKeyConfigured && (
                  <span className="text-xs text-success flex items-center gap-1">
                    <CheckCircle size={12} weight="fill" />
                    Configured
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="apiKey"
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(e) => handleChange('geminiApiKey', e.target.value)}
                  placeholder={settings.geminiApiKeyConfigured ? "Enter new key to change" : "Enter your Gemini API key"}
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
                  ? "API key is configured. Click the field to enter a new key."
                  : <>Get your API key from{' '}
                    <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Google AI Studio
                    </a>
                  </>
                }
              </p>
            </div>

            {/* Meticulous IP */}
            <div className="space-y-2">
              <Label htmlFor="meticulousIp" className="text-sm font-medium">
                Meticulous Machine IP
              </Label>
              <Input
                id="meticulousIp"
                type="text"
                value={settings.meticulousIp}
                onChange={(e) => handleChange('meticulousIp', e.target.value)}
                placeholder="e.g., 192.168.1.100"
              />
              <p className="text-xs text-muted-foreground">
                The IP address of your Meticulous espresso machine on your local network
              </p>
            </div>

            {/* Author Name */}
            <div className="space-y-2">
              <Label htmlFor="authorName" className="text-sm font-medium">
                Author Name
              </Label>
              <Input
                id="authorName"
                type="text"
                value={settings.authorName}
                onChange={(e) => handleChange('authorName', e.target.value)}
                placeholder="MeticAI"
              />
              <p className="text-xs text-muted-foreground">
                Your name for the author field in generated profile JSON. Defaults to "MeticAI" if left empty.
              </p>
            </div>

            {/* Save Button */}
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? (
                'Saving...'
              ) : (
                <>
                  <FloppyDisk size={18} className="mr-2" weight="bold" />
                  Save Settings
                </>
              )}
            </Button>

            {/* Status Messages */}
            {saveStatus === 'success' && (
              <Alert className="bg-success/10 border-success/20">
                <CheckCircle size={16} className="text-success" weight="fill" />
                <AlertDescription className="text-sm text-success">
                  Settings saved successfully!
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
          <h3 className="text-lg font-semibold text-primary">Changelog</h3>
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
                  No release notes available.
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

      {/* Version Info Section */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">Version Info</h3>
        
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">MeticAI (Backend)</span>
            <span className="text-sm font-mono">{versionInfo?.meticai || '...'}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border/50">
            <span className="text-sm text-muted-foreground">MeticAI-web (Frontend)</span>
            <span className="text-sm font-mono">{versionInfo?.meticaiWeb || '...'}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">MCP Server</span>
              <a 
                href={versionInfo?.mcpRepoUrl || '#'} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                {versionInfo?.mcpRepoUrl?.replace('https://github.com/', '') || 'hessius/meticulous-mcp'}
              </a>
            </div>
            <div className="text-right">
              <span className="text-sm font-mono">{versionInfo?.mcpServer || '...'}</span>
              {versionInfo?.mcpCommit && versionInfo.mcpServer !== versionInfo.mcpCommit && (
                <span className="text-xs text-muted-foreground/60 ml-1">({versionInfo.mcpCommit})</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Updates Section */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">Updates</h3>
        
        {isUpdating ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ArrowClockwise size={18} className="animate-spin text-primary" />
              <span className="text-sm font-medium">Updating MeticAI...</span>
            </div>
            <Progress value={updateProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {updateProgress < 30 && 'Starting update...'}
              {updateProgress >= 30 && updateProgress < 60 && 'Pulling latest updates...'}
              {updateProgress >= 60 && updateProgress < 80 && 'Rebuilding containers...'}
              {updateProgress >= 80 && 'Restarting services...'}
            </p>
          </div>
        ) : updateError ? (
          <Alert variant="destructive">
            <Warning size={16} weight="fill" />
            <AlertDescription className="text-sm">
              Update failed: {updateError}
            </AlertDescription>
          </Alert>
        ) : updateAvailable ? (
          <Alert className="bg-primary/10 border-primary/30">
            <DownloadSimple size={16} className="text-primary" />
            <AlertDescription className="text-sm">
              A new version of MeticAI is available!
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            You're running the latest version.
          </p>
        )}
        
        <div className="flex gap-2">
          <Button
            onClick={handleUpdate}
            disabled={isUpdating || !updateAvailable}
            className="flex-1"
          >
            <DownloadSimple size={18} className="mr-2" />
            {updateAvailable ? 'Update Now' : 'No Updates Available'}
          </Button>
          <Button
            onClick={() => checkForUpdates()}
            disabled={isChecking || isUpdating}
            variant="outline"
            aria-label="Check for updates"
          >
            <ArrowClockwise size={18} className={isChecking ? 'animate-spin' : ''} />
          </Button>
        </div>
      </Card>

      {/* System Section */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold text-primary">System</h3>
        
        <div className="space-y-3">
          {/* Watcher Status */}
          {watcherStatus && (
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${watcherStatus.running ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-muted-foreground">Background Watcher</span>
              </div>
              <span className={`text-xs ${watcherStatus.running ? 'text-green-600' : 'text-red-600'}`}>
                {watcherStatus.running ? 'Running' : 'Not Running'}
              </span>
            </div>
          )}
          
          {!watcherStatus?.running && watcherStatus && (
            <Alert className="bg-yellow-500/10 border-yellow-500/20">
              <Warning size={16} className="text-yellow-600" weight="fill" />
              <AlertDescription className="text-sm text-yellow-700">
                The background watcher is not running. Restart and update buttons may not work.
                Run <code className="bg-muted px-1 rounded">./rebuild-watcher.sh --install</code> on the host.
              </AlertDescription>
            </Alert>
          )}
          
          <p className="text-sm text-muted-foreground">
            Restart all MeticAI services. Use this if you're experiencing issues.
          </p>
          
          <Button
            onClick={handleRestart}
            disabled={isRestarting}
            variant="outline"
            className="w-full border-destructive/30 hover:border-destructive/50 hover:bg-destructive/5 text-destructive hover:text-destructive"
          >
            {isRestarting ? (
              'Restarting...'
            ) : (
              <>
                <ArrowsClockwise size={18} className="mr-2" weight="bold" />
                Restart MeticAI
              </>
            )}
          </Button>

          {restartStatus === 'success' && (
            <Alert className="bg-success/10 border-success/20">
              <CheckCircle size={16} className="text-success" weight="fill" />
              <AlertDescription className="text-sm text-success">
                Restart triggered! The system will restart momentarily.
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

      {/* Version Info Footer */}
      <div className="text-center text-xs text-muted-foreground/50 pb-4">
        MeticAI • Built with ❤️ for coffee lovers
      </div>
    </motion.div>
  )
}
