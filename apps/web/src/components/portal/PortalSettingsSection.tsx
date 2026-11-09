/**
 * Settings → Belka Portal: enable the sensor, pair it over Web Bluetooth, and
 * tune how recordings line up with the machine's shot.
 *
 * Web Bluetooth only exists in Chrome/Edge on a secure page, so the section
 * explains plainly when it cannot work here (plain-http LAN origin, Safari,
 * the iOS/Android app) instead of offering a button that fails.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bluetooth, BluetoothSlash, Drop } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { usePortal, usePortalSettings } from '@/hooks/usePortal'
import { portalBle, portalEnvironment, type PortalEnvironment, type PortalStep } from '@/services/portal/portalBle'

const STEP_ORDER: PortalStep[] = ['device', 'gatt', 'service', 'measurement', 'command', 'notify', 'packet']

export function PortalSettingsSection() {
  const { t } = useTranslation()
  const [settings, update] = usePortalSettings()
  const portal = usePortal()
  const [env, setEnv] = useState<PortalEnvironment | null>(null)
  const [busy, setBusy] = useState(false)
  const [acceptAll, setAcceptAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    void portalEnvironment().then((e) => {
      if (!cancelled) setEnv(e)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const connected = portal.connection === 'connected'
  const canPair = env !== null && env.reason !== 'insecure' && env.reason !== 'no-api'

  const connect = async () => {
    setBusy(true)
    try {
      await portalBle.pick({ acceptAll })
      toast.success(t('portal.toast.connected', { name: portalBle.device?.name || 'Belka Portal' }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // The user closing the chooser is not an error worth a toast.
      if (!/cancel/i.test(message)) toast.error(t('portal.toast.connectFailed', { message }))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await portalBle.disconnect()
    } finally {
      setBusy(false)
    }
  }

  const statusBadge = (
    <Badge variant={connected ? 'default' : 'outline'} className="text-xs">
      {connected
        ? t('portal.status.connected')
        : portal.connection === 'connecting'
          ? t('portal.status.connecting')
          : portal.connection === 'lost'
            ? t('portal.status.lost')
            : t('portal.status.notConnected')}
    </Badge>
  )

  return (
    <CollapsibleSection title={t('portal.title')} icon={<Drop size={16} className="text-muted-foreground" />} trailing={settings.enabled ? statusBadge : undefined}>
      <p className="text-xs text-muted-foreground">{t('portal.settings.intro')}</p>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="portal-enabled" className="text-sm font-medium">
            {t('portal.settings.enable')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('portal.settings.enableHint')}</p>
        </div>
        <Switch id="portal-enabled" checked={settings.enabled} onCheckedChange={(checked) => update({ enabled: checked as boolean })} />
      </div>

      {settings.enabled && (
        <div className="space-y-4 border-t border-border/50 pt-4">
          {/* Environment */}
          {env && env.reason && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              {env.reason === 'insecure' && t('portal.env.insecure')}
              {env.reason === 'no-api' && t('portal.env.noApi')}
              {env.reason === 'no-adapter' && t('portal.env.noAdapter')}
            </div>
          )}

          {/* Pairing */}
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy} className="gap-1.5">
                <BluetoothSlash size={14} />
                {t('portal.actions.disconnect')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void connect()} disabled={busy || !canPair} className="gap-1.5">
                <Bluetooth size={14} />
                {t('portal.actions.connect')}
              </Button>
            )}
            {connected && portal.deviceName && (
              <span className="text-xs text-muted-foreground">
                {portal.deviceName}
                {portal.ec != null && ` · ${portal.ec.toFixed(3)} mS/cm`}
                {portal.packetRate > 0 && ` · ${portal.packetRate.toFixed(1)}/s`}
              </span>
            )}
            {!connected && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={acceptAll} onChange={(e) => setAcceptAll(e.target.checked)} className="h-3.5 w-3.5" />
                {t('portal.settings.showAllDevices')}
              </label>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('portal.settings.pairHint')}</p>

          {/* Connection check */}
          {Object.keys(portal.steps).length > 0 && (
            <ol className="space-y-1 text-xs" aria-label={t('portal.settings.connectionCheck')}>
              {STEP_ORDER.map((step) => {
                const v = portal.steps[step]
                if (v === undefined) return null
                const ok = v === true
                const failed = v === false || (typeof v === 'string' && step !== 'device' && step !== 'command')
                return (
                  <li key={step} className="flex items-baseline gap-2">
                    <span
                      className={`mt-0.5 inline-block h-2 w-2 flex-none rounded-full ${ok ? 'bg-emerald-500' : failed ? 'bg-red-500' : v === null ? 'bg-muted-foreground/40' : 'bg-amber-500'}`}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">{t(`portal.steps.${step}`)}</span>
                    {typeof v === 'string' && <span className="text-muted-foreground/80">— {v}</span>}
                  </li>
                )
              })}
            </ol>
          )}

          {/* Timing */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="portal-settle" className="text-sm font-medium">
                {t('portal.settings.settle')}
              </Label>
              <Input
                id="portal-settle"
                type="number"
                min={0}
                max={60}
                step={1}
                value={settings.settleSec}
                onChange={(e) => update({ settleSec: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{t('portal.settings.settleHint')}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="portal-lag" className="text-sm font-medium">
                {t('portal.settings.lag')}
              </Label>
              <Input
                id="portal-lag"
                type="number"
                min={-2}
                max={3}
                step={0.1}
                value={settings.lagSec}
                onChange={(e) => update({ lagSec: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{t('portal.settings.lagHint')}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="portal-autograph" className="text-sm font-medium">
                {t('portal.settings.autoGraph')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('portal.settings.autoGraphHint')}</p>
            </div>
            <Switch id="portal-autograph" checked={settings.autoGraph} onCheckedChange={(checked) => update({ autoGraph: checked as boolean })} />
          </div>

          {portal.pendingCount > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('portal.settings.pending', { count: portal.pendingCount })}</p>
          )}
          {portal.lastError && <p className="text-xs text-muted-foreground">{portal.lastError}</p>}
        </div>
      )}
    </CollapsibleSection>
  )
}
