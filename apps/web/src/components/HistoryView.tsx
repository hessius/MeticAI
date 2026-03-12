import React, { useEffect, useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { 
  Trash, 
  CaretLeft, 
  Warning,
  FileJs,
  Coffee,
  Image,
  Funnel,
  X,
  ChartLine,
  Camera,
  CheckCircle,
  SpinnerGap,
  MagicWand,
  Info,
  Check,
  XCircle,
  Plus,
  Play,
  PencilSimple,
  FloppyDisk,
  GearSix
} from '@phosphor-icons/react'
import { useHistory, HistoryEntry } from '@/hooks/useHistory'
import { useProfileImageCache } from '@/hooks/useProfileImageCache'
import { MarkdownText, cleanProfileName } from '@/components/MarkdownText'
import { formatDistanceToNow } from 'date-fns'
import { domToPng } from 'modern-screenshot'
import { MeticAILogo } from '@/components/MeticAILogo'
import { ShotHistoryView } from '@/components/ShotHistoryView'
import { ImageCropDialog } from '@/components/ImageCropDialog'
import { ProfileImportDialog } from '@/components/ProfileImportDialog'
import { ProfileBreakdown, ProfileData } from '@/components/ProfileBreakdown'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { getServerUrl } from '@/lib/config'
import { profileService } from '@/services/profileService'

import { 
  extractTagsFromPreferences, 
  getAllTagsFromEntries, 
  getTagColorClass
} from '@/lib/tags'

// Helper to extract Description section from profile reply
function extractDescription(reply: string): string | null {
  if (!reply) return null
  
  // Handle both "Description:" and "**Description:**" formats
  const descMatch = reply.match(/\*?\*?Description:\*?\*?\s*([\s\S]*?)(?:\*?\*?Preparation:|\*?\*?Why This Works:|\*?\*?Special Notes:|PROFILE JSON|```|$)/i)
  if (descMatch && descMatch[1]) {
    let desc = descMatch[1].trim()
    // Clean up any leading/trailing ** artifacts
    desc = desc.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '')
    // Clean up any trailing headers or code blocks
    return desc.replace(/```[\s\S]*$/g, '').trim() || null
  }
  return null
}

/**
 * Component to display profile image with graceful fallback
 * Shows a Coffee icon placeholder if the image URL is missing or fails to load
 * @param imageUrl - Optional URL to the profile image
 * @param profileName - Name of the profile (used for alt text)
 */
function ProfileImageWithFallback({ imageUrl, profileName }: { imageUrl?: string; profileName: string }) {
  const [imageError, setImageError] = useState(false)

  // Reset error state when imageUrl changes to allow retry with new URL
  const [prevImageUrl, setPrevImageUrl] = useState(imageUrl)
  if (prevImageUrl !== imageUrl) {
    setPrevImageUrl(imageUrl)
    setImageError(false)
  }

  return (
    <div className="w-10 h-10 rounded-full overflow-hidden border border-border/30 shrink-0 mt-0.5 bg-secondary/60">
      {imageUrl && !imageError ? (
        <img 
          src={imageUrl} 
          alt={cleanProfileName(profileName)}
          className="w-full h-full object-cover animate-in fade-in duration-300"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Coffee size={18} className="text-muted-foreground/40" weight="fill" />
        </div>
      )}
    </div>
  )
}

interface HistoryViewProps {
  onBack: () => void
  onViewProfile: (entry: HistoryEntry, cachedImageUrl?: string) => void
  onGenerateNew: () => void
  onManageMachine?: () => void
  aiConfigured?: boolean
  hideAiWhenUnavailable?: boolean
}

export function HistoryView({ onBack, onViewProfile, onGenerateNew, onManageMachine, aiConfigured = true, hideAiWhenUnavailable = false }: HistoryViewProps) {
  const { t } = useTranslation()
  const { 
    entries, 
    total, 
    isLoading, 
    error, 
    fetchHistory, 
    deleteEntry, 
    downloadJson 
  } = useHistory()
  
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([])
  const [filterMode, setFilterMode] = useState<'AND' | 'OR'>('OR')
  const [showFilters, setShowFilters] = useState(false)
  const [profileImages, setProfileImages] = useState<Record<string, string>>({})
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [syncBadgeCount, setSyncBadgeCount] = useState(0)
  
  // Use cached profile images
  const { fetchImagesForProfiles } = useProfileImageCache()

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Fetch sync badge count
  useEffect(() => {
    if (!onManageMachine) return
    const loadSyncStatus = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/profiles/sync/status`)
        if (!response.ok) return
        const data = await response.json()
        setSyncBadgeCount((data.new_count || 0) + (data.updated_count || 0) + (data.orphaned_count || 0))
      } catch {
        // Non-critical
      }
    }
    loadSyncStatus()
  }, [onManageMachine])

  // Fetch profile images for all entries (using cache)
  useEffect(() => {
    const loadImages = async () => {
      if (entries.length === 0) return
      
      const profileNames = entries.map(e => e.profile_name)
      const images = await fetchImagesForProfiles(profileNames)
      setProfileImages(images)
    }
    
    loadImages()
  }, [entries, fetchImagesForProfiles])

  // Get all available tags from entries for filtering
  const availableTags = useMemo(() => {
    return getAllTagsFromEntries(entries)
  }, [entries])

  // Filter entries based on selected tags
  const filteredEntries = useMemo(() => {
    if (selectedFilterTags.length === 0) return entries
    
    return entries.filter(entry => {
      const entryTags = extractTagsFromPreferences(entry.user_preferences)
      
      if (filterMode === 'AND') {
        // All selected tags must be present
        return selectedFilterTags.every(tag => entryTags.includes(tag))
      } else {
        // At least one selected tag must be present
        return selectedFilterTags.some(tag => entryTags.includes(tag))
      }
    })
  }, [entries, selectedFilterTags, filterMode])

  const toggleFilterTag = (tag: string) => {
    setSelectedFilterTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSelectedFilterTags([])
  }

  const handleDelete = async (entryId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('history.deleteConfirm'))) {
      return
    }
    
    try {
      setDeletingId(entryId)
      await deleteEntry(entryId)
    } catch (err) {
      console.error('Failed to delete:', err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = async (entry: HistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await downloadJson(entry)
    } catch (err) {
      console.error('Failed to download:', err)
      alert(t('history.jsonNotAvailable'))
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return t('history.recentlyAdded')
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return t('history.recentlyAdded')
      return formatDistanceToNow(date, { addSuffix: true })
    } catch {
      return t('history.recentlyAdded')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
          >
            <CaretLeft size={22} weight="bold" />
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Coffee size={22} className="text-primary" weight="fill" />
            </div>
            <h2 className="text-lg font-bold tracking-tight">{t('history.title')}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              onClick={() => setShowImportDialog(true)}
              size="icon"
              className="h-9 w-9 bg-amber-500 hover:bg-amber-600 text-zinc-900"
              title={t('history.addProfile')}
            >
              <Plus size={18} weight="bold" />
            </Button>
            {onManageMachine && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onManageMachine}
                className="relative shrink-0 h-9 w-9"
                title={t('history.manageMachine')}
              >
                <GearSix size={18} weight="fill" />
                {syncBadgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] font-bold leading-4 text-white bg-destructive rounded-full">
                    {syncBadgeCount}
                  </span>
                )}
              </Button>
            )}
            <Button
              variant={showFilters ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
              className={`shrink-0 h-9 w-9 ${selectedFilterTags.length > 0 ? 'text-primary' : ''}`}
              title={t('history.filterByTags')}
            >
              <Funnel size={18} weight={showFilters || selectedFilterTags.length > 0 ? "fill" : "regular"} />
            </Button>
            <span className="text-xs text-muted-foreground font-medium">
              {selectedFilterTags.length > 0 
                ? `${filteredEntries.length}/${total}` 
                : `${total}`
              }
            </span>
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
                        <X size={12} className="mr-1" />
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
                    {filterMode === 'OR' 
                      ? t('history.filterHintOr')
                      : t('history.filterHintAnd')
                    }
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl">
            <Warning size={18} weight="fill" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">{t('history.loadingHistory')}</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
              <Coffee size={40} className="text-muted-foreground/40" weight="duotone" />
            </div>
            <p className="text-foreground/80 font-medium">{t('history.noProfiles')}</p>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              {t('history.noProfilesDescription')}
            </p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-2xl bg-secondary/40 inline-block mb-4">
              <Funnel size={40} className="text-muted-foreground/40" weight="duotone" />
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
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
            <AnimatePresence>
              {filteredEntries.map((entry, index) => {
                const entryTags = extractTagsFromPreferences(entry.user_preferences)
                const profileImage = profileImages[entry.profile_name]
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.02 }}
                    onClick={() => onViewProfile(entry, profileImage)}
                    className="group cursor-pointer"
                  >
                    <div className="p-4 bg-secondary/40 hover:bg-secondary/70 rounded-xl border border-border/20 hover:border-border/40 transition-all duration-200">
                      <div className="flex items-start justify-between gap-3">
                        {/* Profile Image - fixed size to prevent layout shift */}
                        <ProfileImageWithFallback
                          imageUrl={profileImage}
                          profileName={entry.profile_name}
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                            {cleanProfileName(entry.profile_name)}
                          </h3>
                          {typeof entry.profile_json?.author === 'string' && entry.profile_json.author && (
                            <p className="text-[10px] text-muted-foreground/60 truncate">
                              {t('history.byAuthor', { author: entry.profile_json.author })}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground/70 mt-1">
                            {formatDate(entry.created_at)}
                          </p>
                          {entryTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2.5">
                              {entryTags.slice(0, 4).map((tag) => (
                                <Badge
                                  key={tag}
                                  className={`
                                    px-1.5 py-0.5 text-[10px] font-medium border
                                    ${getTagColorClass(tag, false)}
                                  `}
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
                          )}
                          {(() => {
                            const description = extractDescription(entry.reply)
                            if (description) {
                              return (
                                <p className="text-sm text-muted-foreground/80 mt-2 line-clamp-2 leading-relaxed">
                                  {description}
                                </p>
                              )
                            }
                            // Fallback to coffee_analysis if no description
                            if (entry.coffee_analysis) {
                              return (
                                <p className="text-sm text-muted-foreground/80 mt-2 line-clamp-2 leading-relaxed">
                                  {entry.coffee_analysis}
                                </p>
                              )
                            }
                            return null
                          })()}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          {entry.profile_json && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={(e) => handleDownload(entry, e)}
                              title={t('history.downloadJson')}
                            >
                              <FileJs size={16} weight="bold" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => handleDelete(entry.id, e)}
                            disabled={deletingId === entry.id}
                            title={t('common.delete')}
                          >
                            <Trash size={16} weight="bold" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
        
        {/* Add Profile Button at bottom */}
        <Button
          onClick={() => setShowImportDialog(true)}
          className="w-full h-12 mt-4 bg-amber-500 hover:bg-amber-600 text-zinc-900 font-semibold"
        >
          <Plus size={18} weight="bold" className="mr-2" />
          {t('history.addProfile')}
        </Button>
      </Card>
      
      {/* Profile Import Dialog */}
      <ProfileImportDialog
        isOpen={showImportDialog}
        aiConfigured={aiConfigured}
        hideAiWhenUnavailable={hideAiWhenUnavailable}
        onClose={() => setShowImportDialog(false)}
        onImported={() => {
          setShowImportDialog(false)
          fetchHistory()
        }}
        onGenerateNew={() => {
          setShowImportDialog(false)
          onGenerateNew()
        }}
      />
    </motion.div>
  )
}

// Image generation style options - labels/descriptions resolved via i18n at render time
const IMAGE_STYLES = [
  { id: 'abstract', labelKey: 'history.imageStyles.abstract', descKey: 'history.imageStyles.abstractDesc' },
  { id: 'minimalist', labelKey: 'history.imageStyles.minimalist', descKey: 'history.imageStyles.minimalistDesc' },
  { id: 'pixel-art', labelKey: 'history.imageStyles.pixelArt', descKey: 'history.imageStyles.pixelArtDesc' },
  { id: 'watercolor', labelKey: 'history.imageStyles.watercolor', descKey: 'history.imageStyles.watercolorDesc' },
  { id: 'modern', labelKey: 'history.imageStyles.modern', descKey: 'history.imageStyles.modernDesc' },
  { id: 'vintage', labelKey: 'history.imageStyles.vintage', descKey: 'history.imageStyles.vintageDesc' }
] as const

interface ProfileDetailViewProps {
  entry: HistoryEntry
  onBack: () => void
  onRunProfile?: (profileId: string, profileName: string) => void
  onEntryUpdated?: (entry: HistoryEntry) => void
  cachedImageUrl?: string
  aiConfigured?: boolean
  hideAiWhenUnavailable?: boolean
}

export function ProfileDetailView({ entry, onBack, onRunProfile, onEntryUpdated, cachedImageUrl, aiConfigured = true, hideAiWhenUnavailable = false }: ProfileDetailViewProps) {
  const { t } = useTranslation()
  const { downloadJson } = useHistory()
  const { invalidate: invalidateImageCache } = useProfileImageCache()
  const [isDownloading, setIsDownloading] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [showShotHistory, setShowShotHistory] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [imageUploadSuccess, setImageUploadSuccess] = useState(false)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)
  // Use cached image URL immediately if available, prevents delay on detail view
  const [profileImage, setProfileImage] = useState<string | null>(cachedImageUrl || null)
  const [imageCacheBuster, setImageCacheBuster] = useState(Date.now())
  const [showCropDialog, setShowCropDialog] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  // Image generation states
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<string>('abstract')
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  // Image preview states (for generated images)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [isApplyingImage, setIsApplyingImage] = useState(false)
  // Lightbox state for viewing profile image
  const [showLightbox, setShowLightbox] = useState(false)
  const resultsCardRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  
  // Machine profile ID for run/schedule functionality
  const [machineProfileId, setMachineProfileId] = useState<string | null>(null)
  
  // Notes state
  const [notes, setNotes] = useState<string>(entry.notes || '')
  const [isSavingNotes, setIsSavingNotes] = useState(false)

  // Profile edit state — separate modes for title vs details
  const [editingSection, setEditingSection] = useState<'title' | 'details' | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  // AI description regeneration state
  const [isRegeneratingDescription, setIsRegeneratingDescription] = useState(false)
  const [currentReply, setCurrentReply] = useState(entry.reply)
  const [editName, setEditName] = useState(entry.profile_name)
  const [editTemperature, setEditTemperature] = useState<string>(
    entry.profile_json?.temperature?.toString() ?? ''
  )
  const [editFinalWeight, setEditFinalWeight] = useState<string>(
    entry.profile_json?.final_weight?.toString() ?? ''
  )
  const [editVariables, setEditVariables] = useState<{ key: string; name: string; value: string; type: string }[]>(() => {
    const vars = (entry.profile_json as ProfileData | null)?.variables ?? []
    return vars
      .filter((v: { key: string }) => !v.key.startsWith('info_'))
      .map((v: { key: string; name: string; value: number; type: string }) => ({
        key: v.key,
        name: v.name,
        value: String(v.value),
        type: v.type,
      }))
  })

  // Sync local state when entry prop updates (e.g. after edit save)
  useEffect(() => {
    setNotes(entry.notes || '')
    setCurrentReply(entry.reply)
    setEditName(entry.profile_name)
    setEditTemperature(entry.profile_json?.temperature?.toString() ?? '')
    setEditFinalWeight(entry.profile_json?.final_weight?.toString() ?? '')
    const vars = (entry.profile_json as ProfileData | null)?.variables ?? []
    setEditVariables(
      vars
        .filter((v: { key: string }) => !v.key.startsWith('info_'))
        .map((v: { key: string; name: string; value: number; type: string }) => ({
          key: v.key, name: v.name, value: String(v.value), type: v.type,
        }))
    )
  }, [entry])

  const hasEditChanges = useMemo(() => {
    if (!editingSection) return false
    const pj = entry.profile_json as ProfileData | null
    if (editingSection === 'title') {
      return editName !== entry.profile_name
    }
    // details
    if (pj?.temperature !== undefined && editTemperature !== String(pj.temperature)) return true
    if (pj?.final_weight !== undefined && editFinalWeight !== String(pj.final_weight)) return true
    const origVars = (pj?.variables ?? []).filter((v: { key: string }) => !v.key.startsWith('info_'))
    for (const ev of editVariables) {
      const ov = origVars.find((v: { key: string }) => v.key === ev.key)
      if (ov && String(ov.value) !== ev.value) return true
    }
    return false
  }, [editingSection, editName, editTemperature, editFinalWeight, editVariables, entry])

  // Unsaved changes guard
  useEffect(() => {
    if (!hasEditChanges) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasEditChanges])

  const handleStartEdit = (section: 'title' | 'details') => {
    const pj = entry.profile_json as ProfileData | null
    setEditName(entry.profile_name)
    setEditTemperature(pj?.temperature?.toString() ?? '')
    setEditFinalWeight(pj?.final_weight?.toString() ?? '')
    setEditVariables(
      (pj?.variables ?? [])
        .filter((v: { key: string }) => !v.key.startsWith('info_'))
        .map((v: { key: string; name: string; value: number; type: string }) => ({
          key: v.key,
          name: v.name,
          value: String(v.value),
          type: v.type,
        }))
    )
    setEditingSection(section)
  }

  const handleCancelEdit = () => {
    if (hasEditChanges && !window.confirm(t('profileEdit.unsavedChanges'))) return
    setEditingSection(null)
  }

  const handleSaveEdit = async () => {
    const payload: Record<string, unknown> = {}

    if (editingSection === 'title') {
      if (!editName.trim()) {
        toast.error(t('profileEdit.nameRequired'))
        return
      }
      if (editName.trim() !== entry.profile_name) {
        payload.name = editName.trim()
      }
    } else {
      // details section
      const temp = editTemperature ? parseFloat(editTemperature) : undefined
      if (temp !== undefined && (isNaN(temp) || temp > 100)) {
        toast.error(t('profileEdit.temperatureMax'))
        return
      }
      if (temp !== undefined && temp < 70) {
        toast.warning(t('profileEdit.temperatureLow'))
      }
      const weight = editFinalWeight ? parseFloat(editFinalWeight) : undefined
      if (weight !== undefined && (isNaN(weight) || weight <= 0)) {
        toast.error(t('profileEdit.weightPositive'))
        return
      }

      if (temp !== undefined) payload.temperature = temp
      if (weight !== undefined) payload.final_weight = weight

      const changedVars = editVariables
        .filter(ev => {
          const pj = entry.profile_json as ProfileData | null
          const origVars = (pj?.variables ?? []).filter((v: { key: string }) => !v.key.startsWith('info_'))
          const ov = origVars.find((v: { key: string }) => v.key === ev.key)
          return ov && String(ov.value) !== ev.value
        })
        .map(ev => {
          const num = parseFloat(ev.value)
          return { key: ev.key, value: isNaN(num) ? ev.value : num }
        })
      if (changedVars.length > 0) payload.variables = changedVars
    }

    if (Object.keys(payload).length === 0) {
      toast.info(t('profileEdit.noChanges'))
      return
    }

    setIsSavingEdit(true)
    try {
      await profileService.updateProfile(
        entry.profile_name,
        payload as { name?: string; temperature?: number; final_weight?: number; variables?: { key: string; value: number | string }[] }
      )

      toast.success(t('profileEdit.saved'))
      setEditingSection(null)

      // Stay on page: re-fetch the updated history entry
      try {
        const serverUrl = await getServerUrl()
        const res = await fetch(`${serverUrl}/api/history/${entry.id}`)
        if (res.ok) {
          const updated = await res.json()
          onEntryUpdated?.(updated)
        }
      } catch {
        // Non-critical — entry still shows previous data
      }
    } catch (err) {
      console.error('Failed to save profile edit:', err)
      toast.error(err instanceof Error ? err.message : t('profileEdit.saveFailed'))
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Fetch machine profile ID by name
  useEffect(() => {
    const fetchMachineProfileId = async () => {
      if (!onRunProfile) return // Skip if callback not provided
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/machine/profiles`)
        if (response.ok) {
          const data = await response.json()
          const profiles = data.profiles || []
          const matchingProfile = profiles.find((p: { id: string; name: string }) => 
            p.name === entry.profile_name
          )
          if (matchingProfile) {
            setMachineProfileId(matchingProfile.id)
          }
        }
      } catch (err) {
        console.error('Failed to fetch machine profile ID:', err)
      }
    }
    fetchMachineProfileId()
  }, [entry.profile_name, onRunProfile])

  // Fetch profile image on mount only if not already cached
  // Also re-fetch when image is uploaded to show the new image
  useEffect(() => {
    // Skip fetch if we already have a cached image and no upload just succeeded
    if (cachedImageUrl && !imageUploadSuccess) {
      return
    }
    
    const fetchProfileImage = async () => {
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(
          `${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}`
        )
        if (response.ok) {
          const data = await response.json()
          if (data.profile?.image) {
            // Use the proxy endpoint to get the actual image with cache buster
            setProfileImage(`${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}/image-proxy?t=${imageCacheBuster}`)
          }
        }
      } catch (err) {
        console.error('Failed to fetch profile image:', err)
      }
    }
    fetchProfileImage()
  }, [entry.profile_name, imageUploadSuccess, imageCacheBuster, cachedImageUrl])

  const handleUploadProfileImage = async (blob: Blob) => {
    setIsUploadingImage(true)
    setImageUploadError(null)
    setImageUploadSuccess(false)
    
    try {
      const serverUrl = await getServerUrl()
      const formData = new FormData()
      formData.append('file', blob, 'profile-image.png')
      
      const response = await fetch(
        `${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}/image`,
        {
          method: 'POST',
          body: formData
        }
      )
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: t('history.uploadFailed') }))
        throw new Error(error.detail?.message || error.message || t('history.imageUploadFailed'))
      }
      
      // Invalidate the image cache so the catalogue will re-fetch
      invalidateImageCache(entry.profile_name)
      
      setImageUploadSuccess(true)
      setShowCropDialog(false)
      setCropImageSrc(null)
      // Reset success message after 3 seconds
      setTimeout(() => setImageUploadSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to upload profile image:', err)
      setImageUploadError(err instanceof Error ? err.message : t('history.imageUploadFailed'))
    } finally {
      setIsUploadingImage(false)
      // Reset file input
      if (imageInputRef.current) {
        imageInputRef.current.value = ''
      }
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setImageUploadError(t('history.selectImageFile'))
        return
      }
      // Create object URL for cropping
      const imageUrl = URL.createObjectURL(file)
      setCropImageSrc(imageUrl)
      setShowCropDialog(true)
    }
  }

  // Extract tags from user preferences for image generation
  const entryTags = useMemo(() => {
    return extractTagsFromPreferences(entry.user_preferences)
  }, [entry.user_preferences])

  const handleGenerateImage = async () => {
    setIsGeneratingImage(true)
    setGenerateError(null)
    
    try {
      const serverUrl = await getServerUrl()
      const tagsParam = entryTags.join(',')
      
      // Use preview mode to get the image without saving
      const response = await fetch(
        `${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}/generate-image?style=${selectedStyle}&tags=${encodeURIComponent(tagsParam)}&preview=true`,
        { method: 'POST' }
      )
      
      if (response.status === 402) {
        setGenerateError(t('history.paidKeyRequired'))
        return
      }
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: t('history.generationFailed') }))
        throw new Error(typeof error.detail === 'string' ? error.detail : error.detail?.message || t('history.imageGenerationFailed'))
      }
      
      const data = await response.json()
      
      // Show the preview dialog with the generated image
      if (data.image_data) {
        // Make sure we close any other dialogs first
        setShowLightbox(false)
        setPreviewImage(data.image_data)
        setShowPreviewDialog(true)
        setShowStylePicker(false)
      } else {
        throw new Error(t('history.noImageData'))
      }
    } catch (err) {
      console.error('Failed to generate image:', err)
      setGenerateError(err instanceof Error ? err.message : t('history.imageGenerationFailed'))
    } finally {
      setIsGeneratingImage(false)
    }
  }

  const handleApprovePreview = async () => {
    if (!previewImage) return
    
    setIsApplyingImage(true)
    
    try {
      const serverUrl = await getServerUrl()
      
      const response = await fetch(
        `${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}/apply-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_data: previewImage })
        }
      )
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: t('history.applyImageFailed') }))
        throw new Error(typeof error.detail === 'string' ? error.detail : t('history.applyImageFailed'))
      }
      
      // Close dialog and update image immediately
      const newCacheBuster = Date.now()
      setShowPreviewDialog(false)
      setPreviewImage(null)
      setImageCacheBuster(newCacheBuster)
      // Invalidate the image cache so the catalogue will re-fetch
      invalidateImageCache(entry.profile_name)
      // Immediately set the new profile image URL with cache buster
      setProfileImage(`${serverUrl}/api/profile/${encodeURIComponent(entry.profile_name)}/image-proxy?t=${newCacheBuster}`)
      setImageUploadSuccess(true)
      toast.success(t('history.imageApplied'))
      setTimeout(() => setImageUploadSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to apply image:', err)
      const errorMessage = err instanceof Error ? err.message : t('history.applyImageFailed')
      toast.error(errorMessage)
      // Still close the dialog on error - user can try again
      setShowPreviewDialog(false)
      setPreviewImage(null)
    } finally {
      setIsApplyingImage(false)
    }
  }

  const handleDiscardPreview = () => {
    setShowPreviewDialog(false)
    setPreviewImage(null)
  }

  const handleSaveNotes = async () => {
    setIsSavingNotes(true)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/history/${encodeURIComponent(entry.id)}/notes`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        }
      )
      
      if (!response.ok) {
        throw new Error('Failed to save notes')
      }
      
      toast.success(t('history.notesSaved'))
    } catch (err) {
      console.error('Failed to save notes:', err)
      toast.error(t('history.notesSaveFailed'))
    } finally {
      setIsSavingNotes(false)
    }
  }

  const handleRegenerateDescription = async () => {
    setIsRegeneratingDescription(true)
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/profile/${encodeURIComponent(entry.id)}/regenerate-description`,
        { method: 'POST' }
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to generate AI description')
      }
      const data = await response.json()
      setCurrentReply(data.description)
      toast.success(t('history.aiDescriptionGenerated'))
    } catch (err) {
      console.error('Failed to regenerate description:', err)
      toast.error(err instanceof Error ? err.message : t('history.aiDescriptionFailed'))
    } finally {
      setIsRegeneratingDescription(false)
    }
  }

  const handleDownload = async () => {
    try {
      setIsDownloading(true)
      await downloadJson(entry)
    } catch (err) {
      console.error('Failed to download:', err)
      alert(t('history.jsonNotAvailable'))
    } finally {
      setIsDownloading(false)
    }
  }

  const handleSaveImage = async () => {
    if (!resultsCardRef.current) return
    
    try {
      const safeFilename = (entry.profile_name || 'profile')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      
      setIsCapturing(true)
      
      // Wait for DOM to update
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Verify ref is still valid after await
      if (!resultsCardRef.current) {
        setIsCapturing(false)
        return
      }
      
      // Create a wrapper div with padding to avoid alignment offset issues
      // Applying padding via modern-screenshot's style option causes width miscalculation
      const element = resultsCardRef.current
      const elementWidth = element.offsetWidth
      
      const wrapper = document.createElement('div')
      wrapper.style.padding = '20px'
      wrapper.style.backgroundColor = '#09090b'
      wrapper.style.display = 'inline-block'
      
      // Clone the element to avoid modifying the DOM
      const clone = element.cloneNode(true) as HTMLElement
      // Preserve the original width - without this the clone expands to full viewport
      clone.style.width = `${elementWidth}px`
      wrapper.appendChild(clone)
      document.body.appendChild(wrapper)
      
      let dataUrl: string
      try {
        dataUrl = await domToPng(wrapper, {
          scale: 2,
          backgroundColor: '#09090b'
        })
      } finally {
        // Always clean up the wrapper
        document.body.removeChild(wrapper)
      }
      
      setIsCapturing(false)
      
      const link = document.createElement('a')
      link.download = `${safeFilename}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('Error saving results:', error)
      setIsCapturing(false)
      alert(t('history.saveImageFailed'))
    }
  }

  const parseProfileSections = (text: string | undefined | null) => {
    const sections: { title: string; content: string }[] = []
    if (!text) return sections
    // Note: 'Profile Created' is excluded as it's already shown in the header
    const sectionHeaders = [
      'Description',
      'Preparation',
      'Why This Works',
      'Special Notes'
    ]
    
    const remainingText = text
    
    sectionHeaders.forEach((header, index) => {
      // Handle both "Header:" and "**Header:**" formats
      const headerPattern = new RegExp(`\\*?\\*?${header}:\\*?\\*?\\s*`, 'i')
      const match = remainingText.match(headerPattern)
      
      if (match && match.index !== undefined) {
        const startIndex = match.index + match[0].length
        
        let endIndex = remainingText.length
        for (let i = index + 1; i < sectionHeaders.length; i++) {
          // Handle both "Header:" and "**Header:**" formats
          const nextHeaderPattern = new RegExp(`\\*?\\*?${sectionHeaders[i]}:`, 'i')
          const nextMatch = remainingText.match(nextHeaderPattern)
          if (nextMatch && nextMatch.index !== undefined) {
            endIndex = nextMatch.index
            break
          }
        }
        
        let content = remainingText.substring(startIndex, endIndex).trim()
        // Clean any remaining ** artifacts at start/end of content
        content = content.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '')
        
        // Stop at "PROFILE JSON" section
        const jsonSectionIndex = content.indexOf('PROFILE JSON')
        let finalContent = jsonSectionIndex > 0 
          ? content.substring(0, jsonSectionIndex).trim() 
          : content
        
        // Also remove any code blocks that might contain JSON
        finalContent = finalContent.replace(/```json[\s\S]*?```/g, '').trim()
        finalContent = finalContent.replace(/```[\s\S]*?```/g, '').trim()
        
        if (finalContent) {
          sections.push({ title: header, content: finalContent })
        }
      }
    })
    
    return sections
  }

  const sections = parseProfileSections(currentReply)

  // If showing shot history, render that component instead
  if (showShotHistory) {
    return (
      <ShotHistoryView 
        key={`shot-history-${entry.profile_name}`}
        profileName={entry.profile_name} 
        onBack={() => setShowShotHistory(false)} 
        aiConfigured={aiConfigured}
        hideAiWhenUnavailable={hideAiWhenUnavailable}
      />
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div ref={resultsCardRef} className={isCapturing ? 'w-[400px] mx-auto' : ''}>
        {isCapturing && (
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-2">
              <MeticAILogo size={40} variant="white" />
              <h1 className="text-4xl font-bold tracking-tight">
                Metic<span className="text-primary">AI</span>
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">{t('history.captureSubtitle')}</p>
          </div>
        )}
        <Card className={`p-6 ${isCapturing ? 'space-y-4' : 'space-y-5'}`}>
          {!isCapturing && (
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (hasEditChanges && !window.confirm(t('profileEdit.unsavedChanges'))) return
                  if (editingSection) setEditingSection(null)
                  onBack()
                }}
                className="shrink-0"
              >
                <CaretLeft size={22} weight="bold" />
              </Button>
              <div className="flex-1 min-w-0">
                {editingSection === 'title' ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      disabled={isSavingEdit}
                      className="h-8 text-lg font-bold"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit() }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 text-green-600 hover:text-green-700"
                      onClick={handleSaveEdit}
                      disabled={isSavingEdit}
                    >
                      {isSavingEdit ? <SpinnerGap size={16} className="animate-spin" weight="bold" /> : <Check size={16} weight="bold" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={handleCancelEdit}
                      disabled={isSavingEdit}
                    >
                      <X size={16} weight="bold" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <h2 className="text-lg font-bold text-foreground truncate">
                      {cleanProfileName(entry.profile_name)}
                    </h2>
                    {entry.profile_json && !editingSection && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-7 w-7 text-muted-foreground/60 hover:text-foreground"
                        onClick={() => handleStartEdit('title')}
                        title={t('profileEdit.editProfile')}
                      >
                        <PencilSimple size={14} weight="bold" />
                      </Button>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground/70">
                  {(() => {
                    if (!entry.created_at) return t('history.addedToMeticAI')
                    const date = new Date(entry.created_at)
                    if (isNaN(date.getTime())) return t('history.addedToMeticAI')
                    return date.toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  })()}
                </p>
              </div>
              {/* Profile Image with edit overlay */}
              <div className="relative shrink-0 group">
                <div 
                  className="w-12 h-12 rounded-full overflow-hidden border-2 border-primary/30 cursor-pointer hover:border-primary/50 transition-colors bg-secondary/60"
                  onClick={() => setShowLightbox(true)}
                  title={t('history.clickToEnlarge')}
                >
                  {profileImage ? (
                    <img 
                      src={profileImage} 
                      alt={entry.profile_name}
                      className="w-full h-full object-cover animate-in fade-in duration-300"
                      onError={() => setProfileImage(null)}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Coffee size={20} className="text-muted-foreground/40" weight="fill" />
                    </div>
                  )}
                </div>
                {/* Camera overlay */}
                <div
                  className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => setShowLightbox(true)}
                >
                  <Camera size={16} className="text-white" weight="fill" />
                </div>
              </div>
            </div>
          )}
          {isCapturing && (
            <div className="text-success w-full">
              <h2 className="text-2xl font-bold break-words">{cleanProfileName(entry.profile_name)}</h2>
            </div>
          )}

        {/* Action buttons — full width above two-column layout */}
        {!isCapturing && (
          <div className="flex flex-wrap gap-2.5">
            {/* Shot History Button */}
            <Button
              onClick={() => setShowShotHistory(true)}
              className="flex-1 min-w-[180px] h-12 text-sm font-semibold"
            >
              <ChartLine size={18} className="mr-2" weight="bold" />
              {t('history.shotHistoryAndAnalysis')}
            </Button>
            
            {/* Run / Schedule Button */}
            {onRunProfile && machineProfileId && (
              <Button
                onClick={() => onRunProfile(machineProfileId, entry.profile_name)}
                className="flex-1 min-w-[180px] h-12 text-sm font-semibold bg-success hover:bg-success/90"
              >
                <Play size={18} className="mr-2" weight="fill" />
                {t('results.runScheduleShot')}
              </Button>
            )}
          </div>
        )}

        {/* Two-column layout wrapper for desktop */}
        <div className="space-y-4 lg:space-y-0 desktop-two-col">
        {/* Left column: Content */}
        <div className="space-y-4 desktop-panel-left">
        <div className="space-y-4">
          {entry.coffee_analysis && (
            <motion.div 
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-2"
            >
              <Label className="text-sm font-semibold tracking-wide text-primary">
                {t('results.coffeeAnalysis')}
              </Label>
              <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                <p className="text-sm leading-relaxed text-foreground/90">
                  <MarkdownText>{entry.coffee_analysis}</MarkdownText>
                </p>
              </div>
            </motion.div>
          )}

          {sections.length > 0 ? (
            <div className="space-y-3">
              {sections.map((section, index) => (
                <motion.div 
                  key={index} 
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + index * 0.05 }}
                  className="space-y-2"
                >
                  <Label className="text-sm font-semibold tracking-wide text-amber-700 dark:text-amber-400">
                    {section.title}
                  </Label>
                  <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                      <MarkdownText>{section.content}</MarkdownText>
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-semibold tracking-wide text-amber-700 dark:text-amber-400">
                {t('results.profileLabel')}
              </Label>
              <div className="p-4 bg-secondary/50 dark:bg-secondary/60 rounded-xl border border-border/50">
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                  <MarkdownText>{currentReply}</MarkdownText>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Generate AI Explanation button — shown for static summaries when AI is available */}
        {!isCapturing && aiConfigured && currentReply?.includes('generated without AI assistance') && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Button
              variant="outline"
              className="w-full h-10 text-sm font-medium"
              onClick={handleRegenerateDescription}
              disabled={isRegeneratingDescription}
            >
              {isRegeneratingDescription ? (
                <SpinnerGap size={16} className="mr-2 animate-spin" />
              ) : (
                <MagicWand size={16} className="mr-2" weight="bold" />
              )}
              {isRegeneratingDescription
                ? t('history.generatingAiDescription')
                : t('history.generateAiDescription')}
            </Button>
          </motion.div>
        )}

        {/* Personal Notes Section */}
        {!isCapturing && (
          <motion.div 
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-2"
          >
            <Label className={`text-sm font-semibold tracking-wide ${notes ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
              {t('history.notes')}
            </Label>
            <MarkdownEditor
              value={notes}
              onChange={setNotes}
              onSave={handleSaveNotes}
              placeholder={t('history.notesPlaceholder')}
              saving={isSavingNotes}
            />
          </motion.div>
        )}

        </div>{/* end left column */}

        {/* Right column: Profile Details */}
        <div className="desktop-panel-right">
          {/* Save / Cancel bar when editing details */}
          {editingSection === 'details' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 mb-3"
            >
              <Button
                className="flex-1 h-9 text-sm font-semibold"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? (
                  <>
                    <SpinnerGap size={16} className="mr-1.5 animate-spin" weight="bold" />
                    {t('profileEdit.saving')}
                  </>
                ) : (
                  <>
                    <FloppyDisk size={16} className="mr-1.5" weight="bold" />
                    {t('common.save')}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-9 text-sm"
                onClick={handleCancelEdit}
                disabled={isSavingEdit}
              >
                {t('common.cancel')}
              </Button>
            </motion.div>
          )}
          {/* Edit details button */}
          {entry.profile_json && !editingSection && (
            <div className="flex justify-end mb-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground/60 hover:text-foreground gap-1"
                onClick={() => handleStartEdit('details')}
                title={t('profileEdit.editProfile')}
              >
                <PencilSimple size={14} weight="bold" />
                {t('profileEdit.editProfile')}
              </Button>
            </div>
          )}
          {/* Profile Technical Breakdown (inline editing when editing details) */}
          {entry.profile_json && (
            <ProfileBreakdown
              profile={entry.profile_json as ProfileData}
              editMode={editingSection === 'details'}
              editTemperature={editTemperature}
              onTemperatureChange={setEditTemperature}
              editFinalWeight={editFinalWeight}
              onFinalWeightChange={setEditFinalWeight}
              editVariables={editVariables}
              onVariableChange={(key, value) => {
                setEditVariables(prev => prev.map(v => v.key === key ? { ...v, value } : v))
              }}
              disabled={isSavingEdit}
            />
          )}
        </div>{/* end right column */}
        </div>{/* end two-column wrapper */}

        {/* Full-width actions below two-column layout */}
        {!isCapturing && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Profile Image Upload */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground block text-center">{t('history.profilePicture')}</Label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
                id="profile-image-upload"
              />
              <div className="grid grid-cols-2 gap-2">
                <label htmlFor="profile-image-upload">
                  <Button
                    variant="outline"
                    className="w-full h-11 text-sm font-semibold cursor-pointer"
                    disabled={isUploadingImage}
                    asChild
                  >
                    <span>
                      {isUploadingImage ? (
                        <>
                          <SpinnerGap size={18} className="mr-1.5 animate-spin" weight="bold" />
                          {t('history.uploading')}
                        </>
                      ) : imageUploadSuccess ? (
                        <>
                          <CheckCircle size={18} className="mr-1.5 text-success" weight="fill" />
                          {t('history.uploaded')}
                        </>
                      ) : (
                        <>
                          <Camera size={18} className="mr-1.5" weight="bold" />
                          {t('history.upload')}
                        </>
                      )}
                    </span>
                  </Button>
                </label>
                
                {/* AI Image Generation */}
                {(!hideAiWhenUnavailable || aiConfigured) && (
                  <Button
                    variant="outline"
                    className="w-full h-11 text-sm font-semibold border-dashed"
                    disabled={isGeneratingImage || !aiConfigured}
                    onClick={() => setShowStylePicker(!showStylePicker)}
                  >
                    {isGeneratingImage ? (
                      <>
                        <SpinnerGap size={18} className="mr-1.5 animate-spin" weight="bold" />
                        {t('history.generating')}
                      </>
                    ) : (
                      <>
                        <MagicWand size={18} className="mr-1.5" weight="bold" />
                        {t('history.generate')}
                      </>
                    )}
                  </Button>
                )}
              </div>
              {imageUploadError && (
                <p className="text-xs text-destructive text-center">{imageUploadError}</p>
              )}
              {!aiConfigured && !hideAiWhenUnavailable && (
                <p className="text-xs text-muted-foreground text-center">{t('history.aiImageUnavailable')}</p>
              )}
              <p className="text-[10px] text-muted-foreground/60 text-center">
                {t('history.imageSyncNote')}
              </p>
              
              <AnimatePresence>
                  {showStylePicker && !isGeneratingImage && aiConfigured && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 p-3 bg-secondary/40 rounded-lg border border-border/20 space-y-3">
                        <Label className="text-xs font-medium text-muted-foreground">{t('history.selectStyle')}</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {IMAGE_STYLES.map((style) => (
                            <button
                              key={style.id}
                              onClick={() => setSelectedStyle(style.id)}
                              className={`p-2 text-left rounded-md border transition-all ${
                                selectedStyle === style.id
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border/30 hover:border-border/50 text-foreground/80'
                              }`}
                            >
                              <div className="text-xs font-medium">{t(style.labelKey)}</div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">{t(style.descKey)}</div>
                            </button>
                          ))}
                        </div>
                        
                        <Button
                          onClick={handleGenerateImage}
                          className="w-full h-10 text-sm font-semibold"
                          disabled={isGeneratingImage}
                        >
                          <MagicWand size={16} className="mr-1.5" weight="bold" />
                          {t('history.generateStyleImage', { style: selectedStyle.charAt(0).toUpperCase() + selectedStyle.slice(1) })}
                        </Button>
                        
                        {generateError && (
                          <p className="text-xs text-destructive text-center">{generateError}</p>
                        )}
                        
                        <div className="flex items-start gap-1.5 p-2 bg-amber-500/10 rounded-md border border-amber-500/20">
                          <Info size={14} className="text-amber-500 shrink-0 mt-0.5" weight="fill" />
                          <p className="text-[10px] text-amber-500/90 leading-relaxed">
                            {t('history.paidKeyWarning')}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
            </div>
            
            {/* Export Buttons */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground block text-center">{t('history.exportAs')}</Label>
              <div className={`grid gap-2.5 ${entry.profile_json ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <Button
                  onClick={handleSaveImage}
                  variant="outline"
                  className="h-11 text-sm font-semibold"
                  title={t('results.saveAsImage')}
                >
                  <Image size={18} className="mr-1.5" weight="bold" />
                  {t('results.image')}
                </Button>
                {entry.profile_json && (
                  <Button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    variant="outline"
                    className="h-11 text-sm font-semibold"
                  >
                    <FileJs size={18} className="mr-1.5" weight="bold" />
                    {t('results.json')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        </Card>
      </div>
      
      {/* Image Crop Dialog */}
      {cropImageSrc && (
        <ImageCropDialog
          open={showCropDialog}
          onOpenChange={(open) => {
            setShowCropDialog(open)
            if (!open) {
              URL.revokeObjectURL(cropImageSrc)
              setCropImageSrc(null)
            }
          }}
          imageSrc={cropImageSrc}
          onCropComplete={handleUploadProfileImage}
          isUploading={isUploadingImage}
        />
      )}

      {/* Lightbox for Profile Image */}
      <AnimatePresence>
        {showLightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowLightbox(false)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="relative max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute -top-12 right-0 text-white hover:bg-white/20"
                onClick={() => setShowLightbox(false)}
              >
                <XCircle size={28} weight="bold" />
              </Button>
              {profileImage ? (
                <div className="rounded-2xl overflow-hidden border-4 border-primary/30 shadow-2xl">
                  <img 
                    src={profileImage} 
                    alt={entry.profile_name}
                    className="w-full h-auto object-contain"
                    onError={() => {
                      setProfileImage(null)
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border-4 border-primary/30 shadow-2xl bg-secondary/80 flex items-center justify-center h-64">
                  <Coffee size={64} className="text-muted-foreground/30" weight="fill" />
                </div>
              )}
              <p className="text-center text-white/80 mt-4 text-sm font-medium">{cleanProfileName(entry.profile_name)}</p>
              {/* Image actions in lightbox */}
              <div className="flex gap-2 mt-4 justify-center">
                <Button
                  variant="outline"
                  className="h-10 text-sm font-semibold bg-white/10 border-white/20 text-white hover:bg-white/20"
                  disabled={isUploadingImage}
                  onClick={() => {
                    setShowLightbox(false)
                    imageInputRef.current?.click()
                  }}
                >
                  {isUploadingImage ? (
                    <SpinnerGap size={16} className="mr-1.5 animate-spin" weight="bold" />
                  ) : (
                    <Camera size={16} className="mr-1.5" weight="bold" />
                  )}
                  {t('history.upload')}
                </Button>
                {(!hideAiWhenUnavailable || aiConfigured) && (
                  <Button
                    variant="outline"
                    className="h-10 text-sm font-semibold bg-white/10 border-white/20 text-white hover:bg-white/20 border-dashed"
                    disabled={isGeneratingImage || !aiConfigured}
                    onClick={() => {
                      setShowLightbox(false)
                      setShowStylePicker(true)
                    }}
                  >
                    {isGeneratingImage ? (
                      <SpinnerGap size={16} className="mr-1.5 animate-spin" weight="bold" />
                    ) : (
                      <MagicWand size={16} className="mr-1.5" weight="bold" />
                    )}
                    {t('history.generate')}
                  </Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Dialog for Generated Image */}
      <AnimatePresence>
        {showPreviewDialog && previewImage && (
          <motion.div
            key="preview-dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => handleDiscardPreview()}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative max-w-md w-full bg-card rounded-2xl p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-center mb-4">{t('history.generatedImagePreview')}</h3>
              <div className="rounded-xl overflow-hidden border-2 border-primary/30 mb-6">
                <img 
                  key={previewImage?.substring(0, 100)}
                  src={previewImage}
                  alt={t('history.generatedPreviewAlt')}
                  className="w-full h-auto object-contain"
                />
              </div>
              <p className="text-sm text-muted-foreground text-center mb-6">
                {t('history.useImagePrompt')}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12"
                  onClick={handleDiscardPreview}
                  disabled={isApplyingImage}
                >
                  <XCircle size={20} className="mr-2" weight="bold" />
                  {t('history.discard')}
                </Button>
                <Button
                  className="flex-1 h-12"
                  onClick={handleApprovePreview}
                  disabled={isApplyingImage}
                >
                  {isApplyingImage ? (
                    <SpinnerGap size={20} className="mr-2 animate-spin" weight="bold" />
                  ) : (
                    <Check size={20} className="mr-2" weight="bold" />
                  )}
                  {isApplyingImage ? t('history.applying') : t('history.apply')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
