/**
 * ControlCenterExpanded — the full control panel that renders inside
 * the ControlCenter card when the user clicks "Show all".
 *
 * Shows all temperatures, machine info, brightness/sounds controls,
 * and every available command button.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Play,
  Stop,
  XCircle,
  Fire,
  Scales,
  House,
  Drop,
  ArrowRight,
  SpeakerHigh,
  SpeakerSlash,
  Sun as SunIcon,
  Coffee,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'
import { getServerUrl } from '@/lib/config'
import {
  startShot,
  stopShot,
  abortShot,
  continueShot,
  preheat,
  tareScale,
  homePlunger,
  purge,
  setBrightness,
  enableSounds,
  loadProfile,
} from '@/lib/mqttCommands'
import { relativeTime } from '@/lib/timeUtils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ControlCenterExpandedProps {
  machineState: MachineState
  profileAuthor?: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlCenterExpanded({ machineState, profileAuthor }: ControlCenterExpandedProps) {
  const { t } = useTranslation()
  const [brightnessValue, setBrightnessValue] = useState<number>(
    machineState.brightness ?? 75,
  )
  const [profileImgUrl, setProfileImgUrl] = useState<string | null>(null)
  const [machineProfiles, setMachineProfiles] = useState<{ id: string; name: string }[]>([])
  const [profilesLoaded, setProfilesLoaded] = useState(false)

  const stateLC = (machineState.state ?? '').toLowerCase()
  const isIdle = stateLC === 'idle' && !machineState.brewing
  const isBrewing = machineState.brewing
  const isConnected = machineState.connected
  const isPreheating = stateLC === 'preheating'
  const isHeating = stateLC === 'heating'
  const isReady = stateLC === 'click to start'
  // Machine accepts START during idle, preheat, or "click to start"
  const canStart = (isIdle || isPreheating || isReady) && !isBrewing && isConnected
  const canAbortWarmup = (isPreheating || isHeating) && !isBrewing && isConnected

  // Build the profile image URL when active_profile changes
  useEffect(() => {
    let cancelled = false
    if (!machineState.active_profile) { setProfileImgUrl(null); return }
    ;(async () => {
      const base = await getServerUrl()
      if (!cancelled) {
        setProfileImgUrl(`${base}/api/profile/${encodeURIComponent(machineState.active_profile!)}/image-proxy`)
      }
    })()
    return () => { cancelled = true }
  }, [machineState.active_profile])

  // Fetch machine profiles once when expanded
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const base = await getServerUrl()
        const res = await fetch(`${base}/api/machine/profiles`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setMachineProfiles(
            (data.profiles ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
          )
        }
      } catch {
        // Silently ignore — selector just won't populate
      } finally {
        if (!cancelled) setProfilesLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const cmd = useCallback(
    async (fn: () => Promise<{ success: boolean; message?: string }>, successKey: string) => {
      const res = await fn()
      if (res.success) {
        toast.success(t(`controlCenter.toasts.${successKey}`))
      } else {
        toast.error(res.message ?? t('controlCenter.toasts.error'))
      }
    },
    [t],
  )

  const handleBrightnessChange = useCallback(
    async (val: number[]) => {
      const v = val[0]
      setBrightnessValue(v)
      await setBrightness(v)
    },
    [],
  )

  const handleSoundsToggle = useCallback(
    async (enabled: boolean) => {
      const res = await enableSounds(enabled)
      if (res.success) {
        toast.success(
          enabled
            ? t('controlCenter.toasts.soundsOn')
            : t('controlCenter.toasts.soundsOff'),
        )
      } else {
        toast.error(res.message ?? t('controlCenter.toasts.error'))
      }
    },
    [t],
  )

  return (
    <div className="pt-3 space-y-4">
      <Separator />

      {/* ── Temperatures ──────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.temperatures')}
        </h4>
        <div className="space-y-1 text-sm">
          <Row label={t('controlCenter.labels.brewHead')} value={fmt(machineState.brew_head_temperature, '°C')} />
          <Row label={t('controlCenter.labels.boiler')} value={fmt(machineState.boiler_temperature, '°C')} />
          {!isIdle && (
            <Row label={t('controlCenter.labels.target')} value={fmt(machineState.target_temperature, '°C')} />
          )}
        </div>
      </section>

      <Separator />

      {/* ── Profile ─────────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.activeProfile')}
        </h4>
        <div className="space-y-2 text-sm">
          {/* Active profile with image */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
              {profileImgUrl ? (
                <img
                  src={profileImgUrl}
                  alt={machineState.active_profile ?? ''}
                  className="h-full w-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden') }}
                />
              ) : null}
              <Coffee size={20} className={`text-muted-foreground ${profileImgUrl ? 'hidden' : ''}`} weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-foreground font-medium truncate block">
                {machineState.active_profile ?? '—'}
              </span>
              {profileAuthor && (
                <span className="text-[10px] text-muted-foreground truncate block">
                  {t('controlCenter.labels.by')} {profileAuthor}
                </span>
              )}
            </div>
          </div>

          {/* Profile selector */}
          {profilesLoaded && machineProfiles.length > 0 && (isIdle || isPreheating || isReady) && (
            <div>
              <Select
                value={machineState.active_profile ?? ''}
                onValueChange={async (name) => {
                  const res = await loadProfile(name)
                  if (res.success) {
                    toast.success(t('controlCenter.toasts.profileSelected', { name }))
                  } else {
                    toast.error(res.message ?? t('controlCenter.toasts.error'))
                  }
                }}
                disabled={!isConnected}
              >
                <SelectTrigger className="h-8 text-xs dark:border-white/20">
                  <SelectValue placeholder={t('controlCenter.profileSelector.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {machineProfiles.map(p => (
                    <SelectItem key={p.id} value={p.name} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* ── Machine info ──────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.info')}
        </h4>
        <div className="space-y-1 text-sm">
          <Row label={t('controlCenter.labels.shots')} value={machineState.total_shots?.toLocaleString() ?? '—'} />
          {machineState.last_shot_time && (
            <Row label={t('controlCenter.labels.lastShot')} value={relativeTime(machineState.last_shot_time, t) ?? '—'} />
          )}
          {machineState.firmware_version && (
            <Row label={t('controlCenter.labels.firmware')} value={machineState.firmware_version} />
          )}
        </div>
      </section>

      <Separator />

      {/* ── Machine settings ──────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.settings')}
        </h4>
        <div className="space-y-3">
          {/* Brightness slider */}
          <div className="flex items-center gap-3">
            <SunIcon size={16} className="text-muted-foreground shrink-0" weight="duotone" />
            <Slider
              min={0}
              max={100}
              step={5}
              value={[brightnessValue]}
              onValueCommit={handleBrightnessChange}
              className="flex-1"
              disabled={!isConnected}
            />
            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{brightnessValue}</span>
          </div>
          {/* Sounds toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {machineState.sounds_enabled ? (
                <SpeakerHigh size={16} className="text-muted-foreground" weight="duotone" />
              ) : (
                <SpeakerSlash size={16} className="text-muted-foreground" weight="duotone" />
              )}
              <span className="text-sm text-foreground">{t('controlCenter.labels.sounds')}</span>
            </div>
            <Switch
              checked={machineState.sounds_enabled ?? false}
              onCheckedChange={handleSoundsToggle}
              disabled={!isConnected}
            />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── All Actions ───────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.actions')}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            icon={<Play size={14} weight="fill" />}
            label={t('controlCenter.actions.start')}
            disabled={!canStart}
            onClick={() => cmd(startShot, 'startingShot')}
          />

          {/* Stop — destructive confirmation */}
          <ConfirmButton
            icon={<Stop size={14} weight="fill" />}
            label={t('controlCenter.actions.stop')}
            disabled={!isBrewing}
            title={t('controlCenter.confirm.stopTitle')}
            description={t('controlCenter.confirm.stopDesc')}
            onConfirm={() => cmd(stopShot, 'stopping')}
            t={t}
          />

          {/* Cancel warmup — visible during preheating/heating (not during brewing) */}
          {canAbortWarmup && (
            <ActionButton
              icon={<XCircle size={14} weight="fill" />}
              label={t('controlCenter.actions.abortPreheat')}
              disabled={!isConnected}
              onClick={() => cmd(abortShot, 'preheatCancelled')}
            />
          )}

          <ActionButton
            icon={<ArrowRight size={14} weight="bold" />}
            label={t('controlCenter.actions.continue')}
            disabled={machineState.state?.toLowerCase() !== 'paused'}
            onClick={() => cmd(continueShot, 'continuing')}
          />
          <ActionButton
            icon={<Fire size={14} weight="fill" />}
            label={t('controlCenter.actions.preheat')}
            disabled={(!isIdle && !isReady) || !isConnected}
            onClick={() => cmd(preheat, 'preheating')}
          />
          <ActionButton
            icon={<Scales size={14} weight="fill" />}
            label={t('controlCenter.actions.tare')}
            disabled={!isConnected}
            onClick={() => cmd(tareScale, 'tared')}
          />
          <ActionButton
            icon={<House size={14} weight="fill" />}
            label={t('controlCenter.actions.home')}
            disabled={(!isIdle && !isReady) || !isConnected}
            onClick={() => cmd(homePlunger, 'homed')}
          />

          {/* Purge — destructive confirmation */}
          <ConfirmButton
            icon={<Drop size={14} weight="fill" />}
            label={t('controlCenter.actions.purge')}
            disabled={(!isIdle && !isReady) || !isConnected}
            title={t('controlCenter.confirm.purgeTitle')}
            description={t('controlCenter.confirm.purgeDesc')}
            onConfirm={() => cmd(purge, 'purging')}
            t={t}
          />
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium tabular-nums">{value}</span>
    </div>
  )
}

function fmt(n: number | null, unit: string): string {
  if (n == null) return '—'
  return `${n.toFixed(1)} ${unit}`
}

function ActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="dark-brew"
      size="sm"
      className="h-9 text-xs w-full"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="ml-1">{label}</span>
    </Button>
  )
}

function ConfirmButton({
  icon,
  label,
  disabled,
  title,
  description,
  onConfirm,
  destructive,
  t,
}: {
  icon: React.ReactNode
  label: string
  disabled: boolean
  title: string
  description: string
  onConfirm: () => void
  destructive?: boolean
  t: ReturnType<typeof import('react-i18next').useTranslation>['t']
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={destructive ? 'destructive' : 'dark-brew'}
          size="sm"
          className="h-9 text-xs w-full"
          disabled={disabled}
        >
          {icon}
          <span className="ml-1">{label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('common.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
