import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  X
} from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

interface MachineProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  final_weight?: number
  in_history: boolean
  has_description: boolean
}

interface ProfileCatalogueViewProps {
  onBack: () => void
}

export function ProfileCatalogueView({ onBack }: ProfileCatalogueViewProps) {
  const { t } = useTranslation()
  
  // State
  const [profiles, setProfiles] = useState<MachineProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  
  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  
  // Fetch profiles from machine
  const fetchProfiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`${getServerUrl()}/api/machine/profiles`)
      if (!response.ok) {
        throw new Error('Failed to fetch profiles')
      }
      
      const data = await response.json()
      setProfiles(data.profiles || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profiles'
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])
  
  // Rename profile
  const handleRename = async (profileId: string) => {
    if (!renameValue.trim()) {
      toast.error(t('profileCatalogue.nameRequired'))
      return
    }
    
    setIsRenaming(true)
    
    try {
      const response = await fetch(`${getServerUrl()}/api/machine/profile/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() })
      })
      
      if (!response.ok) {
        throw new Error('Failed to rename profile')
      }
      
      const result = await response.json()
      toast.success(t('profileCatalogue.renamed', { name: result.new_name }))
      
      // Refresh list
      await fetchProfiles()
      setRenamingId(null)
      setRenameValue('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename profile'
      toast.error(message)
    } finally {
      setIsRenaming(false)
    }
  }
  
  // Delete profile
  const handleDelete = async (profileId: string) => {
    setDeletingId(profileId)
    
    try {
      const response = await fetch(`${getServerUrl()}/api/machine/profile/${profileId}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        throw new Error('Failed to delete profile')
      }
      
      toast.success(t('profileCatalogue.deleted'))
      
      // Refresh list
      await fetchProfiles()
      setConfirmDeleteId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete profile'
      toast.error(message)
    } finally {
      setDeletingId(null)
    }
  }
  
  // Export profile JSON
  const handleExport = async (profile: MachineProfile) => {
    try {
      const response = await fetch(`${getServerUrl()}/api/machine/profile/${profile.id}/json`)
      if (!response.ok) {
        throw new Error('Failed to export profile')
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
      const message = err instanceof Error ? err.message : 'Failed to export profile'
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
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
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProfiles}
            disabled={isLoading}
          >
            <ArrowsClockwise className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t('profileCatalogue.refresh')}
          </Button>
        </div>
        
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
        
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {profiles.map((profile) => (
              <motion.div
                key={profile.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Profile icon */}
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Coffee className="w-5 h-5 text-muted-foreground" />
                    </div>
                    
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
                          <h3 className="font-medium truncate">{profile.name}</h3>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            {profile.author && <span>{profile.author}</span>}
                            {profile.temperature && (
                              <span>{profile.temperature}°C</span>
                            )}
                            {profile.final_weight && (
                              <span>{profile.final_weight}g</span>
                            )}
                          </div>
                          {profile.in_history && (
                            <span className="inline-flex items-center text-xs text-green-600 dark:text-green-400 mt-1">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              {t('profileCatalogue.inHistory')}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    
                    {/* Actions */}
                    {renamingId !== profile.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleExport(profile)}
                          title={t('profileCatalogue.export')}
                        >
                          <FileJs className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startRename(profile)}
                          title={t('profileCatalogue.rename')}
                        >
                          <PencilSimple className="w-4 h-4" />
                        </Button>
                        {confirmDeleteId === profile.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(profile.id)}
                              disabled={deletingId === profile.id}
                            >
                              {deletingId === profile.id ? (
                                <SpinnerGap className="w-4 h-4 animate-spin" />
                              ) : (
                                t('profileCatalogue.confirmDelete')
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deletingId === profile.id}
                            >
                              {t('profileCatalogue.cancel')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDeleteId(profile.id)}
                            title={t('profileCatalogue.delete')}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
