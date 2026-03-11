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
  entry: OrphanedEntry | null
  onClose: () => void
  onResolved: () => void
}

export function OrphanResolutionDialog({
  isOpen,
  entry,
  onClose,
  onResolved,
}: OrphanResolutionDialogProps) {
  const { t } = useTranslation()
  const [isProcessing, setIsProcessing] = useState(false)

  if (!entry) return null

  const handleKeep = () => {
    onClose()
  }

  const handleRemoveFromHistory = async () => {
    setIsProcessing(true)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history/${entry.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error(t('profileCatalogue.errors.removeFromHistoryFailed'))

      toast.success(t('profileCatalogue.removedFromHistory'))
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('profileCatalogue.errors.removeFromHistoryFailed')
      toast.error(message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRestoreToMachine = async () => {
    setIsProcessing(true)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/machine/profile/restore/${entry.id}`,
        { method: 'POST' }
      )

      if (!response.ok) throw new Error(t('profileCatalogue.errors.restoreToMachineFailed'))

      toast.success(
        t('profileCatalogue.restoredToMachine', {
          name: entry.profile_name,
        })
      )
      onResolved()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('profileCatalogue.errors.restoreProfileFailed')
      toast.error(message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.orphanTitle')}</DialogTitle>
          <DialogDescription>
            {t('profileCatalogue.orphanDescription', {
              name: entry.profile_name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <Button
            variant="outline"
            className="justify-start gap-2 h-auto py-3 px-4"
            onClick={handleKeep}
            disabled={isProcessing}
          >
            <CheckCircle className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="font-medium">
                {t('profileCatalogue.keepInHistory')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('profileCatalogue.keepInHistoryHint')}
              </div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="justify-start gap-2 h-auto py-3 px-4"
            onClick={handleRemoveFromHistory}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <SpinnerGap className="w-5 h-5 animate-spin shrink-0" />
            ) : (
              <Trash className="w-5 h-5 shrink-0" />
            )}
            <div className="text-left">
              <div className="font-medium">
                {t('profileCatalogue.removeFromHistoryOnly')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('profileCatalogue.removeOrphanHint')}
              </div>
            </div>
          </Button>

          {entry.has_profile_json && (
            <Button
              variant="default"
              className="justify-start gap-2 h-auto py-3 px-4"
              onClick={handleRestoreToMachine}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <SpinnerGap className="w-5 h-5 animate-spin shrink-0" />
              ) : (
                <ArrowsClockwise className="w-5 h-5 shrink-0" />
              )}
              <div className="text-left">
                <div className="font-medium">
                  {t('profileCatalogue.restoreToMachine')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('profileCatalogue.restoreToMachineHint')}
                </div>
              </div>
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
