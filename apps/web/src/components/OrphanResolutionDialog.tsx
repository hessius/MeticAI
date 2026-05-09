import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SpinnerGap, Trash, ArrowsClockwise, CheckCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getServerUrl } from '@/lib/config'

interface OrphanedEntry {
  id: string
  profile_name: string
  created_at?: string
  has_profile_json: boolean
}

interface OrphanResolutionDialogProps {
  isOpen: boolean
  entries: OrphanedEntry[]
  onClose: () => void
  onResolved: () => void
}

export function OrphanResolutionDialog({
  isOpen,
  entries,
  onClose,
  onResolved,
}: OrphanResolutionDialogProps) {
  const { t } = useTranslation()
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [isBatchProcessing, setIsBatchProcessing] = useState(false)

  const remainingEntries = entries.filter(e => !resolvedIds.has(e.id))
  const canRestoreAll = remainingEntries.some(e => e.has_profile_json)

  const handleClose = () => {
    if (resolvedIds.size > 0) onResolved()
    setResolvedIds(new Set())
    onClose()
  }

  const removeEntry = async (entry: OrphanedEntry) => {
    setProcessingIds(prev => new Set(prev).add(entry.id))
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history/${entry.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(t('profileCatalogue.errors.removeFromHistoryFailed'))
      toast.success(t('profileCatalogue.removedFromHistory'))
      setResolvedIds(prev => new Set(prev).add(entry.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profileCatalogue.errors.removeFromHistoryFailed'))
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(entry.id); return n })
    }
  }

  const restoreEntry = async (entry: OrphanedEntry) => {
    setProcessingIds(prev => new Set(prev).add(entry.id))
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/machine/profile/restore/${entry.id}`, { method: 'POST' })
      if (!response.ok) throw new Error(t('profileCatalogue.errors.restoreToMachineFailed'))
      toast.success(t('profileCatalogue.restoredToMachine', { name: entry.profile_name }))
      setResolvedIds(prev => new Set(prev).add(entry.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profileCatalogue.errors.restoreProfileFailed'))
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(entry.id); return n })
    }
  }

  const handleRemoveAll = async () => {
    setIsBatchProcessing(true)
    for (const entry of remainingEntries) {
      await removeEntry(entry)
    }
    setIsBatchProcessing(false)
  }

  const handleRestoreAll = async () => {
    setIsBatchProcessing(true)
    for (const entry of remainingEntries.filter(e => e.has_profile_json)) {
      await restoreEntry(entry)
    }
    setIsBatchProcessing(false)
  }

  if (remainingEntries.length === 0 && resolvedIds.size > 0) {
    // All resolved — auto-close after a short delay to show final toast
    setTimeout(handleClose, 300)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.orphanedSection')}</DialogTitle>
          <DialogDescription>
            {t('profileCatalogue.orphanBanner', { count: remainingEntries.length })}
          </DialogDescription>
        </DialogHeader>

        {/* Batch actions */}
        {remainingEntries.length > 1 && (
          <div className="flex gap-2 pb-2 border-b border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemoveAll}
              disabled={isBatchProcessing}
              className="gap-1.5"
            >
              {isBatchProcessing ? <SpinnerGap className="w-4 h-4 animate-spin" /> : <Trash className="w-4 h-4" />}
              {t('profileCatalogue.removeFromHistoryOnly')} ({remainingEntries.length})
            </Button>
            {canRestoreAll && (
              <Button
                variant="default"
                size="sm"
                onClick={handleRestoreAll}
                disabled={isBatchProcessing}
                className="gap-1.5"
              >
                {isBatchProcessing ? <SpinnerGap className="w-4 h-4 animate-spin" /> : <ArrowsClockwise className="w-4 h-4" />}
                {t('profileCatalogue.restoreToMachine')} ({remainingEntries.filter(e => e.has_profile_json).length})
              </Button>
            )}
          </div>
        )}

        {/* Individual entries */}
        <div className="flex flex-col gap-3 py-2 overflow-y-auto">
          {remainingEntries.map((entry) => {
            const isProcessing = processingIds.has(entry.id)
            return (
              <div key={entry.id} className="flex items-center gap-3 p-3 bg-secondary/40 rounded-lg">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{entry.profile_name}</h4>
                  <p className="text-xs text-muted-foreground">{t('profileCatalogue.orphanHint')}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEntry(entry)}
                    disabled={isProcessing || isBatchProcessing}
                    title={t('profileCatalogue.removeFromHistoryOnly')}
                  >
                    {isProcessing ? <SpinnerGap className="w-4 h-4 animate-spin" /> : <Trash className="w-4 h-4" />}
                  </Button>
                  {entry.has_profile_json && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => restoreEntry(entry)}
                      disabled={isProcessing || isBatchProcessing}
                      title={t('profileCatalogue.restoreToMachine')}
                    >
                      {isProcessing ? <SpinnerGap className="w-4 h-4 animate-spin" /> : <ArrowsClockwise className="w-4 h-4" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setResolvedIds(prev => new Set(prev).add(entry.id))}
                    disabled={isProcessing || isBatchProcessing}
                    title={t('profileCatalogue.keepInHistory')}
                  >
                    <CheckCircle className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" data-sound="close" onClick={handleClose} disabled={isBatchProcessing}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
