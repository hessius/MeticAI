/**
 * DemoModeBanner — persistent UI indicator that demo mode is active.
 */

import { useTranslation } from 'react-i18next'
import { isDemoMode, deactivateDemoMode } from '@/lib/machineMode'
import { MACHINE_URL_CHANGED } from '@/services/machine/MachineServiceContext'

export function DemoModeBanner() {
  const { t } = useTranslation()

  if (!isDemoMode()) return null

  const handleExit = () => {
    deactivateDemoMode()
    window.dispatchEvent(new Event(MACHINE_URL_CHANGED))
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-3 py-1 text-xs font-medium text-amber-950 backdrop-blur-sm">
      <span>{t('demo.banner', 'Demo Mode')}</span>
      <span className="opacity-60">—</span>
      <span className="opacity-80">{t('demo.bannerHint', 'Simulated data, no real machine')}</span>
      <button
        onClick={handleExit}
        className="ml-2 rounded bg-amber-950/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-amber-950/30 transition-colors"
      >
        {t('demo.exit', 'Exit')}
      </button>
    </div>
  )
}
