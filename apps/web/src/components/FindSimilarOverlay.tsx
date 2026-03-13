import { useState, useEffect, useRef, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkle } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

interface Recommendation {
  profile_name: string
  score: number
  explanation: string
  match_reasons: string[]
}

interface FindSimilarOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileName: string
  onSelectProfile?: (profileName: string) => void
}

export function FindSimilarOverlay({
  open,
  onOpenChange,
  profileName,
  onSelectProfile,
}: FindSimilarOverlayProps) {
  const { t } = useTranslation()
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchSimilar = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    try {
      const serverUrl = await getServerUrl()
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('limit', '10')

      const response = await fetch(`${serverUrl}/api/profiles/find-similar`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) throw new Error('Failed to fetch similar profiles')
      const data = await response.json()
      if (!controller.signal.aborted) {
        setRecommendations(data.recommendations || [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!controller.signal.aborted) setRecommendations([])
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [profileName])

  useEffect(() => {
    if (open) {
      fetchSimilar()
    }
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [open, fetchSimilar])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle size={20} weight="fill" className="text-primary" />
            {t('profileRecommendations.findSimilar')}
          </DialogTitle>
          <DialogDescription>
            {t('profileRecommendations.similarTo', { name: profileName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label={t('a11y.loading')}>
              {[1, 2, 3, 4].map(i => (
                <Card key={i} className="p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t('profileRecommendations.noSimilar')}
            </p>
          ) : (
            <AnimatePresence mode="popLayout">
              {recommendations.map((rec, idx) => (
                <motion.div
                  key={rec.profile_name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, delay: idx * 0.05 }}
                >
                  <Card
                    className={`p-3 transition-colors ${onSelectProfile ? 'cursor-pointer hover:bg-secondary/40' : ''}`}
                    onClick={() => onSelectProfile?.(rec.profile_name)}
                    role={onSelectProfile ? 'button' : undefined}
                    tabIndex={onSelectProfile ? 0 : undefined}
                    onKeyDown={onSelectProfile ? (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProfile(rec.profile_name) } } : undefined}
                    aria-label={t('a11y.useProfile', { name: rec.profile_name })}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {Math.round(rec.score)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate">{rec.profile_name}</h4>
                        {rec.explanation && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {rec.explanation}
                          </p>
                        )}
                        {rec.match_reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {rec.match_reasons.map(reason => (
                              <Badge
                                key={reason}
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {reason}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <Badge
                        variant={rec.score >= 70 ? 'default' : rec.score >= 40 ? 'secondary' : 'outline'}
                        className="text-xs shrink-0"
                      >
                        {Math.round(rec.score)}%
                      </Badge>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
