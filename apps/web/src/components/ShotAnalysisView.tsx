import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CaretLeft,
  ChartLine,
  Clock,
  Drop,
  Star,
  ChatText,
  CaretDown,
  CaretRight,
  SpinnerGap,
  ArrowsCounterClockwise,
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { format } from 'date-fns'

interface RecentShot {
  profile_name: string
  profile_id: string
  date: string
  filename: string
  timestamp: string | number | null
  final_weight: number | null
  total_time: number | null
  has_annotation: boolean
}

interface ProfileGroup {
  profile_name: string
  profile_id: string
  shots: RecentShot[]
  shot_count: number
}

interface ShotAnalysisViewProps {
  onBack: () => void
  onSelectShot: (profileName: string, date: string, filename: string) => void
}

// Generate a stable accent color from the profile name
function profileAccentColor(name: string): string {
  const colors = [
    'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500',
    'bg-rose-500', 'bg-teal-500', 'bg-orange-500', 'bg-indigo-500',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function formatShotTimestamp(shot: RecentShot): string {
  try {
    if (shot.timestamp && (typeof shot.timestamp === 'string' || typeof shot.timestamp === 'number')) {
      const ts = typeof shot.timestamp === 'string' ? parseFloat(shot.timestamp) : shot.timestamp
      if (!isNaN(ts) && ts > 0) {
        return format(new Date(ts * 1000), 'MMM d, HH:mm')
      }
    }
    if (shot.filename && typeof shot.filename === 'string') {
      const timeMatch = shot.filename.match(/^(\d{2}):(\d{2}):(\d{2})/)
      if (timeMatch) {
        return `${shot.date || ''} ${timeMatch[0]}`
      }
    }
    return shot.date || 'Unknown'
  } catch {
    return shot.date || 'Unknown'
  }
}

// Module-level cache for recent shots (persists across mounts, 5 min TTL)
const CACHE_TTL_MS = 5 * 60 * 1000
interface ShotAnalysisCache {
  recent: { shots: RecentShot[]; fetchedAt: number } | null
  byProfile: { profiles: ProfileGroup[]; fetchedAt: number } | null
}
const shotAnalysisCache: ShotAnalysisCache = { recent: null, byProfile: null }

export function ShotAnalysisView({ onBack, onSelectShot }: ShotAnalysisViewProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'recent' | 'by-profile'>('recent')
  const [recentShots, setRecentShots] = useState<RecentShot[]>(shotAnalysisCache.recent?.shots ?? [])
  const [profileGroups, setProfileGroups] = useState<ProfileGroup[]>(shotAnalysisCache.byProfile?.profiles ?? [])
  const [isLoading, setIsLoading] = useState(!shotAnalysisCache.recent)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set())

  const fetchRecentShots = useCallback(async (force = false) => {
    // Serve from cache immediately (stale-while-revalidate)
    const cached = shotAnalysisCache.recent
    if (cached) {
      setRecentShots(cached.shots)
      setIsLoading(false)
      // If still fresh and not forced, skip revalidation
      if (!force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return
      // Revalidate in background
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/shots/recent?limit=50&offset=0`)
      if (!response.ok) throw new Error(t('shotAnalysis.fetchFailed'))
      const data = await response.json()
      const shots = data.shots || []
      shotAnalysisCache.recent = { shots, fetchedAt: Date.now() }
      setRecentShots(shots)
    } catch (err) {
      // Only set error if we have no cached data to show
      if (!shotAnalysisCache.recent) {
        setError(err instanceof Error ? err.message : t('shotAnalysis.fetchFailed'))
      }
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [t])

  const fetchByProfile = useCallback(async (force = false) => {
    // Serve from cache immediately (stale-while-revalidate)
    const cached = shotAnalysisCache.byProfile
    if (cached) {
      setProfileGroups(cached.profiles)
      if (cached.profiles.length > 0) {
        setExpandedProfiles(prev => prev.size > 0 ? prev : new Set([cached.profiles[0].profile_name]))
      }
      setIsLoading(false)
      // If still fresh and not forced, skip revalidation
      if (!force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return
      // Revalidate in background
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/shots/recent/by-profile?limit=50&offset=0`)
      if (!response.ok) throw new Error(t('shotAnalysis.fetchFailed'))
      const data = await response.json()
      const profiles = data.profiles || []
      shotAnalysisCache.byProfile = { profiles, fetchedAt: Date.now() }
      setProfileGroups(profiles)
      if (profiles.length > 0) {
        setExpandedProfiles(prev => prev.size > 0 ? prev : new Set([profiles[0].profile_name]))
      }
    } catch (err) {
      if (!shotAnalysisCache.byProfile) {
        setError(err instanceof Error ? err.message : t('shotAnalysis.fetchFailed'))
      }
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    if (activeTab === 'recent') {
      fetchRecentShots()
    } else {
      fetchByProfile()
    }
  }, [activeTab, fetchRecentShots, fetchByProfile])

  const handleRefresh = () => {
    if (activeTab === 'recent') {
      fetchRecentShots(true)
    } else {
      fetchByProfile(true)
    }
  }

  const toggleProfile = (name: string) => {
    setExpandedProfiles(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const renderShotCard = (shot: RecentShot, index: number, showProfileName: boolean) => (
    <motion.div
      key={`${shot.date}-${shot.filename}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      onClick={() => onSelectShot(shot.profile_name, shot.date, shot.filename)}
      className="group cursor-pointer"
    >
      <div className="p-4 bg-secondary/40 hover:bg-secondary/70 rounded-xl border border-border/20 hover:border-border/40 transition-all duration-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {showProfileName && (
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${profileAccentColor(shot.profile_name)}`} />
                <span className="text-xs text-muted-foreground truncate">
                  {shot.profile_name || 'Unknown Profile'}
                </span>
              </div>
            )}
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {formatShotTimestamp(shot)}
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
              {shot.has_annotation && (
                <span className="text-xs text-amber-500 flex items-center gap-1">
                  <Star size={12} weight="fill" />
                  <ChatText size={12} weight="fill" />
                </span>
              )}
            </div>
          </div>
          <ChartLine
            size={20}
            weight="bold"
            className="text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0"
          />
        </div>
      </div>
    </motion.div>
  )

  return (
    <motion.div
      key="shot-analysis"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <CaretLeft size={20} weight="bold" />
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-foreground truncate">
              {t('shotAnalysisView.title')}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="shrink-0"
            title={t('shotAnalysisView.refresh', 'Refresh')}
          >
            <ArrowsCounterClockwise size={18} weight="bold" className={isRefreshing ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
          <button
            onClick={() => setActiveTab('recent')}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all duration-200 ${
              activeTab === 'recent'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('shotAnalysisView.recent')}
          </button>
          <button
            onClick={() => setActiveTab('by-profile')}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all duration-200 ${
              activeTab === 'by-profile'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('shotAnalysisView.byProfile')}
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <SpinnerGap size={32} className="text-muted-foreground/40 animate-spin" />
            <p className="text-sm text-muted-foreground">{t('shotAnalysisView.loading')}</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : activeTab === 'recent' ? (
          recentShots.length === 0 ? (
            <div className="text-center py-16">
              <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
                <ChartLine size={40} className="text-muted-foreground/40" weight="duotone" />
              </div>
              <p className="text-foreground/80 font-medium">{t('shotAnalysisView.noShots')}</p>
              <p className="text-sm text-muted-foreground/60 mt-1.5">
                {t('shotAnalysisView.noShotsDescription')}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
              <AnimatePresence>
                {recentShots.map((shot, index) => renderShotCard(shot, index, true))}
              </AnimatePresence>
            </div>
          )
        ) : (
          /* By Profile tab */
          profileGroups.length === 0 ? (
            <div className="text-center py-16">
              <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
                <ChartLine size={40} className="text-muted-foreground/40" weight="duotone" />
              </div>
              <p className="text-foreground/80 font-medium">{t('shotAnalysisView.noShots')}</p>
              <p className="text-sm text-muted-foreground/60 mt-1.5">
                {t('shotAnalysisView.noShotsDescription')}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
              {profileGroups.map((group) => {
                const isExpanded = expandedProfiles.has(group.profile_name)
                return (
                  <div key={group.profile_name} className="rounded-xl border border-border/20 overflow-hidden">
                    {/* Profile header */}
                    <button
                      onClick={() => toggleProfile(group.profile_name)}
                      className="w-full flex items-center gap-3 p-4 bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${profileAccentColor(group.profile_name)}`} />
                      <span className="flex-1 text-left font-semibold text-foreground truncate">
                        {group.profile_name || 'Unknown Profile'}
                      </span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {t('shotAnalysisView.shots', { count: group.shot_count })}
                      </Badge>
                      {isExpanded ? (
                        <CaretDown size={16} weight="bold" className="text-muted-foreground shrink-0" />
                      ) : (
                        <CaretRight size={16} weight="bold" className="text-muted-foreground shrink-0" />
                      )}
                    </button>

                    {/* Expandable shot list */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="p-2 space-y-2">
                            {group.shots.map((shot, index) => renderShotCard(shot, index, false))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          )
        )}
      </Card>
    </motion.div>
  )
}
