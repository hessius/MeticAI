import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SpinnerGap,
  ArrowsClockwise,
  Plus,
  Trash,
  Warning,
  CheckCircle,
  CloudArrowDown,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getServerUrl } from '@/lib/config'

interface SyncNewProfile {
  profile_id: string
  profile_name: string
  content_hash: string
}

interface SyncUpdatedProfile {
  profile_id: string
  profile_name: string
  history_id: string
  stored_hash: string
  current_hash: string
}

interface SyncOrphanedEntry {
  id: string
  profile_name: string
  created_at?: string
  has_profile_json: boolean
}

export interface SyncResults {
  new: SyncNewProfile[]
  updated: SyncUpdatedProfile[]
  orphaned: SyncOrphanedEntry[]
}

interface SyncReportProps {
  isOpen: boolean
  results: SyncResults | null
  onClose: () => void
  onResolved: () => void
}

export function SyncReport({
  isOpen,
  results,
  onClose,
  onResolved,
}: SyncReportProps) {
  const { t } = useTranslation()
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [aiDescription, setAiDescription] = useState(false)

  if (!results) return null

  const isEmpty =
    results.new.length === 0 &&
    results.updated.length === 0 &&
    results.orphaned.length === 0

  const markProcessing = (id: string) =>
    setProcessingIds((prev) => new Set(prev).add(id))
  const clearProcessing = (id: string) =>
    setProcessingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const handleImport = async (profile: SyncNewProfile) => {
    markProcessing(profile.profile_id)
    try {
      const serverUrl = await getServerUrl()
      // Fetch the profile JSON from machine, then import it
      const jsonRes = await fetch(
        `${serverUrl}/api/machine/profile/${profile.profile_id}/json`
      )
      if (!jsonRes.ok) throw new Error(t('sync.fetchProfileFailed'))
      const { profile: profileJson } = await jsonRes.json()

      const importRes = await fetch(`${serverUrl}/api/profile/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: profileJson,
          source: 'machine',
          generate_description: aiDescription,
        }),
      })
      if (!importRes.ok) throw new Error(t('sync.importProfileFailed'))

      toast.success(
        t('profileCatalogue.sync.imported', { name: profile.profile_name })
      )
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('sync.importProfileFailed')
      toast.error(message)
    } finally {
      clearProcessing(profile.profile_id)
    }
  }

  const handleAcceptUpdate = async (profile: SyncUpdatedProfile) => {
    markProcessing(profile.profile_id)
    try {
      const serverUrl = await getServerUrl()
      const res = await fetch(
        `${serverUrl}/api/profiles/sync/accept/${profile.profile_id}?ai_description=${aiDescription}`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error(t('sync.acceptUpdateFailed'))

      toast.success(
        t('profileCatalogue.sync.accepted', { name: profile.profile_name })
      )
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('sync.acceptUpdateFailed')
      toast.error(message)
    } finally {
      clearProcessing(profile.profile_id)
    }
  }

  const handleRemoveOrphan = async (entry: SyncOrphanedEntry) => {
    markProcessing(entry.id)
    try {
      const serverUrl = await getServerUrl()
      const res = await fetch(`${serverUrl}/api/history/${entry.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(t('sync.removeFailed'))

      toast.success(t('profileCatalogue.removedFromHistory'))
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('sync.removeFailed')
      toast.error(message)
    } finally {
      clearProcessing(entry.id)
    }
  }

  const handleRestoreOrphan = async (entry: SyncOrphanedEntry) => {
    markProcessing(entry.id)
    try {
      const serverUrl = await getServerUrl()
      const res = await fetch(
        `${serverUrl}/api/machine/profile/restore/${entry.id}`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error(t('sync.restoreFailed'))

      toast.success(
        t('profileCatalogue.restoredToMachine', {
          name: entry.profile_name,
        })
      )
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('sync.restoreFailed')
      toast.error(message)
    } finally {
      clearProcessing(entry.id)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.sync.title')}</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? t('profileCatalogue.sync.allInSync')
              : t('profileCatalogue.sync.description')}
          </DialogDescription>
        </DialogHeader>

        {!isEmpty && (
          <div className="flex items-center gap-2 py-2 px-1">
            <Switch
              id="ai-desc-toggle"
              checked={aiDescription}
              onCheckedChange={setAiDescription}
            />
            <Label htmlFor="ai-desc-toggle" className="text-sm cursor-pointer">
              {t('profileCatalogue.sync.aiDescriptionToggle')}
            </Label>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* New Profiles */}
          {results.new.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Plus className="w-4 h-4" />
                {t('profileCatalogue.sync.newSection', {
                  count: results.new.length,
                })}
              </h3>
              {results.new.map((profile) => (
                <Card key={profile.profile_id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {profile.profile_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('profileCatalogue.sync.newHint')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleImport(profile)}
                      disabled={processingIds.has(profile.profile_id)}
                    >
                      {processingIds.has(profile.profile_id) ? (
                        <SpinnerGap className="w-4 h-4 animate-spin mr-1" />
                      ) : (
                        <CloudArrowDown className="w-4 h-4 mr-1" />
                      )}
                      {t('profileCatalogue.sync.import')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Updated Profiles */}
          {results.updated.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <ArrowsClockwise className="w-4 h-4" />
                {t('profileCatalogue.sync.updatedSection', {
                  count: results.updated.length,
                })}
              </h3>
              {results.updated.map((profile) => (
                <Card key={profile.profile_id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {profile.profile_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('profileCatalogue.sync.updatedHint')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAcceptUpdate(profile)}
                      disabled={processingIds.has(profile.profile_id)}
                    >
                      {processingIds.has(profile.profile_id) ? (
                        <SpinnerGap className="w-4 h-4 animate-spin mr-1" />
                      ) : (
                        <CheckCircle className="w-4 h-4 mr-1" />
                      )}
                      {t('profileCatalogue.sync.accept')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Orphaned Profiles */}
          {results.orphaned.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Warning className="w-4 h-4" />
                {t('profileCatalogue.sync.orphanedSection', {
                  count: results.orphaned.length,
                })}
              </h3>
              {results.orphaned.map((entry) => (
                <Card key={entry.id} className="p-3 opacity-75 border-dashed">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {entry.profile_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('profileCatalogue.sync.orphanedHint')}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {entry.has_profile_json && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestoreOrphan(entry)}
                          disabled={processingIds.has(entry.id)}
                          title={t('profileCatalogue.restoreToMachine')}
                        >
                          {processingIds.has(entry.id) ? (
                            <SpinnerGap className="w-4 h-4 animate-spin" />
                          ) : (
                            <ArrowsClockwise className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveOrphan(entry)}
                        disabled={processingIds.has(entry.id)}
                        title={t('profileCatalogue.removeFromHistoryOnly')}
                        className="text-destructive hover:text-destructive"
                      >
                        {processingIds.has(entry.id) ? (
                          <SpinnerGap className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" data-sound="close" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
