import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SpinnerGap, Trash, Coffee } from '@phosphor-icons/react'
import { toast } from 'sonner'
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

interface BulkDeleteDialogProps {
  isOpen: boolean
  profiles: MachineProfile[]
  onClose: () => void
  onDeleted: () => void
}

export function BulkDeleteDialog({
  isOpen,
  profiles,
  onClose,
  onDeleted,
}: BulkDeleteDialogProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // Only show profiles NOT in the catalogue
  const deletable = useMemo(
    () => profiles.filter((p) => !p.in_history),
    [profiles],
  )

  const toggleProfile = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === deletable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(deletable.map((p) => p.id)))
    }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    setIsDeleting(true)

    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(
        `${serverUrl}/api/machine/profiles/bulk-delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_ids: Array.from(selected) }),
        },
      )

      if (!response.ok)
        throw new Error(t('profileCatalogue.bulkDelete.failed'))

      const data = await response.json()

      if (data.failed > 0) {
        toast.warning(
          t('profileCatalogue.bulkDelete.partial', {
            deleted: data.deleted,
            total: data.total,
            failed: data.failed,
          }),
        )
      } else {
        toast.success(
          t('profileCatalogue.bulkDelete.success', { count: data.deleted }),
        )
      }

      setSelected(new Set())
      onDeleted()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('profileCatalogue.bulkDelete.failed')
      toast.error(message)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClose = () => {
    if (isDeleting) return
    setSelected(new Set())
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('profileCatalogue.bulkDelete.title')}</DialogTitle>
          <DialogDescription>
            {t('profileCatalogue.bulkDelete.description')}
          </DialogDescription>
        </DialogHeader>

        {deletable.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('profileCatalogue.bulkDelete.noneAvailable')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between py-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                disabled={isDeleting}
              >
                {selected.size === deletable.length
                  ? t('profileCatalogue.bulkDelete.deselectAll')
                  : t('profileCatalogue.bulkDelete.selectAll')}
              </Button>
              {selected.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {t('profileCatalogue.bulkDelete.selected', {
                    count: selected.size,
                  })}
                </span>
              )}
            </div>

            <ScrollArea className="max-h-[50vh] pr-3">
              <div className="space-y-2">
                {deletable.map((profile) => (
                  <label
                    key={profile.id}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selected.has(profile.id)}
                      onCheckedChange={() => toggleProfile(profile.id)}
                      disabled={isDeleting}
                    />
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Coffee className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {profile.name}
                      </p>
                      {profile.author && (
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.author}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleClose} disabled={isDeleting}>
            {t('common.cancel')}
          </Button>
          {deletable.length > 0 && (
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isDeleting || selected.size === 0}
            >
              {isDeleting ? (
                <>
                  <SpinnerGap className="w-4 h-4 mr-2 animate-spin" />
                  {t('profileCatalogue.bulkDelete.deleting')}
                </>
              ) : (
                <>
                  <Trash className="w-4 h-4 mr-2" />
                  {t('profileCatalogue.bulkDelete.confirm', {
                    count: selected.size,
                  })}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
