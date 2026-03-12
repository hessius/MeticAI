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
import { SpinnerGap, Trash, Archive } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getServerUrl } from '@/lib/config'

interface DeleteProfileDialogProps {
  isOpen: boolean
  profileId: string
  profileName: string
  historyId?: string
  onClose: () => void
  onDeleted: () => void
}

export function DeleteProfileDialog({
  isOpen,
  profileId,
  profileName,
  historyId,
  onClose,
  onDeleted,
}: DeleteProfileDialogProps) {
  const { t } = useTranslation()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleRemoveFromHistory = async () => {
    if (!historyId) return
    setIsDeleting(true)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/history/${historyId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error(t('profileCatalogue.errors.removeFromHistoryFailed'))

      toast.success(t('profileCatalogue.removedFromHistory'))
      onDeleted()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('profileCatalogue.errors.removeFromHistoryFailed')
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteFromMachine = async () => {
    setIsDeleting(true)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/machine/profile/${profileId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) throw new Error(t('profileCatalogue.errors.deleteFromMachineFailed'))

      toast.success(t('profileCatalogue.deleted'))
      onDeleted()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('profileCatalogue.errors.deleteProfileFailed')
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('profileCatalogue.deleteDescription', { name: profileName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {historyId && (
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3 px-4"
              onClick={handleRemoveFromHistory}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <SpinnerGap className="w-5 h-5 animate-spin shrink-0" />
              ) : (
                <Archive className="w-5 h-5 shrink-0" />
              )}
              <div className="text-left">
                <div className="font-medium">
                  {t('profileCatalogue.removeFromHistoryOnly')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('profileCatalogue.removeFromHistoryHint')}
                </div>
              </div>
            </Button>
          )}

          <Button
            variant="destructive"
            className="justify-start gap-2 h-auto py-3 px-4"
            onClick={handleDeleteFromMachine}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <SpinnerGap className="w-5 h-5 animate-spin shrink-0" />
            ) : (
              <Trash className="w-5 h-5 shrink-0" />
            )}
            <div className="text-left">
              <div className="font-medium">
                {t('profileCatalogue.deleteFromMachine')}
              </div>
              <div className="text-xs text-destructive-foreground/70">
                {t('profileCatalogue.deleteFromMachineHint')}
              </div>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
