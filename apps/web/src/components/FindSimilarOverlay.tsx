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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkle, Info } from '@phosphor-icons/react'
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
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const [serverUrl, setServerUrl] = useState<string>('')

  useEffect(() => {
    getServerUrl().then(setServerUrl)
  }, [])

  const fetchSimilar = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setImageErrors(new Set())
    try {
      const url = serverUrl || await getServerUrl()
      if (!serverUrl && url) setServerUrl(url)
      const formData = new FormData()
      formData.append('profile_name', profileName)
      formData.append('limit', '10')

      const response = await fetch(`${url}/api/profiles/find-similar`, {
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
  }, [profileName, serverUrl])

  useEffect(() => {
    if (open) {
      fetchSimilar()
    }
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [open, fetchSimilar])

  const handleSelect = useCallback((name: string) => {
    onSelectProfile?.(name)
  }, [onSelectProfile])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle size={20} weight="fill" className="text-primary" />
            {t('profileRecommendations.findSimilar')}
          </DialogTitle>
          <DialogDescription>
            {t('profileRecommendations.similarTo', { name: profileName })}
          </DialogDescription>
        </DialogHeader>

        {/* AI Token Disclaimer */}
        <Alert className="bg-amber-500/10 border-amber-500/30">
          <Info size={16} weight="fill" className="text-amber-500" />
          <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
            {t('profileRecommendations.aiDisclaimer')}
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label={t('a11y.loading')}>
              {[1, 2, 3, 4].map(i => (
                <Card key={i} className="p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
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
                    className="p-2 sm:p-3 transition-colors cursor-pointer hover:bg-secondary/40"
                    onClick={() => handleSelect(rec.profile_name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(rec.profile_name) } }}
                    aria-label={t('a11y.useProfile', { name: rec.profile_name })}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {/* Profile Image */}
                      <div className="w-9 h-9 rounded-lg bg-secondary/60 overflow-hidden shrink-0 flex items-center justify-center">
                        {serverUrl && !imageErrors.has(rec.profile_name) ? (
                          <img
                            src={`${serverUrl}/api/profile/${encodeURIComponent(rec.profile_name)}/image-proxy`}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={() => setImageErrors(prev => new Set(prev).add(rec.profile_name))}
                          />
                        ) : (
                          <span className="text-[10px] font-bold text-muted-foreground/60 uppercase leading-none">
                            {rec.profile_name.split(/[\s-]+/).slice(0, 2).map(w => w[0]).join('')}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h4 className="text-sm font-medium truncate flex-1 min-w-0">{rec.profile_name}</h4>
                          <Badge
                            variant={rec.score >= 70 ? 'default' : rec.score >= 40 ? 'secondary' : 'outline'}
                            className="text-xs shrink-0"
                          >
                            {Math.round(rec.score)}%
                          </Badge>
                        </div>
                        {rec.explanation && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words min-w-0">
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
