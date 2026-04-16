import { motion, AnimatePresence } from 'framer-motion'
import { scaleIn, gentleSpring } from '@/lib/animations'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Coffee, Play, Drop, ChartLine, Crosshair } from '@phosphor-icons/react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSoundEffects } from '@/hooks/useSoundEffects'

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
  const { buttonClick: playButtonClick } = useSoundEffects()

  // Action buttons content (shared between mobile and desktop layouts)
  const actionButtons = (
    <div className="space-y-2 md:space-y-3">
      {/* Core actions — 2×3 grid on mobile, stacked on desktop */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-3">
        <Button
          onClick={() => { playButtonClick(); (onProfileCatalogue ?? onViewHistory)() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <Coffee size={28} className="shrink-0 md:hidden" weight="fill" />
          <Coffee size={20} className="shrink-0 hidden md:block mr-2" weight="fill" />
          {t('navigation.profileCatalogue')}
        </Button>

        <Button
          onClick={() => { playButtonClick(); onAddProfile() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <Plus size={28} className="shrink-0 md:hidden" weight="bold" />
          <Plus size={20} className="shrink-0 hidden md:block mr-2" weight="bold" />
          {t('navigation.addProfile')}
        </Button>

        <Button
          onClick={() => { playButtonClick(); onRunShot() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <Play size={28} className="shrink-0 md:hidden" weight="fill" />
          <Play size={20} className="shrink-0 hidden md:block mr-2" weight="fill" />
          {t('navigation.runSchedule')}
        </Button>

        <Button
          onClick={() => { playButtonClick(); onDialIn() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <Crosshair size={28} className="shrink-0 md:hidden" weight="bold" />
          <Crosshair size={20} className="shrink-0 hidden md:block mr-2" weight="bold" />
          {t('dialIn.title')}
        </Button>

        <Button
          onClick={() => { playButtonClick(); onPourOver() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <Drop size={28} className="shrink-0 md:hidden" weight="fill" />
          <Drop size={20} className="shrink-0 hidden md:block mr-2" weight="fill" />
          {t('pourOver.title')}
        </Button>

        <Button
          onClick={() => { playButtonClick(); onShotAnalysis() }}
          variant="frosted"
          className="w-full h-[5.5rem] md:h-16 flex flex-col items-center justify-center gap-1.5 md:flex-row md:gap-2 text-sm md:text-base whitespace-normal md:whitespace-nowrap !rounded-lg"
        >
          <ChartLine size={28} className="shrink-0 md:hidden" weight="bold" />
          <ChartLine size={20} className="shrink-0 hidden md:block mr-2" weight="bold" />
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
      className={isMobile ? 'flex flex-col min-h-[calc(100dvh-14rem)]' : ''}
    >
      {isMobile ? (
        // Mobile: CC at top, buttons centered in remaining space
        <>
          {controlCenter}

          {/* Last-shot analysis prompt */}
          <AnimatePresence>
            {lastShotBanner}
          </AnimatePresence>

          <div className="flex-1 flex flex-col justify-center p-1 mt-2 -mb-4">
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
