import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CaretDown, Sparkle } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { getMatchReasonColorClass, getScoreColorClass } from '@/lib/tags'

interface Recommendation {
  profile_name: string
  score: number
  explanation: string
  match_reasons: string[]
}

interface ProfileRecommendationsProps {
  tags: string[]
  onUseProfile?: (profileName: string) => void
}

export function ProfileRecommendations({
  tags,
  onUseProfile,
}: ProfileRecommendationsProps) {
  const { t } = useTranslation()
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(true)
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())
  const [serverUrl, setServerUrl] = useState<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    getServerUrl().then(setServerUrl)
  }, [])

  const fetchRecommendations = useCallback(async (
    currentTags: string[],
  ) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setImageErrors(new Set())
    try {
      const url = serverUrl || await getServerUrl()
      if (!serverUrl && url) setServerUrl(url)
      const formData = new FormData()
      currentTags.forEach(tag => formData.append('tags', tag))

      const response = await fetch(`${url}/api/profiles/recommend`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(t('profileRecommendations.fetchFailed'))
      const data = await response.json()
      if (!controller.signal.aborted) {
        setRecommendations(data.recommendations || [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('[ProfileRecommendations] Failed to fetch recommendations:', err)
      if (!controller.signal.aborted) {
        setRecommendations([])
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [t])

  useEffect(() => {
    if (tags.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting when insufficient tags
      setRecommendations([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchRecommendations(tags)
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [tags, fetchRecommendations])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  if (tags.length === 0 && recommendations.length === 0) return null

  if (tags.length < 2 && recommendations.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground">
        <Sparkle size={14} className="text-primary/60" />
        <span>{t('profileRecommendations.selectMoreTags')}</span>
      </div>
    )
  }

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
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
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
                  <Card
                    className="p-2 sm:p-3 transition-colors cursor-pointer hover:bg-secondary/40 overflow-hidden"
                    onClick={() => onUseProfile?.(rec.profile_name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onUseProfile?.(rec.profile_name) } }}
                    aria-label={t('a11y.useProfile', { name: rec.profile_name })}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 overflow-hidden">
                      {/* Profile Image */}
                      <div className="w-10 h-10 rounded-lg bg-secondary/60 overflow-hidden shrink-0 flex items-center justify-center">
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
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <h4 className="text-sm font-medium truncate flex-1 min-w-0">{rec.profile_name}</h4>
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 border ${getScoreColorClass(rec.score)}`}
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
                            {rec.match_reasons.map((reason) => (
                              <span
                                key={reason}
                                className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${getMatchReasonColorClass(reason)}`}
                              >
                                {reason}
                              </span>
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
