import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Gear } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

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
  onRunShot: () => void
  onSettings: () => void
}

export function StartView({
  profileCount,
  onGenerateNew,
  onViewHistory,
  onRunShot,
  onSettings
}: StartViewProps) {
  const { t } = useTranslation()
  const [firstName, setFirstName] = useState<string | undefined>(undefined)

  // Pick greeting ONCE on mount — stored in a ref so it never changes on re-render
  const greetingRef = useRef<string | null>(null)
  if (greetingRef.current === null) {
    greetingRef.current = pickGreeting(t)
  }

  useEffect(() => {
    const fetchAuthorName = async () => {
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

  const greeting = applyName(greetingRef.current, firstName)

  return (
    <motion.div
      key="start"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold tracking-tight text-foreground">{greeting}</h2>
          <p className="text-sm text-muted-foreground">
            {profileCount && profileCount > 0
              ? t('profileGeneration.youHaveProfiles', { count: profileCount })
              : t('profileGeneration.getStarted')}
          </p>
        </div>

        <div className="space-y-3">
          {/* Dark Brew — deep brown, gold text */}
          <Button
            onClick={onGenerateNew}
            variant="dark-brew"
            className="w-full h-14 text-base"
          >
            <Plus size={20} className="mr-2" weight="bold" />
            {t('navigation.generateNewProfile')}
          </Button>
          
          {/* Style 2: Dark Brew — deep brown, gold text */}
          <Button
            onClick={onViewHistory}
            variant="dark-brew"
            className="w-full h-14 text-base"
          >
            <Coffee size={20} className="mr-2" weight="fill" />
            {t('navigation.profileCatalogue')}
          </Button>
          
          {/* Dark Brew — deep brown, gold text */}
          <Button
            onClick={onRunShot}
            variant="dark-brew"
            className="w-full h-14 text-base"
          >
            <Play size={20} className="mr-2" weight="fill" />
            {t('navigation.runSchedule')}
          </Button>
          
          {/* Style 4: Ember — warm orange inner glow + border */}
          <Button
            onClick={onSettings}
            variant="ember"
            className="w-full h-14 text-base"
          >
            <Gear size={20} className="mr-2" weight="duotone" />
            {t('navigation.settings')}
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}
