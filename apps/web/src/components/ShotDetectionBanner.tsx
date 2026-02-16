/**
 * ShotDetectionBanner — a fixed-position notification bar that
 * appears at the top of any view when the machine starts brewing
 * (externally triggered shot, not initiated from MeticAI).
 *
 * Dismissed per-shot; resets when brewing ends.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Coffee, X } from '@phosphor-icons/react'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ShotDetectionBannerProps {
  visible: boolean
  onWatch: () => void
  onDismiss: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShotDetectionBanner({ visible, onWatch, onDismiss }: ShotDetectionBannerProps) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg"
        >
          <div className="flex items-center gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 backdrop-blur-md shadow-lg px-4 py-2.5">
            <Coffee size={18} weight="fill" className="text-blue-400 animate-pulse shrink-0" />
            <span className="text-sm font-medium text-foreground flex-1">
              {t('controlCenter.shotDetected.title')}
            </span>
            <Button
              variant="link"
              size="sm"
              className="px-2 h-auto text-xs text-blue-700 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
              onClick={onWatch}
            >
              {t('controlCenter.shotDetected.watch')}
            </Button>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={onDismiss}
              aria-label={t('common.dismiss')}
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
