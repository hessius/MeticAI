import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Gear } from '@phosphor-icons/react'

function getTimeBasedGreeting(t: ReturnType<typeof import('react-i18next').useTranslation>['t']): string {
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
          <h2 className="text-xl font-bold tracking-tight text-foreground">{getTimeBasedGreeting(t)}</h2>
          <p className="text-sm text-muted-foreground">
            {profileCount && profileCount > 0
              ? t('profileGeneration.youHaveProfiles', { count: profileCount })
              : t('profileGeneration.getStarted')}
          </p>
        </div>

        <div className="space-y-3">
          <Button
            onClick={onGenerateNew}
            className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
          >
            <Plus size={20} className="mr-2" weight="bold" />
            {t('navigation.generateNewProfile')}
          </Button>
          
          <Button
            onClick={onViewHistory}
            className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
          >
            <Coffee size={20} className="mr-2" weight="fill" />
            {t('navigation.profileCatalogue')}
          </Button>
          
          <Button
            onClick={onRunShot}
            className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90"
          >
            <Play size={20} className="mr-2" weight="fill" />
            {t('navigation.runSchedule')}
          </Button>
          
          <Button
            onClick={onSettings}
            className="w-full h-14 text-base font-semibold bg-muted hover:bg-muted/80 text-foreground"
          >
            <Gear size={20} className="mr-2" weight="duotone" />
            {t('navigation.settings')}
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}
