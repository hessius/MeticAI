import { motion, AnimatePresence } from 'framer-motion'
import { scaleIn, gentleSpring } from '@/lib/animations'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Drop, ChartLine, Crosshair } from '@phosphor-icons/react'
import { useIsMobile } from '@/hooks/use-mobile'
import type { SmartGreeting } from '@/hooks/useSmartGreeting'

interface StartViewProps {
  profileCount: number | null
  onAddProfile: () => void
  onViewHistory: () => void
  onProfileCatalogue?: () => void
  onRunShot: () => void
  onDialIn: () => void
  onPourOver: () => void
  onShotAnalysis: () => void
  controlCenter?: React.ReactNode
  lastShotBanner?: React.ReactNode
  greeting?: SmartGreeting | null
  onGreetingAction?: (target: string, context?: Record<string, string>) => void
}

export function StartView({
  onAddProfile,
  onViewHistory,
  onProfileCatalogue,
  onRunShot,
  onDialIn,
  onPourOver,
  onShotAnalysis,
  controlCenter,
  lastShotBanner,
  greeting,
  onGreetingAction,
}: StartViewProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()

  // Action buttons content (shared between mobile and desktop layouts)
  const actionButtons = (
    <div className="space-y-2 lg:space-y-3">
      {/* Core actions — 2×3 grid on mobile, stacked on desktop */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-1 lg:gap-3">
        <Button
          onClick={onProfileCatalogue ?? onViewHistory}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Coffee size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Coffee size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('navigation.profileCatalogue')}
        </Button>

        <Button
          onClick={onAddProfile}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Plus size={28} className="shrink-0 lg:hidden" weight="bold" />
          <Plus size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
          {t('navigation.addProfile')}
        </Button>

        <Button
          onClick={onRunShot}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Play size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Play size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('navigation.runSchedule')}
        </Button>

        <Button
          onClick={onDialIn}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Crosshair size={28} className="shrink-0 lg:hidden" weight="bold" />
          <Crosshair size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
          {t('dialIn.title')}
        </Button>

        <Button
          onClick={onPourOver}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Drop size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Drop size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('pourOver.title')}
        </Button>

        <Button
          onClick={onShotAnalysis}
          variant="dark-brew"
          className="w-full h-[6rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <ChartLine size={28} className="shrink-0 lg:hidden" weight="bold" />
          <ChartLine size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
          {t('navigation.shotAnalysis')}
        </Button>
      </div>
    </div>
  )

  const greetingElement = greeting ? (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-lg bg-muted/40 border border-border/30 px-3 py-2"
    >
      {greeting.action && onGreetingAction ? (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left w-full"
          onClick={() => onGreetingAction(greeting.action!.target, greeting.action!.context)}
        >
          {greeting.message}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">{greeting.message}</p>
      )}
    </motion.div>
  ) : null

  return (
    <motion.div
      key="start"
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={gentleSpring}
    >
      {isMobile ? (
        // Mobile: no wrapping card — control centre and buttons as separate cards
        <div className="space-y-3">
          {greetingElement}
          {controlCenter}

          {/* Last-shot analysis prompt */}
          <AnimatePresence>
            {lastShotBanner}
          </AnimatePresence>

          <div className="p-1">
            {actionButtons}
          </div>
        </div>
      ) : (
        // Desktop: single card with all content
        <Card className="p-6 space-y-6">
          {greetingElement}
          {controlCenter}

          <AnimatePresence>
            {lastShotBanner}
          </AnimatePresence>

          {actionButtons}
        </Card>
      )}
    </motion.div>
  )
}
