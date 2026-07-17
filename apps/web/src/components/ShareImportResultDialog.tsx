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
import { CheckCircle, Warning, SpinnerGap } from '@phosphor-icons/react'

/**
 * Outcome of an automatic profile import (share sheet or `?import=` deep link).
 * `importing` is the in-flight state shown while the resolver does its work.
 */
export type ShareImportState =
  | { status: 'importing' }
  | { status: 'success'; profileName: string }
  | { status: 'exists'; profileName: string }
  | { status: 'error'; message: string | null }

interface ShareImportResultDialogProps {
  state: ShareImportState | null
  onClose: () => void
}

/**
 * A central confirmation popover shown after a profile is shared to Metic (or
 * opened via `?import=`). The profile is imported automatically; this just tells
 * the user whether it worked, and why not if it failed.
 */
export function ShareImportResultDialog({ state, onClose }: ShareImportResultDialogProps) {
  const { t } = useTranslation()
  if (!state) return null

  const isImporting = state.status === 'importing'

  const icon =
    state.status === 'error' ? (
      <Warning className="w-12 h-12 text-destructive" weight="fill" />
    ) : state.status === 'importing' ? (
      <SpinnerGap className="w-12 h-12 text-primary animate-spin" />
    ) : (
      <CheckCircle className="w-12 h-12 text-primary" weight="fill" />
    )

  let title: string
  let description: string
  switch (state.status) {
    case 'importing':
      title = t('profileImport.shareResult.importingTitle')
      description = t('profileImport.shareResult.importingBody')
      break
    case 'success':
      title = t('profileImport.shareResult.successTitle')
      description = t('profileImport.shareResult.successBody', { name: state.profileName })
      break
    case 'exists':
      title = t('profileImport.shareResult.existsTitle')
      description = t('profileImport.shareResult.existsBody', { name: state.profileName })
      break
    case 'error':
      title = t('profileImport.shareResult.errorTitle')
      description = state.message
        ? t('profileImport.shareResult.errorBodyWithReason', { reason: state.message })
        : t('profileImport.shareResult.errorBody')
      break
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isImporting && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex justify-center">{icon}</div>
          <DialogTitle className="text-center">{title}</DialogTitle>
          <DialogDescription className="text-center break-words">{description}</DialogDescription>
        </DialogHeader>
        {!isImporting && (
          <DialogFooter>
            <Button className="w-full" data-sound="close" onClick={onClose}>
              {t('common.done')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
