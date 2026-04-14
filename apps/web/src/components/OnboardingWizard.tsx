/**
 * OnboardingWizard — First-run setup flow for Capacitor / direct-mode users.
 *
 * Guides the user through machine connection, identity, AI config,
 * language, and theme selection. All settings are also accessible
 * from SettingsView afterward.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  ArrowRight,
  ArrowLeft,
  WifiHigh,
  WifiSlash,
  CircleNotch,
  CheckCircle,
  Coffee,
  Sparkle,
  Sun,
  Moon,
  Monitor,
  User,
  Globe,
  Heart,
} from '@phosphor-icons/react'
import { MeticAILogo } from '@/components/MeticAILogo'
import { STORAGE_KEYS } from '@/lib/constants'
import { setMachineUrl, isDemoMode, isNativePlatform } from '@/lib/machineMode'
import { parseMachineInput, testMachineConnection, discoverMachines, type DiscoveredMachine } from '@/services/machine/discovery'
import { supportedLanguages, languageNames, type SupportedLanguage } from '@/i18n/config'
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference'
import { useScreenReaderAnnouncement } from '@/hooks/a11y/useScreenReader'
import { useHaptics } from '@/hooks/useHaptics'
import { useBrewNotifications } from '@/hooks/useBrewNotifications'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnboardingStep = 'welcome' | 'machine' | 'name' | 'ai' | 'language' | 'theme' | 'complete'

const STEPS: OnboardingStep[] = ['welcome', 'machine', 'name', 'ai', 'language', 'theme', 'complete']

interface OnboardingWizardProps {
  onComplete: () => void
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { t, i18n } = useTranslation()
  const { preference, isDark, setTheme } = useThemePreference()
  const announce = useScreenReaderAnnouncement()
  const { impact } = useHaptics()
  const { requestPermission } = useBrewNotifications()

  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = back

  // Machine connection
  const [machineIp, setMachineIp] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [machineName, setMachineName] = useState('')
  const [discoveredMachines, setDiscoveredMachines] = useState<DiscoveredMachine[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [showManualConfig, setShowManualConfig] = useState(false)

  // User identity
  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || ''
  )

  // AI setup
  const [geminiKey, setGeminiKey] = useState(
    () => localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || ''
  )

  // Language — default to English for onboarding regardless of browser locale
  const [selectedLang, setSelectedLang] = useState<SupportedLanguage>('en')

  // Ref for IP input auto-focus
  const ipInputRef = useRef<HTMLInputElement>(null)

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex) / (STEPS.length - 1)) * 100

  // Announce step changes for screen readers
  useEffect(() => {
    announce(t('onboarding.stepProgress', {
      current: stepIndex + 1,
      total: STEPS.length,
      step: t(`onboarding.steps.${step}`),
    }))
  }, [step, stepIndex, announce, t])

  // Auto-focus IP input when machine step appears
  useEffect(() => {
    if (step === 'machine') {
      setTimeout(() => ipInputRef.current?.focus(), 200)
    }
  }, [step])

  // Start machine discovery immediately on mount so results are ready
  // by the time user reaches the machine step
  useEffect(() => {
    let cancelled = false
    setDiscovering(true)
    discoverMachines().then((machines) => {
      if (cancelled) return
      setDiscoveredMachines(machines)
      setDiscovering(false)
    }).catch(() => {
      if (!cancelled) setDiscovering(false)
    })
    return () => { cancelled = true }
  }, [])

  // Auto-fill and test when discovery completes and user reaches machine step
  useEffect(() => {
    console.error(`[Onboarding] auto-fill check: step=${step} discovering=${discovering} connectionStatus=${connectionStatus} machines=${discoveredMachines.length} machineIp="${machineIp}"`)
    if (step !== 'machine' || discovering || connectionStatus === 'success') return
    if (discoveredMachines.length === 1 && !machineIp.trim()) {
      const machine = discoveredMachines[0]
      console.error(`[Onboarding] auto-fill: testing ${machine.url}`)
      setMachineIp(machine.host)
      setMachineName(machine.name)
      setConnectionStatus('testing')
      let cancelled = false
      testMachineConnection(machine.url).then((ok) => {
        console.error(`[Onboarding] auto-fill test result: ok=${ok} cancelled=${cancelled}`)
        if (cancelled) return
        if (ok) {
          setConnectionStatus('success')
          setMachineUrl(machine.url)
          toast.success(t('onboarding.machine.autoDiscovered'))
        } else {
          setConnectionStatus('idle')
        }
      }).catch((e) => {
        console.error(`[Onboarding] auto-fill test error:`, e)
        if (!cancelled) setConnectionStatus('idle')
      })
      return () => { cancelled = true }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, discovering, discoveredMachines])

  // ── Navigation ──────────────────────────────────────────────────────────

  const goTo = useCallback((target: OnboardingStep, dir: 1 | -1 = 1) => {
    impact('light')
    setDirection(dir)
    setStep(target)
  }, [impact])

  const next = useCallback(() => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) goTo(STEPS[idx + 1], 1)
  }, [step, goTo])

  const back = useCallback(() => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) goTo(STEPS[idx - 1], -1)
  }, [step, goTo])

  // ── Machine connection ──────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    const parsed = parseMachineInput(machineIp)
    if (!parsed) {
      toast.error(t('onboarding.machine.invalidIp'))
      return
    }
    setConnectionStatus('testing')
    try {
      const ok = await testMachineConnection(parsed.url)
      if (ok) {
        setConnectionStatus('success')
        setMachineName(parsed.name)
        setMachineUrl(parsed.url)
        toast.success(t('onboarding.machine.connected'))
      } else {
        setConnectionStatus('error')
        toast.error(t('onboarding.machine.unreachable'))
      }
    } catch {
      setConnectionStatus('error')
      toast.error(t('onboarding.machine.unreachable'))
    }
  }, [machineIp, t])

  // ── Save & complete ─────────────────────────────────────────────────────

  const handleComplete = useCallback(() => {
    // Persist all settings
    if (authorName.trim()) {
      localStorage.setItem(STORAGE_KEYS.AUTHOR_NAME, authorName.trim())
    }
    if (geminiKey.trim()) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, geminiKey.trim())
    }
    // Language already applied via i18n.changeLanguage
    // Theme already applied via useThemePreference
    // Machine URL already set via setMachineUrl on connection test

    // Request notification permission (non-blocking)
    requestPermission()

    // Mark onboarding complete
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true')

    onComplete()
  }, [authorName, geminiKey, onComplete, requestPermission])

  // ── Step renderers ──────────────────────────────────────────────────────

  const renderWelcome = () => (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <MeticAILogo size={80} variant={isDark ? 'white' : 'default'} />
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">{t('onboarding.welcome.title')}</h2>
        <p className="text-muted-foreground max-w-sm">
          {t('onboarding.welcome.description')}
        </p>
      </div>
      <Button size="lg" onClick={next} className="gap-2 mt-4">
        {t('onboarding.welcome.getStarted')}
        <ArrowRight weight="bold" />
      </Button>
    </div>
  )

  const renderMachine = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <WifiHigh size={24} weight="duotone" className="text-primary" />
        <div>
          <h3 className="font-semibold">{t('onboarding.machine.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('onboarding.machine.description')}</p>
        </div>
      </div>

      {/* Connection status indicator — shown prominently when connected */}
      {connectionStatus === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
          <CheckCircle size={18} weight="fill" />
          {t('onboarding.machine.successMessage', { name: machineName })}
        </div>
      )}

      {/* Auto-discovery and manual config — hidden when already connected */}
      {connectionStatus !== 'success' && (
        <>
          {/* Auto-discovery results */}
          {discovering && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={16} className="animate-spin" />
              {t('onboarding.machine.searching')}
            </div>
          )}
          {!discovering && discoveredMachines.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-500 dark:text-amber-400">
              <WifiSlash size={16} weight="fill" />
              {t('onboarding.machine.noMachinesFound')}
            </div>
          )}
          {!discovering && discoveredMachines.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">{t('onboarding.machine.foundMachines')}</Label>
              {discoveredMachines.map((m) => (
                <Button
                  key={m.url}
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setMachineIp(m.host)
                    setMachineName(m.name)
                    setConnectionStatus('testing')
                    testMachineConnection(m.url).then((ok) => {
                      if (ok) {
                        setConnectionStatus('success')
                        setMachineUrl(m.url)
                        toast.success(t('onboarding.machine.connected'))
                      } else {
                        setConnectionStatus('error')
                      }
                    })
                  }}
                >
                  <WifiHigh size={16} weight="duotone" className="text-green-500" />
                  {m.name} ({m.host}:{m.port})
                </Button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="machine-ip">{t('onboarding.machine.ipLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.machine.ipDescription')}
            </p>
            <div className="flex gap-2">
              <Input
                ref={ipInputRef}
                id="machine-ip"
                placeholder={t('onboarding.machine.ipPlaceholder')}
                value={machineIp}
                onChange={(e) => {
                  setMachineIp(e.target.value)
                  setConnectionStatus('idle')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleTestConnection()}
                className="flex-1"
              />
              <Button
                onClick={handleTestConnection}
                disabled={!machineIp.trim() || connectionStatus === 'testing'}
                variant="outline"
              >
                {connectionStatus === 'testing' ? (
                  <CircleNotch size={18} className="animate-spin" />
                ) : (
                  t('onboarding.machine.connectButton')
                )}
              </Button>
            </div>
          </div>

          {connectionStatus === 'error' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <WifiSlash size={18} weight="fill" />
              {t('onboarding.machine.errorMessage')}
            </div>
          )}
        </>
      )}

      {/* Manual config toggle when auto-connected */}
      {connectionStatus === 'success' && !showManualConfig && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
          onClick={() => setShowManualConfig(true)}
        >
          {t('onboarding.machine.configureManually')}
        </button>
      )}
      {connectionStatus === 'success' && showManualConfig && (
        <div className="space-y-2 pt-2 border-t border-border/50">
          <Label htmlFor="machine-ip">{t('onboarding.machine.ipLabel')}</Label>
          <div className="flex gap-2">
            <Input
              ref={ipInputRef}
              id="machine-ip"
              placeholder={t('onboarding.machine.ipPlaceholder')}
              value={machineIp}
              onChange={(e) => {
                setMachineIp(e.target.value)
                setConnectionStatus('idle')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleTestConnection()}
              className="flex-1"
            />
            <Button
              onClick={handleTestConnection}
              disabled={!machineIp.trim() || connectionStatus === 'testing'}
              variant="outline"
            >
              {connectionStatus === 'testing' ? (
                <CircleNotch size={18} className="animate-spin" />
              ) : (
                t('onboarding.machine.connectButton')
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('onboarding.machine.hint')}
          </p>
        </div>
      )}
    </div>
  )

  const renderName = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <User size={24} weight="duotone" className="text-primary" />
        <div>
          <h3 className="font-semibold">{t('onboarding.name.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('onboarding.name.description')}</p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="author-name">{t('onboarding.name.label')}</Label>
        <Input
          id="author-name"
          placeholder={t('onboarding.name.placeholder')}
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
        />
      </div>
    </div>
  )

  const renderAI = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Sparkle size={24} weight="duotone" className="text-primary" />
        <div>
          <h3 className="font-semibold">{t('onboarding.ai.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('onboarding.ai.description')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="gemini-key">{t('onboarding.ai.keyLabel')}</Label>
        <Input
          id="gemini-key"
          type="password"
          placeholder={t('onboarding.ai.keyPlaceholder')}
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t('onboarding.ai.keyHint')}
        </p>
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">{t('onboarding.ai.whatItDoes')}</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>{t('onboarding.ai.feature1')}</li>
          <li>{t('onboarding.ai.feature2')}</li>
          <li>{t('onboarding.ai.feature3')}</li>
        </ul>
      </div>
    </div>
  )

  const renderLanguage = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Globe size={24} weight="duotone" className="text-primary" />
        <div>
          <h3 className="font-semibold">{t('onboarding.language.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('onboarding.language.description')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {supportedLanguages.map((lang) => (
          <Button
            key={lang}
            variant={selectedLang === lang ? 'default' : 'outline'}
            className="justify-start gap-2"
            onClick={() => {
              setSelectedLang(lang)
              i18n.changeLanguage(lang)
            }}
          >
            {selectedLang === lang && <CheckCircle size={16} weight="fill" />}
            {languageNames[lang]}
          </Button>
        ))}
      </div>
    </div>
  )

  const renderTheme = () => {
    const themes: { value: ThemePreference; icon: typeof Sun; label: string }[] = [
      { value: 'light', icon: Sun, label: t('onboarding.theme.light') },
      { value: 'dark', icon: Moon, label: t('onboarding.theme.dark') },
      { value: 'system', icon: Monitor, label: t('onboarding.theme.system') },
    ]

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-2">
          {isDark ? (
            <Moon size={24} weight="duotone" className="text-primary" />
          ) : (
            <Sun size={24} weight="duotone" className="text-primary" />
          )}
          <div>
            <h3 className="font-semibold">{t('onboarding.theme.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('onboarding.theme.description')}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {themes.map(({ value, icon: Icon, label }) => (
            <Button
              key={value}
              variant={preference === value ? 'default' : 'outline'}
              className="flex-col gap-2 h-auto py-4"
              onClick={() => setTheme(value)}
            >
              <Icon size={24} weight={preference === value ? 'fill' : 'duotone'} />
              <span className="text-xs">{label}</span>
            </Button>
          ))}
        </div>
      </div>
    )
  }

  const renderComplete = () => (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <div className="rounded-full bg-primary/10 p-4">
        <Coffee size={48} weight="duotone" className="text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">{t('onboarding.complete.title')}</h2>
        <p className="text-muted-foreground max-w-sm">
          {t('onboarding.complete.description')}
        </p>
      </div>

      {/* Summary */}
      <div className="w-full max-w-sm rounded-lg bg-muted/50 p-4 text-sm text-left space-y-2">
        {connectionStatus === 'success' && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('onboarding.complete.machine')}</span>
            <span className="font-medium text-green-600 dark:text-green-400">{machineName || machineIp}</span>
          </div>
        )}
        {authorName.trim() && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('onboarding.complete.name')}</span>
            <span className="font-medium">{authorName}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('onboarding.complete.ai')}</span>
          <span className="font-medium">
            {geminiKey.trim() ? t('onboarding.complete.aiConfigured') : t('onboarding.complete.aiSkipped')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('onboarding.complete.language')}</span>
          <span className="font-medium">{languageNames[selectedLang]}</span>
        </div>
      </div>

      <Button size="lg" onClick={handleComplete} className="gap-2 mt-2">
        <Coffee weight="fill" />
        {t('onboarding.complete.startBrewing')}
      </Button>

      {!isDemoMode() && (
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
          onClick={() => {
            const url = 'https://buymeacoffee.com/HSUS'
            if (isNativePlatform()) {
              import('@capacitor/browser').then(({ Browser }) => Browser.open({ url })).catch(() => window.open(url, '_blank'))
            } else {
              window.open(url, '_blank')
            }
          }}
        >
          <Heart size={14} weight="fill" className="text-red-400" />
          {t('onboarding.complete.supportProject')}
        </button>
      )}

      <p className="text-xs text-muted-foreground">
        {t('onboarding.complete.settingsHint')}
      </p>
    </div>
  )

  const STEP_RENDERERS: Record<OnboardingStep, () => React.ReactNode> = {
    welcome: renderWelcome,
    machine: renderMachine,
    name: renderName,
    ai: renderAI,
    language: renderLanguage,
    theme: renderTheme,
    complete: renderComplete,
  }

  // Show back/next buttons for all steps except welcome and complete
  const showNavigation = step !== 'welcome' && step !== 'complete'
  const canProceed = step !== 'machine' || connectionStatus === 'success'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      {/* Progress bar — hidden on welcome and complete */}
      {step !== 'welcome' && step !== 'complete' && (
        <div className="w-full max-w-md mb-6">
          <Progress value={progress} className="h-1.5" />
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-muted-foreground">
              {t('onboarding.stepOf', { current: stepIndex, total: STEPS.length - 2 })}
            </span>
          </div>
        </div>
      )}

      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
            >
              {STEP_RENDERERS[step]()}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      {showNavigation && (
        <div className="flex items-center justify-between w-full max-w-md mt-4">
          <Button variant="ghost" onClick={back} className="gap-1">
            <ArrowLeft size={16} />
            {t('common.back')}
          </Button>

          <div className="flex gap-2">
            {/* Skip button for optional steps (name, ai) */}
            {(step === 'ai' || step === 'name') && (
              <Button variant="ghost" onClick={next} className="text-muted-foreground">
                {t('common.skip')}
              </Button>
            )}
            <Button onClick={next} disabled={!canProceed} className="gap-1">
              {t('common.next')}
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
