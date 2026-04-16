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
import { SpinnerGap, Trash, Archive, Desktop } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getServerUrl } from '@/lib/config'

type DeleteMode = 'both' | 'machine-only' | 'meticai-only'

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

  const deleteFromMachine = async (serverUrl: string) => {
    const response = await fetch(`${serverUrl}/api/machine/profile/${profileId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(t('profileCatalogue.errors.deleteFromMachineFailed'))
    }
  }

  const deleteFromMeticai = async (serverUrl: string) => {
    if (!historyId) {
      throw new Error(t('profileCatalogue.errors.removeFromHistoryFailed'))
    }
    const response = await fetch(`${serverUrl}/api/history/${historyId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(t('profileCatalogue.errors.removeFromHistoryFailed'))
    }
  }

  const handleDelete = async (mode: DeleteMode) => {
    setIsDeleting(true)

    try {
      const serverUrl = await getServerUrl()

      if (mode === 'both') {
        await deleteFromMachine(serverUrl)
        await deleteFromMeticai(serverUrl)
        toast.success(t('profileCatalogue.deleted'))
      } else if (mode === 'machine-only') {
        await deleteFromMachine(serverUrl)
        toast.success(t('profileCatalogue.deleted'))
      } else {
        await deleteFromMeticai(serverUrl)
        toast.success(t('profileCatalogue.removedFromHistory'))
      }

      onDeleted()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('profileCatalogue.errors.deleteProfileFailed')
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('profileCatalogue.deleteDescription', { name: profileName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-1">
          <Button
            variant="outline"
            className="justify-start gap-3 h-auto py-2.5 px-3 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={() => handleDelete('machine-only')}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <SpinnerGap className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Desktop className="w-4 h-4 shrink-0" />
            )}
            <span className="text-sm font-medium">{t('profileCatalogue.deleteFromMachine')}</span>
          </Button>

          {historyId && (
            <>
              <Button
                variant="outline"
                className="justify-start gap-3 h-auto py-2.5 px-3"
                onClick={() => handleDelete('meticai-only')}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <SpinnerGap className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Archive className="w-4 h-4 shrink-0" />
                )}
                <span className="text-sm font-medium">{t('profileCatalogue.removeFromHistoryOnly')}</span>
              </Button>

              <div className="border-t my-1" />

              <Button
                variant="destructive"
                className="justify-start gap-3 h-auto py-2.5 px-3"
                onClick={() => handleDelete('both')}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <SpinnerGap className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Trash className="w-4 h-4 shrink-0" />
                )}
                <span className="text-sm font-medium">{t('profileCatalogue.deleteFromBoth')}</span>
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" data-sound="close" onClick={onClose} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
