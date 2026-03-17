import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { slideInRight, slideUp, snappySpring } from '@/lib/animations'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  CaretLeft,
  Warning,
  ChartLine,
  Clock,
  Drop,
  ArrowsCounterClockwise,
  Star,
  ChatText,
} from '@phosphor-icons/react'
import { formatDistanceToNow } from 'date-fns'
import type { ShotInfo } from '@/hooks/useShotHistory'
import { SearchingLoader } from './SearchingLoader'
import { formatShotTime } from './shotDataTransforms'

interface ShotListProps {
  shots: ShotInfo[]
  isLoading: boolean
  isBackgroundRefreshing: boolean
  error: string | null
  lastFetched: Date | null
  profileName: string
  annotationSummaries: Record<string, { has_annotation: boolean; rating: number | null }>
  onBack: () => void
  onSelectShot: (shot: ShotInfo) => void
  onRefresh: () => void
}

export function ShotList({
  shots,
  isLoading,
  isBackgroundRefreshing,
  error,
  lastFetched,
  profileName,
  annotationSummaries,
  onBack,
  onSelectShot,
  onRefresh,
}: ShotListProps) {
  const { t } = useTranslation()

  return (
    <motion.div
      variants={slideInRight}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={snappySpring}
    >
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
            aria-label={t('a11y.goBack')}
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
              <ChartLine size={22} className="text-primary" weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{t('shotHistory.title')}</h2>
                <Badge variant="secondary" className="shrink-0">
                  {t('shotHistory.shotsCount', { count: shots.length })}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground/70 break-words line-clamp-2">
                {profileName}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
            <Warning size={18} weight="fill" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* Background refresh indicator */}
        {isBackgroundRefreshing && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={snappySpring}
            className="space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ArrowsCounterClockwise size={12} className="animate-spin" weight="bold" />
                {t('shotHistory.checkingNewShots')}
              </span>
            </div>
            <Progress value={undefined} className="h-1" />
          </motion.div>
        )}

        {isLoading ? (
          <SearchingLoader estimatedSeconds={60} />
        ) : shots.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
              <ChartLine size={40} className="text-muted-foreground/40" weight="duotone" />
            </div>
            <p className="text-foreground/80 font-medium">{t('shotHistory.noShots')}</p>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              {t('shotHistory.noShotsDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 -mr-1" role="list" aria-label={t('shotHistory.title')}>
            <AnimatePresence>
              {shots.map((shot, index) => (
                <motion.div
                  key={`${shot.date}-${shot.filename}`}
                  variants={slideUp}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ ...snappySpring, delay: index * 0.02 }}
                  onClick={() => onSelectShot(shot)}
                  onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectShot(shot) } }}
                  className="group cursor-pointer"
                  role="listitem"
                  tabIndex={0}
                  aria-label={t('a11y.shotList.viewShot', { time: formatShotTime(shot) })}
                >
                  <div className="p-4 bg-secondary/40 hover:bg-secondary/70 rounded-xl border border-border/20 hover:border-border/40 transition-all duration-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                          {formatShotTime(shot)}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5">
                          {typeof shot.total_time === 'number' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock size={12} weight="bold" />
                              {shot.total_time.toFixed(1)}s
                            </span>
                          )}
                          {typeof shot.final_weight === 'number' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Drop size={12} weight="fill" />
                              {shot.final_weight.toFixed(1)}g
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(() => {
                          const key = `${shot.date}/${shot.filename}`
                          const summary = annotationSummaries[key]
                          return summary ? (
                            <>
                              {summary.rating && (
                                <span className="flex items-center gap-px">
                                  {Array.from({ length: 5 }, (_, i) => (
                                    <Star key={i} size={12} weight={i < summary.rating! ? "fill" : "regular"} className={i < summary.rating! ? "text-amber-400" : "text-muted-foreground/30"} />
                                  ))}
                                </span>
                              )}
                              {summary.has_annotation && (
                                <ChatText size={14} weight="fill" className="text-muted-foreground/50" />
                              )}
                            </>
                          ) : null
                        })()}
                        <ChartLine 
                          size={20} 
                          weight="bold" 
                          className="text-muted-foreground/40 group-hover:text-primary transition-colors" 
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        
        {/* Last Updated & Refresh */}
        {!isLoading && (
          <div className="pt-3 border-t border-border/20 space-y-2">
            {lastFetched && (
              <p className="text-xs text-muted-foreground/60 text-center">
                {t('shotHistory.lastUpdated', { time: formatDistanceToNow(lastFetched, { addSuffix: true }) })}
              </p>
            )}
            <Button
              variant="ghost"
              onClick={onRefresh}
              disabled={isBackgroundRefreshing}
              className="w-full h-9 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowsCounterClockwise size={16} weight="bold" className={`mr-2 ${isBackgroundRefreshing ? 'animate-spin' : ''}`} />
              {isBackgroundRefreshing ? t('shotHistory.refreshing') : t('shotHistory.checkForNewShots')}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
