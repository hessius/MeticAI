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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-3">
        <Button
          onClick={onProfileCatalogue ?? onViewHistory}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Coffee size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Coffee size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('navigation.profileCatalogue')}
        </Button>

        <Button
          onClick={onAddProfile}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Plus size={28} className="shrink-0 lg:hidden" weight="bold" />
          <Plus size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
          {t('navigation.addProfile')}
        </Button>

        <Button
          onClick={onRunShot}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Play size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Play size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('navigation.runSchedule')}
        </Button>

        <Button
          onClick={onDialIn}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Crosshair size={28} className="shrink-0 lg:hidden" weight="bold" />
          <Crosshair size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
          {t('dialIn.title')}
        </Button>

        <Button
          onClick={onPourOver}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <Drop size={28} className="shrink-0 lg:hidden" weight="fill" />
          <Drop size={20} className="shrink-0 hidden lg:block mr-2" weight="fill" />
          {t('pourOver.title')}
        </Button>

        <Button
          onClick={onShotAnalysis}
          variant="frosted"
          className="w-full h-[5.5rem] lg:h-16 flex flex-col items-center justify-center gap-1.5 lg:flex-row lg:gap-2 text-sm lg:text-base whitespace-normal lg:whitespace-nowrap !rounded-lg"
        >
          <ChartLine size={28} className="shrink-0 lg:hidden" weight="bold" />
          <ChartLine size={20} className="shrink-0 hidden lg:block mr-2" weight="bold" />
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
      className={isMobile ? 'flex flex-col min-h-[calc(100dvh-10rem)]' : ''}
    >
      {isMobile ? (
        // Mobile: CC at top, buttons centered in remaining space
        <>
          {controlCenter}

          {/* Last-shot analysis prompt */}
          <AnimatePresence>
            {lastShotBanner}
          </AnimatePresence>

          <div className="flex-1 flex flex-col justify-center p-1 mt-3">
            {actionButtons}
          </div>
        </>
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
