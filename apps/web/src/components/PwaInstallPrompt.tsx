import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/hooks/usePwaInstall'

export function PwaInstallPrompt() {
  const { t } = useTranslation()
  const { canInstall, install, dismiss } = usePwaInstall()
  const [isInstalling, setIsInstalling] = useState(false)

  if (!canInstall) return null

  const handleInstall = async () => {
    setIsInstalling(true)
    try {
      await install()
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-border/70 bg-card/95 p-4 shadow-xl backdrop-blur"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{t('pwaInstall.title')}</p>
          <p className="text-xs text-muted-foreground">{t('pwaInstall.description')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
            {t('pwaInstall.dismiss')}
          </Button>
          <Button type="button" size="sm" onClick={handleInstall} disabled={isInstalling}>
            {isInstalling ? t('pwaInstall.installing') : t('pwaInstall.install')}
          </Button>
        </div>
      </div>
    </div>
  )
}
