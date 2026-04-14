/**
 * ControlCenterExpanded — the full control panel that renders inside
 * the ControlCenter card when the user clicks "Show all".
 *
 * Section order: Actions → Temperatures → Settings → Machine Info
 * (Profile selector lives in the collapsed view.)
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
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
  Info,
} from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { useMachineService } from '@/hooks/useMachineService'
import { toast } from 'sonner'
import { relativeTime } from '@/lib/timeUtils'
import { useHaptics } from '@/hooks/useHaptics'
import type { DeviceInfo } from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ControlCenterExpandedProps {
  machineState: MachineState
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlCenterExpanded({ machineState }: ControlCenterExpandedProps) {
  const { t } = useTranslation()
  const { impact } = useHaptics()
  const [brightnessValue, setBrightnessValue] = useState<number>(
    machineState.brightness ?? 75,
  )
  const [deviceInfo, setDeviceInfo] = useState<Partial<DeviceInfo> | null>(null)

  // Shared state derivation + command executor
  const {
    isIdle, isBrewing, isReady,
    canStart, canAbortWarmup, isConnected, cmd,
  } = useMachineActions(machineState)
  const machine = useMachineService()

  // Fetch device info once when expanded
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const info = await machine.getDeviceInfo()
        if (!cancelled && info) setDeviceInfo(info)
      } catch {
        // Silently ignore — section just won't show
      }
    })()
    return () => { cancelled = true }
  }, [machine])

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

  // Determine if we have any machine info to display
  const hasMachineInfo = !!(
    machineState.total_shots != null ||
    machineState.last_shot_time ||
    machineState.firmware_version ||
    deviceInfo?.firmware ||
    deviceInfo?.software_version ||
    deviceInfo?.image_version ||
    deviceInfo?.image_build_channel ||
    deviceInfo?.serial ||
    deviceInfo?.model_version
  )

  return (
    <div className="pt-3 space-y-4">
      <Separator />

      {/* ── 1. All Actions ───────────────────────────────── */}
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

      <Separator />

      {/* ── 2. Temperatures ──────────────────────────────── */}
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('controlCenter.sections.temperatures')}
        </h4>
        <div className="space-y-1 text-sm">
          <Row label={t('controlCenter.labels.boiler')} value={fmt(machineState.boiler_temperature, '°C')} />
          {machineState.brew_head_temperature != null
            && machineState.brew_head_temperature !== machineState.boiler_temperature && (
            <Row label={t('controlCenter.labels.brewHead')} value={fmt(machineState.brew_head_temperature, '°C')} />
          )}
          {!isIdle && (
            <Row label={t('controlCenter.labels.target')} value={fmt(machineState.target_temperature, '°C')} />
          )}
        </div>
      </section>

      <Separator />

      {/* ── 3. Machine Settings ──────────────────────────── */}
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

      {/* ── 4. Machine Info (enriched, fail-silently) ───── */}
      {hasMachineInfo && (
        <>
          <Separator />
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Info size={12} className="inline mr-1 -mt-0.5" weight="fill" />
              {t('controlCenter.sections.info')}
            </h4>
            <div className="space-y-1 text-sm">
              {machineState.total_shots != null && (
                <Row label={t('controlCenter.labels.shots')} value={machineState.total_shots.toLocaleString()} />
              )}
              {machineState.last_shot_time && (
                <Row label={t('controlCenter.labels.lastShot')} value={relativeTime(machineState.last_shot_time, t) ?? '—'} />
              )}
              {(machineState.firmware_version || deviceInfo?.firmware) && (
                <Row label={t('controlCenter.labels.firmware')} value={machineState.firmware_version ?? deviceInfo?.firmware ?? ''} />
              )}
              {deviceInfo?.software_version && (
                <Row label={t('controlCenter.labels.softwareVersion')} value={deviceInfo.software_version} />
              )}
              {deviceInfo?.image_version && (
                <Row label={t('controlCenter.labels.imageVersion')} value={deviceInfo.image_version} />
              )}
              {deviceInfo?.image_build_channel && (
                <Row label={t('controlCenter.labels.updateChannel')} value={deviceInfo.image_build_channel} />
              )}
              {deviceInfo?.serial && (
                <Row label={t('controlCenter.labels.serial')} value={deviceInfo.serial} />
              )}
              {deviceInfo?.model_version && (
                <Row label={t('controlCenter.labels.model')} value={deviceInfo.model_version} />
              )}
            </div>
          </section>
        </>
      )}
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
