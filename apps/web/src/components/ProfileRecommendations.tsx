import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CaretDown, Sparkle, CheckCircle } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

interface Recommendation {
  profile_name: string
  score: number
  explanation: string
  match_reasons: string[]
}

interface ProfileRecommendationsProps {
  tags: string[]
  roastLevel?: string
  beverageType?: string
  onUseProfile?: (profileName: string) => void
}

export function ProfileRecommendations({
  tags,
  roastLevel,
  beverageType,
  onUseProfile,
}: ProfileRecommendationsProps) {
  const { t } = useTranslation()
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchRecommendations = useCallback(async (
    currentTags: string[],
    roast: string | undefined,
    bev: string | undefined,
  ) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    try {
      const serverUrl = await getServerUrl()
      const formData = new FormData()
      currentTags.forEach(tag => formData.append('tags', tag))
      if (roast) formData.append('roast_level', roast)
      if (bev) formData.append('beverage_type', bev)

      const response = await fetch(`${serverUrl}/api/profiles/recommend`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) throw new Error('Failed to fetch recommendations')
      const data = await response.json()
      if (!controller.signal.aborted) {
        setRecommendations(data.recommendations || [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!controller.signal.aborted) {
        setRecommendations([])
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (tags.length < 2) {
      setRecommendations([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchRecommendations(tags, roastLevel, beverageType)
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [tags, roastLevel, beverageType, fetchRecommendations])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  if (tags.length < 2 && recommendations.length === 0) return null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full text-left group py-1">
          <div className="flex items-center gap-2">
            <Sparkle size={16} weight="fill" className="text-primary" />
            <span className="text-sm font-semibold tracking-wide text-foreground/90">
              {t('profileRecommendations.title')}
            </span>
            {recommendations.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {recommendations.length}
              </Badge>
            )}
          </div>
          <CaretDown
            size={16}
            className={`text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 pt-2">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label={t('a11y.recommendations.loading')}>
              {[1, 2, 3].map(i => (
                <Card key={i} className="p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                    <Skeleton className="h-6 w-12 rounded-full" />
                  </div>
                </Card>
              ))}
              <p className="text-xs text-center text-muted-foreground">
                {t('profileRecommendations.loading')}
              </p>
            </div>
          ) : recommendations.length === 0 ? (
            tags.length >= 2 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                {t('profileRecommendations.empty')}
              </p>
            ) : null
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
                  <Card className="p-3 hover:bg-secondary/40 transition-colors">
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
                            {rec.match_reasons.map((reason) => (
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          variant={rec.score >= 70 ? 'default' : rec.score >= 40 ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {Math.round(rec.score)}%
                        </Badge>
                        {onUseProfile && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onUseProfile(rec.profile_name)}
                            className="h-7 text-xs px-2"
                          >
                            <CheckCircle size={14} className="mr-1" />
                            {t('profileRecommendations.useProfile')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          {!isLoading && recommendations.length > 0 && (
            <p className="text-[10px] text-center text-muted-foreground/60">
              {t('profileRecommendations.basedOn')}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
