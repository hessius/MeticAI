import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { scaleIn, gentleSpring } from '@/lib/animations'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Gear, Drop, ChartLine, Crosshair } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { isDirectMode } from '@/lib/machineMode'

const IGNORED_NAMES = ['meticai', 'metic ai', 'gemini', 'admin', 'user', 'default']

function isValidAuthorName(name: string | undefined): name is string {
  if (!name) return false
  const trimmed = name.trim()
  if (!trimmed) return false
  return !IGNORED_NAMES.some(ignored => trimmed.toLowerCase().includes(ignored))
}

function pickGreeting(
  t: ReturnType<typeof import('react-i18next').useTranslation>['t'],
): string {
  const hour = new Date().getHours()
  let period: string
  
  if (hour >= 5 && hour < 12) {
    period = 'morning'
  } else if (hour >= 12 && hour < 17) {
    period = 'afternoon'
  } else {
    period = 'evening'
  }
  
  const result = t(`greetings.${period}`, { returnObjects: true })
  const greetings = Array.isArray(result) ? result as string[] : null
  if (!greetings || greetings.length === 0) {
    return 'Hello!'
  }
  return greetings[Math.floor(Math.random() * greetings.length)]
}

function applyName(greeting: string, firstName?: string): string {
  if (!firstName) return greeting
  return greeting.replace(/!$/, `, ${firstName}!`)
}

interface StartViewProps {
  profileCount: number | null
  onGenerateNew: () => void
  onViewHistory: () => void
  onProfileCatalogue?: () => void
  onRunShot: () => void
  onDialIn: () => void
  onPourOver: () => void
  onShotAnalysis: () => void
  onSettings: () => void
  aiConfigured?: boolean
  hideAiWhenUnavailable?: boolean
  controlCenter?: React.ReactNode
  lastShotBanner?: React.ReactNode
}

export function StartView({
  profileCount,
  onGenerateNew,
  onViewHistory,
  onProfileCatalogue,
  onRunShot,
  onDialIn,
  onPourOver,
  onShotAnalysis,
  onSettings,
  aiConfigured = true,
  hideAiWhenUnavailable = false,
  controlCenter,
  lastShotBanner,
}: StartViewProps) {
  const { t } = useTranslation()
  const [firstName, setFirstName] = useState<string | undefined>(undefined)

  // Pick greeting once per language — stable across re-renders, updates on locale change
  const greetingBase = useMemo(() => pickGreeting(t), [t])

  useEffect(() => {
    const fetchAuthorName = async () => {
      if (isDirectMode()) return // No MeticAI backend
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/settings`)
        if (response.ok) {
          const data = await response.json()
          const name = data.authorName?.trim()
          if (isValidAuthorName(name)) {
            setFirstName(name.split(/\s+/)[0])
          }
        }
      } catch {
        // Silently ignore — greeting will just omit the name
      }
    }
    fetchAuthorName()
  }, [])

  const greeting = applyName(greetingBase, firstName)

  return (
    <motion.div
      key="start"
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={gentleSpring}
    >
      <Card className="p-6 space-y-4 lg:space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold tracking-tight text-foreground">{greeting}</h2>
          <p className="text-sm text-muted-foreground">
            {profileCount && profileCount > 0
              ? t('profileGeneration.youHaveProfiles', { count: profileCount })
              : t('profileGeneration.getStarted')}
          </p>
        </div>

        {/* Control Center — machine status (mobile only, passed from App) */}
        {controlCenter}

        {/* Last-shot analysis prompt */}
        <AnimatePresence>
          {lastShotBanner}
        </AnimatePresence>

        <div className="space-y-2 lg:space-y-3">
          {/* Generate New — primary action, always full width */}
          {(!hideAiWhenUnavailable || aiConfigured) && (
            <Button
              onClick={onGenerateNew}
              disabled={!aiConfigured}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base"
            >
              <Plus size={20} className="mr-1.5 lg:mr-2" weight="bold" />
              {t('navigation.generateNewProfile')}
            </Button>
          )}

          {!aiConfigured && !hideAiWhenUnavailable && (
            <p className="text-xs text-muted-foreground text-center">
              {t('navigation.aiUnavailable')}
            </p>
          )}

          {/* Core actions — 2-col grid on mobile, stacked on desktop */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-3">
            <Button
              onClick={onProfileCatalogue ?? onViewHistory}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <Coffee size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
              {t('navigation.profileCatalogue')}
            </Button>

            <Button
              onClick={onRunShot}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <Play size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
              {t('navigation.runSchedule')}
            </Button>

            <Button
              onClick={onDialIn}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <Crosshair size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="bold" />
              {t('dialIn.title')}
            </Button>

            <Button
              onClick={onPourOver}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <Drop size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
              {t('pourOver.title')}
            </Button>

            <Button
              onClick={onShotAnalysis}
              variant="dark-brew"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <ChartLine size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="bold" />
              {t('navigation.shotAnalysis')}
            </Button>

            {/* Settings — ember accent, completes the 2×3 grid */}
            <Button
              onClick={onSettings}
              variant="ember"
              className="w-full h-12 lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
            >
              <Gear size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="duotone" />
              {t('navigation.settings')}
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
