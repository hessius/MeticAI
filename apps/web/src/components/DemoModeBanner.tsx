/**
 * DemoModeBanner — persistent UI indicator that demo mode is active.
 * Tapping the banner dismisses it. "Setup Real Machine" exits demo
 * mode and restarts the onboarding wizard.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from '@phosphor-icons/react'
import { isDemoMode, deactivateDemoMode } from '@/lib/machineMode'
import { MACHINE_URL_CHANGED } from '@/services/machine/MachineServiceContext'
import { STORAGE_KEYS } from '@/lib/constants'

export function DemoModeBanner() {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  if (!isDemoMode() || dismissed) return null

  const handleSetupMachine = () => {
    deactivateDemoMode()
    // Clear onboarding flag to restart the wizard
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE)
    window.dispatchEvent(new Event(MACHINE_URL_CHANGED))
    window.location.reload()
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-amber-500/90 px-4 py-2.5 font-medium text-amber-950 backdrop-blur-sm" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{t('demo.banner', 'Demo Mode')}</span>
        <span className="text-xs opacity-80">{t('demo.bannerHint', 'Simulated data')}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSetupMachine}
          className="rounded-md bg-amber-950/20 px-3 py-1.5 text-xs font-semibold hover:bg-amber-950/30 active:bg-amber-950/40 transition-colors"
        >
          {t('demo.setupMachine', 'Setup Machine')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md p-1.5 hover:bg-amber-950/20 active:bg-amber-950/30 transition-colors"
          aria-label={t('common.dismiss', 'Dismiss')}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
    </div>
  )
}
