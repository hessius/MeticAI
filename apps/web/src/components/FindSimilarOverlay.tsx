import { useState, useEffect, useRef, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkle } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { getMatchReasonColorClass, getScoreColorClass } from '@/lib/tags'
import { isDirectMode, isNativePlatform } from '@/lib/machineMode'
import { getProfileImageValue, resolveDisplayImageAsync } from '@/hooks/useProfileImageSrc'

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

// Small wrapper that resolves a profile image in both proxy and direct modes
function ProfileImage({ name, serverUrl }: { name: string; serverUrl: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when name changes
    setError(false)
    setSrc(null)

    if (isDirectMode() || isNativePlatform()) {
      fetch(`/api/profile/${encodeURIComponent(name)}`)
        .then(r => r.ok ? r.json() : null)
        .then(async data => {
          const imageSrc = await resolveDisplayImageAsync(getProfileImageValue(data?.profile))
          if (!cancelled) {
            setSrc(imageSrc)
          }
        })
        .catch(() => { if (!cancelled) setError(true) })
    } else if (serverUrl) {
      setSrc(`${serverUrl}/api/profile/${encodeURIComponent(name)}/image-proxy`)
    }

    return () => { cancelled = true }
  }, [name, serverUrl])

  if (!src || error) {
    return (
      <span className="text-[10px] font-bold text-muted-foreground/60 uppercase leading-none">
        {name.split(/[\s-]+/).slice(0, 2).map(w => w[0]).join('')}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  )
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
  const [serverUrl, setServerUrl] = useState<string>('')

  useEffect(() => {
    getServerUrl().then(setServerUrl)
  }, [])

  const fetchSimilar = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
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

      if (!response.ok) throw new Error(t('findSimilar.fetchFailed'))
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
  }, [profileName, serverUrl, t])

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- triggering fetch on dialog open
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
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Sparkle size={20} weight="fill" className="text-primary" />
            {t('profileRecommendations.findSimilar')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 min-w-0">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label={t('a11y.loading')}>
              {[1, 2, 3, 4].map(i => (
                <Card key={i} className="p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
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
                    className={`p-2 sm:p-3 transition-colors ${onSelectProfile ? 'cursor-pointer hover:bg-secondary/40' : ''}`}
                    {...(onSelectProfile ? {
                      onClick: () => handleSelect(rec.profile_name),
                      role: 'button' as const,
                      tabIndex: 0,
                      onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(rec.profile_name) } },
                      'aria-label': t('a11y.useProfile', { name: rec.profile_name }),
                    } : {})}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {/* Profile Image */}
                      <div className="w-10 h-10 rounded-lg bg-secondary/60 overflow-hidden shrink-0 flex items-center justify-center">
                        <ProfileImage name={rec.profile_name} serverUrl={serverUrl} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h4 className="text-sm font-medium truncate flex-1 min-w-0">{rec.profile_name}</h4>
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 border ${getScoreColorClass(rec.score)}`}
                          >
                            {Math.round(rec.score)}%
                          </Badge>
                        </div>
                        {rec.match_reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {rec.match_reasons.map(reason => (
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
