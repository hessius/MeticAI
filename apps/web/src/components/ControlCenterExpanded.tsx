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
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { useMachineService } from '@/hooks/useMachineService'
import { toast } from 'sonner'
import { getServerUrl } from '@/lib/config'
import { relativeTime } from '@/lib/timeUtils'
import { useHaptics } from '@/hooks/useHaptics'
import { useActionSheet } from '@/hooks/useActionSheet'
import { useProfileImageSrc } from '@/hooks/useProfileImageSrc'
import { Capacitor } from '@capacitor/core'

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
  const { impact } = useHaptics()
  const { showActionSheet } = useActionSheet()
  const isNativePlatform = Capacitor.isNativePlatform()
  const [brightnessValue, setBrightnessValue] = useState<number>(
    machineState.brightness ?? 75,
  )
  const [profileImgError, setProfileImgError] = useState(false)
  const [machineProfiles, setMachineProfiles] = useState<{ id: string; name: string }[]>([])
  const [profilesLoaded, setProfilesLoaded] = useState(false)

  // Shared state derivation + command executor
  const {
    isIdle, isBrewing, isPreheating, isReady,
    canStart, canAbortWarmup, isConnected, cmd,
  } = useMachineActions(machineState)
  const machine = useMachineService()

  // Build the profile image URL when active_profile changes
  // Suppress MeticAI-managed temp profiles — transient, deleted after pour-over cleanup.
  const activeProfile = (machineState.active_profile &&
    !machineState.active_profile.startsWith('MeticAI '))
    ? machineState.active_profile : null

  // Resolve profile image URL (works in both proxy and direct/Capacitor modes)
  const profileImgUrl = useProfileImageSrc(activeProfile)

  useEffect(() => {
    if (!activeProfile) {
      setProfileImgError(false)
    }
  }, [activeProfile])

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

  const handleBrightnessChange = useCallback(
    async (val: number[]) => {
      const v = val[0]
      setBrightnessValue(v)
      await machine.setBrightness(v)
    },
    [machine],
  )

  const handleSoundsToggle = useCallback(
    async (enabled: boolean) => {
      const res = await machine.enableSounds(enabled)
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
    [t, machine],
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
              {profileImgUrl && !profileImgError ? (
                <img
                  src={profileImgUrl}
                  alt={activeProfile ?? ''}
                  className="h-full w-full object-cover"
                  onError={() => setProfileImgError(true)}
                />
              ) : (
                <Coffee size={20} className="text-muted-foreground" weight="duotone" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-foreground font-medium truncate block">
                {activeProfile ?? '—'}
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
              {isNativePlatform ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs w-full dark:border-white/20 justify-between"
                  disabled={!isConnected}
                  onClick={async () => {
                    const names = machineProfiles.map(p => p.name)
                    const index = await showActionSheet({
                      title: t('controlCenter.profileSelector.placeholder'),
                      options: names,
                    })
                    if (index >= 0 && index < names.length) {
                      const name = names[index]
                      const res = await machine.loadProfile(name)
                      if (res.success) {
                        toast.success(t('controlCenter.toasts.profileSelected', { name }))
                      } else {
                        toast.error(res.message ?? t('controlCenter.toasts.error'))
                      }
                    }
                  }}
                >
                  {activeProfile ?? t('controlCenter.profileSelector.placeholder')}
                </Button>
              ) : (
                <Select
                  value={activeProfile ?? ''}
                  onValueChange={async (name) => {
                    const res = await machine.loadProfile(name)
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
              )}
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
            onClick={() => { impact('medium'); cmd(() => machine.startShot(), 'startingShot') }}
          />

          {/* Stop — destructive confirmation */}
          <ConfirmButton
            icon={<Stop size={14} weight="fill" />}
            label={t('controlCenter.actions.stop')}
            disabled={!isBrewing}
            title={t('controlCenter.confirm.stopTitle')}
            description={t('controlCenter.confirm.stopDesc')}
            onConfirm={() => { impact('heavy'); cmd(() => machine.stopShot(), 'stopping') }}
            t={t}
          />

          {/* Cancel warmup — visible during preheating/heating (not during brewing) */}
          {canAbortWarmup && (
            <ActionButton
              icon={<XCircle size={14} weight="fill" />}
              label={t('controlCenter.actions.abortPreheat')}
              disabled={!isConnected}
              onClick={() => { impact('medium'); cmd(() => machine.abortShot(), 'preheatCancelled') }}
            />
          )}

          <ActionButton
            icon={<ArrowRight size={14} weight="bold" />}
            label={t('controlCenter.actions.continue')}
            disabled={machineState.state?.toLowerCase() !== 'paused'}
            onClick={() => { impact('medium'); cmd(() => machine.continueShot(), 'continuing') }}
          />
          <ActionButton
            icon={<Fire size={14} weight="fill" />}
            label={t('controlCenter.actions.preheat')}
            disabled={(!isIdle && !isReady) || !isConnected}
            onClick={() => { impact('medium'); cmd(() => machine.preheat(), 'preheating') }}
          />
          <ActionButton
            icon={<Scales size={14} weight="fill" />}
            label={t('controlCenter.actions.tare')}
            disabled={!isConnected}
            onClick={() => { impact('light'); cmd(() => machine.tareScale(), 'tared') }}
          />
          <ActionButton
            icon={<House size={14} weight="fill" />}
            label={t('controlCenter.actions.home')}
            disabled={(!isIdle && !isReady) || !isConnected}
            onClick={() => { impact('light'); cmd(() => machine.homePlunger(), 'homed') }}
          />

          {/* Purge — destructive confirmation */}
          <ConfirmButton
            icon={<Drop size={14} weight="fill" />}
            label={t('controlCenter.actions.purge')}
            disabled={(!isIdle && !isReady) || !isConnected}
            title={t('controlCenter.confirm.purgeTitle')}
            description={t('controlCenter.confirm.purgeDesc')}
            onConfirm={() => { impact('medium'); cmd(() => machine.purge(), 'purging') }}
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
