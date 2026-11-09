/**
 * Live Portal readouts for the shot view: conductivity and outlet temperature
 * from the Belka Portal, plus what the recorder is doing. Renders nothing when
 * the Portal feature is off, so LiveShotView is unchanged for everyone else.
 */

import { useTranslation } from 'react-i18next'
import { Drop, Thermometer } from '@phosphor-icons/react'
import { usePortal, usePortalSettings } from '@/hooks/usePortal'

function Tile({ icon, value, unit, label }: { icon: React.ReactNode; value: string; unit: string; label: string }) {
  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums flex items-center justify-center gap-1 text-foreground">
        {icon}
        {value}
        <span className="text-[10px] text-muted-foreground font-normal">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

export function PortalLiveTiles() {
  const { t } = useTranslation()
  const [settings] = usePortalSettings()
  const portal = usePortal()
  if (!settings.enabled) return null

  const connected = portal.connection === 'connected'
  const recordingLabel =
    portal.recording === 'recording' && !connected
      ? t('portal.live.notConnected')
      : portal.recording === 'recording'
      ? t('portal.live.recording', { count: portal.liveSamples.length })
      : portal.recording === 'settling'
        ? t('portal.live.settling')
        : portal.recording === 'binding'
          ? t('portal.live.saving')
          : connected
            ? t('portal.live.ready')
            : t('portal.live.notConnected')

  return (
    <div className="grid grid-cols-3 gap-2" data-testid="portal-live-tiles">
      <Tile icon={<Drop size={14} />} value={connected && portal.ec != null ? portal.ec.toFixed(3) : '—'} unit="mS/cm" label={t('portal.live.ec')} />
      <Tile icon={<Thermometer size={14} />} value={connected && portal.tOut != null ? portal.tOut.toFixed(1) : '—'} unit="°C" label={t('portal.live.outletTemp')} />
      <div className="bg-muted/50 rounded-lg px-3 py-2 text-center flex flex-col items-center justify-center">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              portal.recording === 'recording' && connected ? 'bg-red-500 animate-pulse' : connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
            aria-hidden
          />
          {recordingLabel}
        </div>
        <div className="text-[10px] text-muted-foreground">{t('portal.title')}</div>
      </div>
    </div>
  )
}
