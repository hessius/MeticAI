import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { 
  CaretLeft, 
  Trash,
  PencilSimple,
  Coffee,
  ArrowsClockwise,
  Warning,
  CheckCircle,
  SpinnerGap,
  FileJs,
  X,
  Plus,
  Funnel
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { getAutoSync, setAutoSync, getAutoSyncAiDescription, setAutoSyncAiDescription } from '@/lib/aiPreferences'
import { useProfileImageCache } from '@/hooks/useProfileImageCache'
import { extractTagsFromPreferences, getAllTagsFromEntries, getTagColorClass } from '@/lib/tags'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { BulkDeleteDialog } from './BulkDeleteDialog'
import { OrphanResolutionDialog } from './OrphanResolutionDialog'
import { ProfileImportDialog } from './ProfileImportDialog'
import { SyncReport, SyncResults } from './SyncReport'

interface MachineProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  final_weight?: number
  in_history: boolean
  has_description: boolean
  user_preferences?: string | null
  display?: {
    description?: string
    shortDescription?: string
    accentColor?: string
    image?: string
  }
}

interface OrphanedEntry {
  id: string
  profile_name: string
  created_at?: string
  has_profile_json: boolean
}

interface HistoryEntrySummary {
  id: string
  profile_name: string
  created_at?: string
}

interface ProfileCatalogueViewProps {
  onBack: () => void
  onViewProfile?: (profile: MachineProfile) => void
}

const SWIPE_THRESHOLD = -80

function SwipeableCard({
  children,
  onSwipeDelete,
  isCoarse,
}: {
  children: React.ReactNode
  onSwipeDelete: () => void
  isCoarse: boolean
}) {
  const x = useMotionValue(0)
  const deleteOpacity = useTransform(x, [-120, -60], [1, 0])
  const deleteScale = useTransform(x, [-120, -60], [1, 0.8])

  if (!isCoarse) {
    return <>{children}</>
  }

  const handleDragEnd = (_: never, info: PanInfo) => {
    if (info.offset.x < SWIPE_THRESHOLD) {
      onSwipeDelete()
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete action revealed behind card */}
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 bg-destructive text-destructive-foreground rounded-lg"
        style={{ opacity: deleteOpacity, scale: deleteScale }}
      >
        <Trash className="w-6 h-6" />
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative z-10 rounded-lg overflow-hidden"
      >
        {children}
      </motion.div>
    </div>
  )
}

function ProfileImage({ imageUrl }: { imageUrl?: string }) {
  const [error, setError] = useState(false)

  return (
    <div className="w-10 h-10 rounded-full overflow-hidden border border-border/30 shrink-0 bg-secondary/60">
      {imageUrl && !error ? (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Coffee size={18} className="text-muted-foreground/40" weight="fill" />
        </div>
      )}
    </div>
  )
}

export function ProfileCatalogueView({ onBack, onViewProfile }: ProfileCatalogueViewProps) {
  const { t } = useTranslation()

  // Read static description cache (populated by main.tsx in direct mode)
  const descCache = (window as unknown as Record<string, unknown>).__meticaiDescriptionCache as Map<string, string> | undefined
  const getShortDescription = (profile: MachineProfile): string | undefined => {
    if (profile.display?.shortDescription) return profile.display.shortDescription
    const full = descCache?.get(profile.id)
    if (!full) return undefined
    const m = full.match(/Description:\s*([\s\S]*?)(?:\n\n|Preparation:)/i)
    return m?.[1]?.trim() || undefined
  }
  
  // State
  const [profiles, setProfiles] = useState<MachineProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  
  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  
  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<{
    profileId: string
    profileName: string
    historyId?: string
  } | null>(null)
  
  // Orphan state
  const [orphanedEntries, setOrphanedEntries] = useState<OrphanedEntry[]>([])
  const [orphanDialogOpen, setOrphanDialogOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntrySummary[]>([])

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<SyncResults | null>(null)
  const [syncBadgeCount, setSyncBadgeCount] = useState(0)
  const [staleProfileNames, setStaleProfileNames] = useState<Set<string>>(new Set())

  // Auto-sync state
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(() => getAutoSync())
  const [autoSyncAiDesc, setAutoSyncAiDesc] = useState(() => getAutoSyncAiDescription())

  // Bulk delete dialog state
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // Filter state
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([])
  const [filterMode, setFilterMode] = useState<'AND' | 'OR'>('OR')
  const [showFilters, setShowFilters] = useState(false)

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)

  // Profile image cache
  const { getImageUrl, fetchImagesForProfiles } = useProfileImageCache()

  // Detect coarse pointer (touch device)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)')
    setIsCoarsePointer(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  
  // Fetch profiles from machine
  const fetchProfiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profiles`)
      if (!response.ok) {
        throw new Error(t('profileCatalogue.fetchFailed'))
      }
      
      const data = await response.json()
      setIsOffline(data.offline === true)
      setProfiles(Array.isArray(data?.profiles) ? data.profiles : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : t('profileCatalogue.fetchFailed')
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch orphaned history entries
  const fetchOrphaned = useCallback(async () => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profiles/orphaned`)
      if (!response.ok) return
      const data = await response.json()
      setOrphanedEntries(data.orphaned || [])
    } catch {
      // Non-critical — silently ignore
    }
  }, [])

  // Fetch history entries for reliable profile-name -> history-id resolution
  const fetchHistoryEntries = useCallback(async () => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history?limit=500&offset=0`)
      if (!response.ok) return

      const data = await response.json()
      const entries = Array.isArray(data?.entries) ? data.entries : []

      setHistoryEntries(
        entries
          .filter((entry): entry is HistoryEntrySummary => (
            typeof entry?.id === 'string' && typeof entry?.profile_name === 'string'
          ))
          .map((entry) => ({
            id: entry.id,
            profile_name: entry.profile_name,
            created_at: typeof entry.created_at === 'string' ? entry.created_at : undefined,
          }))
      )
    } catch {
      // Non-critical — silently ignore
    }
  }, [])

  // Fetch sync status badge count
  const fetchSyncStatus = useCallback(async () => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/profiles/sync/status`)
      if (!response.ok) return
      const data = await response.json()
      setSyncBadgeCount(
        (data.new_count || 0) + (data.updated_count || 0) + (data.orphaned_count || 0)
      )
    } catch {
      // Non-critical
    }
  }, [])

  // Run full sync
  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/profiles/sync`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(t('profileCatalogue.syncFailed'))
      const data: SyncResults = await response.json()
      setSyncResults(data)

      // Track stale profile names for badge display in the list
      const stale = new Set<string>()
      for (const u of data.updated) {
        stale.add(u.profile_name)
      }
      setStaleProfileNames(stale)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('profileCatalogue.syncFailed')
      toast.error(message)
    } finally {
      setIsSyncing(false)
    }
  }
  
  useEffect(() => {
    fetchProfiles()
    fetchOrphaned()
    fetchHistoryEntries()
    fetchSyncStatus()
  }, [fetchProfiles, fetchOrphaned, fetchHistoryEntries, fetchSyncStatus])

  // Fetch profile images when profile list changes
  useEffect(() => {
    if (profiles.length > 0) {
      fetchImagesForProfiles(profiles.map(p => p.name))
    }
  }, [profiles, fetchImagesForProfiles])

  // Auto-sync is now handled globally in App.tsx — just refresh data periodically
  // when the catalogue view is visible
  useEffect(() => {
    if (!autoSyncEnabled) return
    const refreshInterval = setInterval(() => {
      fetchProfiles()
      fetchOrphaned()
      fetchHistoryEntries()
      fetchSyncStatus()
    }, 5 * 60 * 1000)
    return () => clearInterval(refreshInterval)
  }, [autoSyncEnabled, fetchProfiles, fetchOrphaned, fetchHistoryEntries, fetchSyncStatus])

  // Find history ID for a profile by name
  const findHistoryId = useCallback(
    (profileName: string): string | undefined => {
      const normalizedProfileName = profileName.trim().toLowerCase()
      const matches = historyEntries.filter(
        (entry) => entry.profile_name.trim().toLowerCase() === normalizedProfileName
      )

      if (matches.length === 0) {
        return undefined
      }

      const sortedMatches = [...matches].sort((a, b) => {
        const aTime = a.created_at ? Date.parse(a.created_at) : Number.NEGATIVE_INFINITY
        const bTime = b.created_at ? Date.parse(b.created_at) : Number.NEGATIVE_INFINITY
        const aValid = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY
        const bValid = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY
        return bValid - aValid
      })

      return sortedMatches[0]?.id
    },
    [historyEntries]
  )
  
  // Rename profile
  const handleRename = async (profileId: string) => {
    if (!renameValue.trim()) {
      toast.error(t('profileCatalogue.nameRequired'))
      return
    }
    
    setIsRenaming(true)
    
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profile/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() })
      })
      
      if (!response.ok) {
        throw new Error(t('profileCatalogue.renameFailed'))
      }
      
      const result = await response.json()
      toast.success(t('profileCatalogue.renamed', { name: result.new_name }))
      
      // Refresh list
      await fetchProfiles()
      setRenamingId(null)
      setRenameValue('')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('profileCatalogue.renameFailed')
      toast.error(message)
    } finally {
      setIsRenaming(false)
    }
  }

  // Open delete dialog
  const openDeleteDialog = (profile: MachineProfile) => {
    setDeleteTarget({
      profileId: profile.id,
      profileName: profile.name,
      historyId: profile.in_history ? findHistoryId(profile.name) : undefined,
    })
  }

  // Handle deletion complete
  const handleDeleted = () => {
    setDeleteTarget(null)
    fetchProfiles()
    fetchOrphaned()
    fetchHistoryEntries()
  }
  
  // Export profile JSON
  const handleExport = async (profile: MachineProfile) => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profile/${encodeURIComponent(profile.id)}/json`)
      if (!response.ok) {
        throw new Error(t('profileCatalogue.exportFailed'))
      }
      
      const data = await response.json()
      const blob = new Blob([JSON.stringify(data.profile, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      const a = document.createElement('a')
      a.href = url
      a.download = `${profile.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success(t('profileCatalogue.exported'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('profileCatalogue.exportFailed')
      toast.error(message)
    }
  }

  // Start rename
  const startRename = (profile: MachineProfile) => {
    setRenamingId(profile.id)
    setRenameValue(profile.name)
  }
  
  // Cancel rename
  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  // Check if a profile is orphaned (in history but not on machine)
  const isOrphaned = (profileName: string): boolean =>
    orphanedEntries.some((e) => e.profile_name === profileName)

  const availableTags = useMemo(() => {
    return getAllTagsFromEntries(profiles)
  }, [profiles])

  const filteredProfiles = useMemo(() => {
    if (selectedFilterTags.length === 0) return profiles

    return profiles.filter((profile) => {
      const entryTags = extractTagsFromPreferences(profile.user_preferences ?? null)
      if (filterMode === 'AND') {
        return selectedFilterTags.every((tag) => entryTags.includes(tag))
      }
      return selectedFilterTags.some((tag) => entryTags.includes(tag))
    })
  }, [profiles, selectedFilterTags, filterMode])

  const toggleFilterTag = (tag: string) => {
    setSelectedFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSelectedFilterTags([])
  }



  return (
    <div className="min-h-screen bg-background">
      <Card className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="shrink-0"
              aria-label={t('a11y.goBack')}
            >
              <CaretLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-semibold">
                {t('profileCatalogue.title')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('profileCatalogue.description', { count: profiles.length })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isEditing ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              <PencilSimple className="w-4 h-4 mr-2" />
              {isEditing ? t('common.done') : t('profileCatalogue.editMode')}
            </Button>
            {isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={isLoading || profiles.filter(p => !p.in_history).length === 0}
                className="text-destructive hover:text-destructive"
              >
                <Trash className="w-4 h-4 mr-2" />
                {t('profileCatalogue.bulkDelete.button')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing || isLoading}
              className="relative"
            >
              <ArrowsClockwise className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {t('profileCatalogue.sync.button')}
              {syncBadgeCount > 0 && !isSyncing && (
                <Badge
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-5 min-w-[20px] px-1 text-xs"
                >
                  {syncBadgeCount}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { fetchProfiles(); fetchOrphaned(); fetchSyncStatus() }}
              disabled={isLoading}
            >
              <ArrowsClockwise className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              {t('profileCatalogue.refresh')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImportDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('profileCatalogue.addButton')}
            </Button>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              className={selectedFilterTags.length > 0 ? 'text-primary' : ''}
            >
              <Funnel className="w-4 h-4 mr-2" weight={showFilters || selectedFilterTags.length > 0 ? 'fill' : 'regular'} />
              {t('history.filterByTags')}
              {selectedFilterTags.length > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1 text-xs">
                  {filteredProfiles.length}/{profiles.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Filter Section */}
        <AnimatePresence>
          {showFilters && availableTags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-4 bg-secondary/40 rounded-xl border border-border/30 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground/80">{t('history.filterByTags')}</Label>
                  <div className="flex items-center gap-2">
                    {selectedFilterTags.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                      >
                        <X className="w-3 h-3 mr-1" />
                        {t('common.clear')}
                      </Button>
                    )}
                    <div className="flex items-center bg-secondary rounded-lg p-0.5 border border-border/30">
                      <button
                        onClick={() => setFilterMode('OR')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-200 ${
                          filterMode === 'OR'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        OR
                      </button>
                      <button
                        onClick={() => setFilterMode('AND')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-200 ${
                          filterMode === 'AND'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        AND
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const isSelected = selectedFilterTags.includes(tag)
                    return (
                      <Badge
                        key={tag}
                        onClick={() => toggleFilterTag(tag)}
                        className={`
                          px-2.5 py-1 text-xs font-medium cursor-pointer transition-all duration-200 border
                          ${getTagColorClass(tag, isSelected)}
                        `}
                      >
                        {tag}
                      </Badge>
                    )
                  })}
                </div>
                {selectedFilterTags.length > 0 && (
                  <p className="text-xs text-muted-foreground/70">
                    {filterMode === 'OR' ? t('history.filterHintOr') : t('history.filterHintAnd')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-sync toggle */}
        <div className="flex items-center gap-2 px-1">
          <Switch
            id="auto-sync-toggle"
            checked={autoSyncEnabled}
            onCheckedChange={(checked) => {
              setAutoSyncEnabled(checked as boolean)
              setAutoSync(checked as boolean)
              getServerUrl().then(url => fetch(`${url}/api/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autoSync: checked }),
              })).catch(() => {/* best-effort */})
            }}
          />
          <Label htmlFor="auto-sync-toggle" className="text-sm cursor-pointer">
            {t('profileCatalogue.sync.autoSync')}
          </Label>
        </div>

        {/* AI description during auto-sync toggle */}
        {autoSyncEnabled && (
          <div className="flex items-center gap-2 px-1 pl-6">
            <Switch
              id="auto-sync-ai-desc-toggle"
              checked={autoSyncAiDesc}
              onCheckedChange={(checked) => {
                setAutoSyncAiDesc(checked as boolean)
                setAutoSyncAiDescription(checked as boolean)
                getServerUrl().then(url => fetch(`${url}/api/settings`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ autoSyncAiDescription: checked }),
                })).catch(() => {/* best-effort */})
              }}
            />
            <Label htmlFor="auto-sync-ai-desc-toggle" className="text-xs cursor-pointer text-muted-foreground">
              {t('profileCatalogue.sync.autoSyncAiDescription')}
            </Label>
          </div>
        )}

        {/* Offline banner */}
        {isOffline && (
          <Alert className="border-amber-500/50 bg-amber-500/10">
            <Warning className="w-4 h-4 text-amber-500" />
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              {t('profileCatalogue.offlineBanner')}
            </AlertDescription>
          </Alert>
        )}

        {/* Orphan warning banner */}
        {orphanedEntries.length > 0 && (
          <Alert className="cursor-pointer" onClick={() => setOrphanDialogOpen(true)}>
            <Warning className="w-4 h-4" />
            <AlertDescription>
              {t('profileCatalogue.orphanBanner', { count: orphanedEntries.length })}
            </AlertDescription>
          </Alert>
        )}
        
        {/* Error state */}
        {error && (
          <Alert variant="destructive">
            <Warning className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {/* Loading state */}
        {isLoading && profiles.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}
        
        {/* Profile list */}
        {!isLoading && profiles.length === 0 && !error && (
          <Card className="p-8 text-center">
            <Coffee className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              {t('profileCatalogue.noProfiles')}
            </p>
          </Card>
        )}
        
        {!isLoading && profiles.length > 0 && filteredProfiles.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
              <Funnel className="w-10 h-10 text-muted-foreground/40" weight="duotone" />
            </div>
            <p className="text-foreground/80 font-medium">{t('history.noMatchingProfiles')}</p>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              {t('history.noMatchingDescription')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="mt-4"
            >
              {t('history.clearFilters')}
            </Button>
          </div>
        ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredProfiles.map((profile) => (
              <motion.div
                key={profile.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ duration: 0.2 }}
              >
                <SwipeableCard
                  isCoarse={isCoarsePointer}
                  onSwipeDelete={() => openDeleteDialog(profile)}
                >
                  <Card
                    className={`p-4 ${isOrphaned(profile.name) ? 'opacity-50' : ''} ${!isEditing ? 'cursor-pointer active:bg-accent/50 transition-colors' : ''}`}
                    onClick={() => !isEditing && onViewProfile?.(profile)}
                  >
                    <div className="flex items-start gap-4">
                      {/* Profile image — prefer machine's direct URL over image-proxy cache */}
                      <ProfileImage imageUrl={profile.display?.image ?? getImageUrl(profile.name) ?? undefined} />
                      
                      {/* Profile info */}
                      <div className="flex-1 min-w-0">
                        {renamingId === profile.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="flex-1"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(profile.id)
                                if (e.key === 'Escape') cancelRename()
                              }}
                              disabled={isRenaming}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleRename(profile.id)}
                              disabled={isRenaming}
                            >
                              {isRenaming ? (
                                <SpinnerGap className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelRename}
                              disabled={isRenaming}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium truncate">{profile.name}</h3>
                              {isOrphaned(profile.name) && (
                                <Badge variant="outline" className="text-amber-600 border-amber-600 shrink-0">
                                  <Warning className="w-3 h-3 mr-1" />
                                  {t('profileCatalogue.orphaned')}
                                </Badge>
                              )}
                              {staleProfileNames.has(profile.name) && !isOrphaned(profile.name) && (
                                <Badge variant="outline" className="text-blue-600 border-blue-600 shrink-0">
                                  <ArrowsClockwise className="w-3 h-3 mr-1" />
                                  {t('profileCatalogue.sync.stale')}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {profile.author && <span>{profile.author}</span>}
                              {profile.temperature && (
                                <span>{profile.temperature}°C</span>
                              )}
                              {profile.final_weight && (
                                <span>{profile.final_weight}g</span>
                              )}
                            </div>
                            {getShortDescription(profile) && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {getShortDescription(profile)}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-1">
                              {!isOrphaned(profile.name) && (
                                <span className="inline-flex items-center text-xs text-blue-600 dark:text-blue-400">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {t('profileCatalogue.onMachine')}
                                </span>
                              )}
                              {profile.in_history && (
                                <span className="inline-flex items-center text-xs text-green-600 dark:text-green-400">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  {t('profileCatalogue.inHistory')}
                                </span>
                              )}
                            </div>
                            {(() => {
                              const entryTags = extractTagsFromPreferences(profile.user_preferences ?? null)
                              return entryTags.length > 0 ? (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {entryTags.slice(0, 4).map((tag) => (
                                    <Badge
                                      key={tag}
                                      className={`px-1.5 py-0.5 text-[10px] font-medium border ${getTagColorClass(tag, false)}`}
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                  {entryTags.length > 4 && (
                                    <Badge className="px-1.5 py-0.5 text-[10px] font-medium bg-muted/50 border-transparent text-muted-foreground">
                                      +{entryTags.length - 4}
                                    </Badge>
                                  )}
                                </div>
                              ) : null
                            })()}
                          </>
                        )}
                      </div>
                      
                      {/* Actions */}
                      {renamingId !== profile.id && isEditing && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleExport(profile)}
                            title={t('profileCatalogue.export')}
                            aria-label={t('profileCatalogue.export')}
                          >
                            <FileJs className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startRename(profile)}
                            title={t('profileCatalogue.rename')}
                            aria-label={t('profileCatalogue.rename')}
                          >
                            <PencilSimple className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(profile)}
                            title={t('profileCatalogue.delete')}
                            aria-label={t('profileCatalogue.delete')}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </SwipeableCard>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        )}

        {/* Orphaned entries section */}
        {orphanedEntries.length > 0 && (
          <div className="space-y-3 pt-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t('profileCatalogue.orphanedSection')}
            </h2>
            <AnimatePresence mode="popLayout">
              {orphanedEntries.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card
                    className="p-4 opacity-60 border-dashed cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setOrphanDialogOpen(true)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Warning className="w-5 h-5 text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{entry.profile_name}</h3>
                          <Badge variant="outline" className="text-amber-600 border-amber-600 shrink-0">
                            {t('profileCatalogue.orphaned')}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('profileCatalogue.orphanHint')}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>

      {/* Dialogs */}
      <BulkDeleteDialog
        isOpen={bulkDeleteOpen}
        profiles={profiles}
        resolveHistoryId={findHistoryId}
        onClose={() => setBulkDeleteOpen(false)}
        onDeleted={() => {
          setBulkDeleteOpen(false)
          fetchProfiles()
          fetchOrphaned()
          fetchHistoryEntries()
          fetchSyncStatus()
        }}
      />

      <DeleteProfileDialog
        isOpen={!!deleteTarget}
        profileId={deleteTarget?.profileId ?? ''}
        profileName={deleteTarget?.profileName ?? ''}
        historyId={deleteTarget?.historyId}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />

      <OrphanResolutionDialog
        isOpen={orphanDialogOpen}
        entries={orphanedEntries}
        onClose={() => setOrphanDialogOpen(false)}
        onResolved={() => {
          setOrphanDialogOpen(false)
          fetchProfiles()
          fetchOrphaned()
          fetchHistoryEntries()
        }}
      />

      <SyncReport
        isOpen={!!syncResults}
        results={syncResults}
        onClose={() => setSyncResults(null)}
        onResolved={() => {
          setSyncResults(null)
          fetchProfiles()
          fetchOrphaned()
          fetchHistoryEntries()
          fetchSyncStatus()
        }}
      />

      <ProfileImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImported={() => { setShowImportDialog(false); fetchProfiles(); fetchOrphaned(); fetchHistoryEntries() }}
        onGenerateNew={() => setShowImportDialog(false)}
      />
    </div>
  )
}
