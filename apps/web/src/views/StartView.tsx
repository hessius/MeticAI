import { motion, AnimatePresence } from 'framer-motion'
import { scaleIn, gentleSpring } from '@/lib/animations'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Drop, ChartLine, Crosshair } from '@phosphor-icons/react'
import { useIsMobile } from '@/hooks/use-mobile'

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
}: StartViewProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()

  // Action buttons content (shared between mobile and desktop layouts)
  const actionButtons = (
    <div className="space-y-2 lg:space-y-3">
      {/* Core actions — 2×3 grid on mobile, stacked on desktop */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-3">
        <Button
          onClick={onProfileCatalogue ?? onViewHistory}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <Coffee size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
          {t('navigation.profileCatalogue')}
        </Button>

        <Button
          onClick={onAddProfile}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <Plus size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="bold" />
          {t('navigation.addProfile')}
        </Button>

        <Button
          onClick={onRunShot}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <Play size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
          {t('navigation.runSchedule')}
        </Button>

        <Button
          onClick={onDialIn}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <Crosshair size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="bold" />
          {t('dialIn.title')}
        </Button>

        <Button
          onClick={onPourOver}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <Drop size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="fill" />
          {t('pourOver.title')}
        </Button>

        <Button
          onClick={onShotAnalysis}
          variant="dark-brew"
          className="w-full h-[4.5rem] lg:h-14 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap"
        >
          <ChartLine size={20} className="mr-1.5 lg:mr-2 shrink-0" weight="bold" />
          {t('navigation.shotAnalysis')}
        </Button>
      </div>
    </div>
  )

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
          {controlCenter}

          {/* Last-shot analysis prompt */}
          <AnimatePresence>
            {lastShotBanner}
          </AnimatePresence>

          <Card className="p-4">
            {actionButtons}
          </Card>
        </div>
      ) : (
        // Desktop: single card with all content
        <Card className="p-6 space-y-6">
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
