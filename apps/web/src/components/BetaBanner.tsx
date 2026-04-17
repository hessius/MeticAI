import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Flask } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { isDirectMode, isDemoMode } from '@/lib/machineMode'

interface BetaBannerProps {
  className?: string
}

export function BetaBanner({ className }: BetaBannerProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [isBetaVersion, setIsBetaVersion] = useState(false)

  useEffect(() => {
    const checkBetaStatus = async () => {
      if (isDirectMode() || isDemoMode()) return // No MeticAI backend in direct/demo mode
      try {
        const serverUrl = await getServerUrl()
        const response = await fetch(`${serverUrl}/api/version`)
        if (response.ok) {
          const data = await response.json()
          setVersion(data.version || null)
          setIsBetaVersion(data.is_beta_version || false)
          
          // Show banner if running beta version or beta channel is enabled
          const shouldShow = data.is_beta_version || data.beta_channel_enabled
          const wasDismissed = sessionStorage.getItem('betaBannerDismissed') === 'true'
          
          setVisible(shouldShow && !wasDismissed)
        }
      } catch (err) {
        console.error('Failed to check beta status:', err)
      }
    }

    checkBetaStatus()
  }, [])

  const handleDismiss = () => {
    setDismissed(true)
    setVisible(false)
    sessionStorage.setItem('betaBannerDismissed', 'true')
  }

  if (!visible || dismissed) {
    return null
  }

  return (
    <div className={`bg-yellow-500/90 text-black px-4 py-2 flex items-center justify-between gap-3 ${className || ''}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Flask size={18} weight="fill" className="shrink-0" />
        <span className="text-sm font-medium truncate">
          {isBetaVersion ? (
            <>{t('betaBanner.runningBeta', { version: version || 'unknown' })}</>
          ) : (
            <>{t('betaBanner.betaChannelEnabled')}</>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="https://github.com/hessius/MeticAI/issues/new?labels=beta-feedback"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium underline hover:no-underline"
        >
          {t('betaBanner.reportIssue')}
        </a>
        <button
          onClick={handleDismiss}
          data-sound="close"
          className="p-1 hover:bg-black/10 rounded"
          aria-label={t('common.dismiss')}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
    </div>
  )
}
