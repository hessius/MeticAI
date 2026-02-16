/**
 * LastShotBanner — a dismissible prompt that appears on StartView
 * suggesting the user analyse their most recent shot.
 *
 * Visibility rules:
 *  • < 60 min → prominent card
 *  • 1–24 h   → subtle, muted card
 *  • > 24 h   → hidden
 *  • dismissed (sessionStorage) → hidden
 */
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Coffee, ArrowRight, X } from '@phosphor-icons/react'
import type { UseLastShotResult } from '@/hooks/useLastShot'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LastShotBannerProps {
  lastShot: UseLastShotResult
  onAnalyze: (date: string, filename: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LastShotBanner({ lastShot, onAnalyze }: LastShotBannerProps) {
  const { t } = useTranslation()

  if (!lastShot.lastShot || lastShot.dismissed || lastShot.minutesAgo === null) return null

  const { minutesAgo } = lastShot
  const shot = lastShot.lastShot

  // > 24 hours — don't show
  if (minutesAgo > 24 * 60) return null

  const isRecent = minutesAgo < 60
  const timeText = minutesAgo < 60
    ? t('controlCenter.lastShot.minutesAgo', { count: minutesAgo })
    : t('controlCenter.lastShot.hoursAgo', { count: Math.round(minutesAgo / 60) })

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -10, height: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card
        className={`p-4 mb-4 ${
          isRecent
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-muted bg-muted/30'
        }`}
      >
        <div className="flex items-start gap-3">
          <Coffee
            size={20}
            weight="duotone"
            className={isRecent ? 'text-amber-400 mt-0.5 shrink-0' : 'text-muted-foreground mt-0.5 shrink-0'}
          />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${isRecent ? 'text-foreground' : 'text-muted-foreground'}`}>
              {t('controlCenter.lastShot.title', { time: timeText })}
            </p>
            <p className="text-xs text-muted-foreground truncate">{shot.profile_name}</p>
            {isRecent && (
              <Button
                variant="link"
                size="sm"
                className="px-0 h-auto mt-1 text-xs text-amber-700 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300"
                onClick={() => onAnalyze(shot.date, shot.filename)}
              >
                {t('controlCenter.lastShot.analyze')}
                <ArrowRight size={12} className="ml-1" />
              </Button>
            )}
          </div>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={lastShot.dismiss}
            aria-label={t('common.dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      </Card>
    </motion.div>
  )
}
