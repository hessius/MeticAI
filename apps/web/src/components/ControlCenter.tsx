/**
 * ControlCenter — the compact machine-status widget that sits
 * in the right column (desktop) or above the main card (mobile).
 *
 * It shows:
 *  • Connection status
 *  • Temperature + machine state
 *  • Quick-action buttons (idle) or live shot metrics (brewing)
 *  • An expand toggle that reveals ControlCenterExpanded
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Play,
  Stop,
  Fire,
  Scales,
  CaretDown,
  CaretUp,
  CaretUpDown,
  Eye,
  XCircle,
  Thermometer,
  Coffee,
  Warning,
} from '@phosphor-icons/react'
import type { MachineState } from '@/hooks/useWebSocket'
import { useMachineActions } from '@/hooks/useMachineActions'
import { useMachineService } from '@/hooks/useMachineService'
import { relativeTime } from '@/lib/timeUtils'
import { getServerUrl } from '@/lib/config'
import { useHaptics } from '@/hooks/useHaptics'
import { getProfileImageValue, useProfileImageSrc, resolveDisplayImage } from '@/hooks/useProfileImageSrc'
import { useProfileImageCache } from '@/hooks/useProfileImageCache'
import { isDirectMode, isNativePlatform as isNativePlatformFn } from '@/lib/machineMode'
import { useResolvedMachineUrl } from '@/services/machine/useResolvedMachineUrl'
import { toast } from 'sonner'
import { ControlCenterExpanded } from './ControlCenterExpanded'
import { ProfileDropdown, type DropdownProfile } from './ProfileDropdown'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ControlCenterProps {
  machineState: MachineState
  onOpenLiveView?: () => void
}

// ---------------------------------------------------------------------------
// State badge helper
// ---------------------------------------------------------------------------

function stateBadge(state: string | null, brewing: boolean, t: ReturnType<typeof import('react-i18next').useTranslation>['t']) {
  if (brewing) {
    return (
      <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40 animate-pulse">
        {t('controlCenter.states.brewing')}
      </Badge>
    )
  }
  const map: Record<string, { cls: string; key: string }> = {
    idle:              { cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40', key: 'idle' },
    heating:           { cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40', key: 'heating' },
    preheating:        { cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40 animate-pulse', key: 'preheating' },
    steaming:          { cls: 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40', key: 'steaming' },
    purging:           { cls: 'bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/40 animate-pulse', key: 'purging' },
    descaling:         { cls: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40', key: 'descaling' },
    'pour water':      { cls: 'bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/40 animate-pulse', key: 'pourWater' },
    'click to start':  { cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 animate-pulse', key: 'ready' },
    'click to purge':  { cls: 'bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/40 animate-pulse', key: 'clickToPurge' },
  }
  // Handle partial/truncated states from the machine (e.g. "Pour water...", "Click to purge")
  const normalised = (state ?? '').toLowerCase()
  const matchedKey = normalised.startsWith('pour water') ? 'pour water'
    : normalised.startsWith('click to purge') ? 'click to purge'
    : normalised
  const entry = map[matchedKey] ?? { cls: 'bg-muted text-muted-foreground border-muted', key: 'unknown' }
  return (
    <Badge className={entry.cls}>
      {t(`controlCenter.states.${entry.key}`)}
    </Badge>
  )
}

function connectionDot(machineState: MachineState) {
  if (!machineState._wsConnected) return { dot: 'bg-gray-400', key: 'disconnected' }
  if (machineState.availability === 'offline') return { dot: 'bg-red-500', key: 'offline' }
  if (machineState._stale) return { dot: 'bg-amber-400', key: 'stale' }
  if (machineState.connected) return { dot: 'bg-emerald-400', key: 'connected' }
  return { dot: 'bg-gray-400', key: 'connecting' }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlCenter({ machineState, onOpenLiveView }: ControlCenterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const prevShotsRef = useRef<number | null>(null)
  const profileSectionRef = useRef<HTMLDivElement>(null)
  const [profileImgError, setProfileImgError] = useState(false)
  const [profileAuthor, setProfileAuthor] = useState<string | null>(null)
  const [machineProfiles, setMachineProfiles] = useState<DropdownProfile[]>([])
  const { impact } = useHaptics()
  const { getImageUrl, fetchImagesForProfiles } = useProfileImageCache()
  const directImageMode = isDirectMode() || isNativePlatformFn()
  const resolvedMachineUrl = useResolvedMachineUrl(directImageMode)

  // Shared state derivation + command executor
  const {
    isIdle, isBrewing, isPreheating, isHeating, isReady, isPourWater,
    canStart, canAbortWarmup, cmd,
  } = useMachineActions(machineState)
  const machine = useMachineService()
  const isConnected = machineState.connected ?? false

  // Build the profile image URL when active_profile changes
  // Suppress Metic-managed temp profiles — they're transient and deleted after cleanup.
  const activeProfile = (machineState.active_profile &&
    !machineState.active_profile.startsWith('Metic '))
    ? machineState.active_profile : null

  // Pending profile — selected in UI but not yet loaded on machine.
  // Only sent to the machine when the user explicitly presses Start.
  const [pendingProfile, setPendingProfile] = useState<string | null>(null)

  // The profile to display in the UI (pending overrides active)
  const displayProfile = pendingProfile ?? activeProfile

  // Resolve profile image URL (works in both proxy and direct/Capacitor modes)
  const activeProfileImgUrl = useProfileImageSrc(activeProfile)

  // When a pending profile is selected, resolve its image from the dropdown cache
  const pendingProfileMeta = useMemo(() => {
    if (!pendingProfile) return null
    return machineProfiles.find(p => p.name === pendingProfile) ?? null
  }, [pendingProfile, machineProfiles])

  const profileImgUrl = pendingProfileMeta?.resolvedImageUrl ?? activeProfileImgUrl

  // Clear pending once the machine reports it as active
  useEffect(() => {
    if (activeProfile && activeProfile === pendingProfile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingProfile(null)
    }
  }, [activeProfile, pendingProfile])

  // Reset dependent state when displayed profile changes
  useEffect(() => {
    if (!displayProfile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileImgError(false)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileAuthor(null)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileImgError(false)
    }
  }, [displayProfile])

  // Fetch profiles (for author + change selector) — on mount and when connection is established
  useEffect(() => {
    if (!isConnected) return
    let cancelled = false
    ;(async () => {
      try {
        const base = await getServerUrl()
        const res = await fetch(`${base}/api/machine/profiles`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          interface RawProfile {
            id: string
            name?: string
            author?: string
            image?: string
            display?: { description?: string; shortDescription?: string; image?: string }
            stages?: Array<Record<string, unknown>>
            temperature?: number
            final_weight?: number
          }
          const isDirect = directImageMode
          const profiles: DropdownProfile[] = (data.profiles ?? [])
            .filter((p: RawProfile) => p.name)
            .map((p: RawProfile) => ({
              id: p.id,
              name: p.name!,
              author: p.author,
              image: p.image,
              display: p.display,
              temperature: p.temperature,
              final_weight: p.final_weight,
              stageCount: p.stages?.length,
              // In direct/native mode, resolve machine-relative image URLs.
              // In proxy mode, leave null — the image cache uses /api/profile/{name}/image-proxy.
              resolvedImageUrl: isDirect
                ? resolveDisplayImage(getProfileImageValue(p), resolvedMachineUrl || undefined)
                : null,
            }))
          setMachineProfiles(profiles)
          // In proxy mode, batch-fetch images only for profiles without a display image
          if (!isDirect) {
            const needsImage = profiles.filter(p => !getProfileImageValue(p)).map(p => p.name)
            if (needsImage.length > 0) fetchImagesForProfiles(needsImage)
          }
        }
      } catch {
        // Silently ignore
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, fetchImagesForProfiles, directImageMode, resolvedMachineUrl])

  // Derive profileAuthor from machineProfiles when activeProfile changes
  useEffect(() => {
    if (!activeProfile) return
    const match = machineProfiles.find(p => p.name === activeProfile)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileAuthor(match?.author ?? null)
  }, [activeProfile, machineProfiles])

  // Merge display images with cached fallbacks for the dropdown
  const dropdownProfiles = useMemo<DropdownProfile[]>(() =>
    machineProfiles.map(p => ({
      ...p,
      resolvedImageUrl: p.resolvedImageUrl || getImageUrl(p.name) || null,
    })),
    [machineProfiles, getImageUrl],
  )

  // Profile change handler — UI-only, does NOT touch the machine
  const handleSelectProfile = useCallback((name: string) => {
    impact('light')
    setPendingProfile(name === activeProfile ? null : name)
    toast.success(t('controlCenter.toasts.profileSelected', { name }))
  }, [t, activeProfile, impact])

  // 🎉 Confetti celebration for every 100th shot
  useEffect(() => {
    const shots = machineState.total_shots
    if (shots == null) return
    const prev = prevShotsRef.current
    prevShotsRef.current = shots
    // Only fire when total_shots *crosses* a 100 boundary (not on initial load)
    if (prev != null && prev !== shots && shots > 0 && shots % 100 === 0) {
      // Lazy-load confetti to reduce initial bundle size (#188)
      import('canvas-confetti').then(({ default: confetti }) => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } })
      })
    }
  }, [machineState.total_shots])

  // ── Not connected yet (skeleton) ──────────────────────────
  if (!machineState._wsConnected) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <Skeleton className="h-8 w-20" />
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
        </div>
        <div className="border-t border-border/30" />
        <Skeleton className="h-4 w-16 mx-auto" />
      </Card>
    )
  }

  // ── Offline ───────────────────────────────────────────────
  if (machineState.availability === 'offline') {
    return (
      <Card className="p-4 border-red-500/30">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <Warning size={18} weight="fill" />
          <span className="text-sm font-medium">{t('controlCenter.offline')}</span>
        </div>
      </Card>
    )
  }

  return (
    <Card className={`frosted-card p-4 space-y-3 ${machineState._stale ? 'border-amber-500/30' : ''}`}>
      {/* ── NOT-BREWING STATE ────────────────────────────── */}
      {!isBrewing && (
        <>
          {/* Temperature + connection status — single row */}
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-1.5">
              <Thermometer size={16} className="text-muted-foreground self-center" weight="duotone" />
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {machineState.boiler_temperature != null
                  ? machineState.boiler_temperature.toFixed(1)
                  : '—'}
              </span>
              <span className="text-sm text-muted-foreground">°C</span>
              {machineState.target_temperature != null && !isIdle && (
                <span className="text-xs text-muted-foreground ml-1">
                  / {machineState.target_temperature.toFixed(0)}°C
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {(() => {
                const { dot, key } = connectionDot(machineState)
                return (
                  <>
                    <span className="text-[10px] text-muted-foreground">
                      {t(`controlCenter.connection.${key}`)}
                    </span>
                    {machineState.state && machineState._wsConnected && (
                      stateBadge(machineState.state, false, t)
                    )}
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                  </>
                )
              })()}
            </div>
          </div>

          {/* Preheat countdown — prominent display when preheating */}
          {isPreheating && machineState.preheat_countdown != null && machineState.preheat_countdown > 0 && (() => {
            const secs = Math.ceil(machineState.preheat_countdown)
            const mm = Math.floor(secs / 60)
            const ss = String(secs % 60).padStart(2, '0')
            return (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
                  {mm}:{ss}
                </div>
                <div className="text-[10px] text-orange-600/80 dark:text-orange-400/70">{t('controlCenter.preheat.countdown')}</div>
              </div>
            )
          })()}

          {/* Active profile with image + author + change button */}
          {displayProfile && (
            <div className="space-y-1" ref={profileSectionRef}>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {pendingProfile
                  ? t('controlCenter.sections.selectedProfile')
                  : t('controlCenter.sections.activeProfile')}
              </h4>
              {dropdownProfiles.length > 0 && (isIdle || isPreheating || isReady) && isConnected ? (
                <ProfileDropdown
                  profiles={dropdownProfiles}
                  activeProfile={displayProfile}
                  onSelectProfile={handleSelectProfile}
                  anchorRef={profileSectionRef}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {profileImgUrl && !profileImgError ? (
                        <img
                          src={profileImgUrl}
                          alt={displayProfile ?? ''}
                          className="h-full w-full object-cover"
                          onError={() => setProfileImgError(true)}
                        />
                      ) : (
                        <Coffee size={24} className="text-muted-foreground" weight="duotone" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden">
                        <span className="text-sm text-foreground font-semibold block whitespace-nowrap"
                          style={{
                            animation: displayProfile && displayProfile.length > 25 ? 'marquee 8s linear infinite' : 'none',
                          }}
                        >
                          {displayProfile}
                        </span>
                      </div>
                      {(pendingProfileMeta?.author ?? profileAuthor) && (
                        <span className="text-xs text-foreground truncate block">
                          {t('controlCenter.labels.by')} {pendingProfileMeta?.author ?? profileAuthor}
                        </span>
                      )}
                    </div>
                    <CaretUpDown size={16} weight="bold" className="shrink-0 text-muted-foreground" />
                  </div>
                </ProfileDropdown>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                    {profileImgUrl && !profileImgError ? (
                      <img
                        src={profileImgUrl}
                        alt={displayProfile ?? ''}
                        className="h-full w-full object-cover"
                        onError={() => setProfileImgError(true)}
                      />
                    ) : (
                      <Coffee size={24} className="text-muted-foreground" weight="duotone" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="overflow-hidden">
                      <span className="text-sm text-foreground font-semibold block whitespace-nowrap"
                        style={{
                          animation: displayProfile && displayProfile.length > 25 ? 'marquee 8s linear infinite' : 'none',
                        }}
                      >
                        {displayProfile}
                      </span>
                    </div>
                    {(pendingProfileMeta?.author ?? profileAuthor) && (
                      <span className="text-xs text-foreground truncate block">
                        {t('controlCenter.labels.by')} {pendingProfileMeta?.author ?? profileAuthor}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state when no profile is active — always show when connected */}
          {!displayProfile && isConnected && (
            <div className="space-y-1">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {t('controlCenter.sections.activeProfile')}
              </h4>
              {dropdownProfiles.length > 0 ? (
                <ProfileDropdown
                  profiles={dropdownProfiles}
                  activeProfile=""
                  onSelectProfile={handleSelectProfile}
                  anchorRef={profileSectionRef}
                >
                  <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 p-3 cursor-pointer hover:border-muted-foreground/50 transition-colors">
                    <div className="h-12 w-12 rounded-xl bg-muted shrink-0 flex items-center justify-center">
                      <Coffee size={24} className="text-muted-foreground/50" weight="duotone" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-muted-foreground font-medium block">
                        {t('controlCenter.noProfileSelected')}
                      </span>
                      <span className="text-xs text-muted-foreground/70 block">
                        {t('controlCenter.tapToSelect')}
                      </span>
                    </div>
                    <CaretUpDown size={16} weight="bold" className="shrink-0 text-muted-foreground/50" />
                  </div>
                </ProfileDropdown>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 p-3">
                  <div className="h-12 w-12 rounded-xl bg-muted shrink-0 flex items-center justify-center">
                    <Coffee size={24} className="text-muted-foreground/50" weight="duotone" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-muted-foreground font-medium block">
                      {t('controlCenter.noProfileSelected')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Last shot time + profile name */}
          {machineState.last_shot_time && (
            <div className="text-[10px] text-muted-foreground -mt-1">
              {machineState.last_shot_name
                ? t('controlCenter.lastShot.labelWithProfile', { time: relativeTime(machineState.last_shot_time, t), profile: machineState.last_shot_name })
                : t('controlCenter.lastShot.label', { time: relativeTime(machineState.last_shot_time, t) })}
            </div>
          )}

          {/* Pour-water alert */}
          {isPourWater && (
            <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-sm font-medium text-sky-700 dark:text-sky-400">
                {t('controlCenter.pourWater.alert')}
              </div>
            </div>
          )}

          {/* Quick actions — adapt to preheat/ready/idle state */}
          <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
            {/* Start button — loads pending profile first if needed, then starts */}
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 min-w-0 h-9 text-xs"
              disabled={!canStart}
              onClick={() => {
                impact('medium')
                cmd(async () => {
                  if (pendingProfile && pendingProfile !== activeProfile) {
                    const res = await machine.loadProfile(pendingProfile)
                    if (!res.success) {
                      toast.error(res.message ?? t('controlCenter.toasts.error'))
                      return { success: false }
                    }
                    await new Promise(r => setTimeout(r, 300))
                  }
                  return isReady ? machine.continueShot() : machine.startShot()
                }, 'startingShot')
              }}
            >
              <Play size={14} weight="fill" className="mr-1 shrink-0" />
              {t('controlCenter.actions.start')}
            </Button>
            {/* Preheat / Cancel warmup */}
            {canAbortWarmup ? (
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 min-w-0 h-9 text-xs"
                disabled={!machineState.connected}
                onClick={() => { impact('medium'); cmd(() => machine.abortShot(), isPreheating ? 'preheatCancelled' : 'warmupCancelled') }}
              >
                <XCircle size={14} weight="fill" className="mr-1 shrink-0" />
                {t('controlCenter.actions.abortPreheat')}
              </Button>
            ) : (
              <Button
                variant="dark-brew"
                size="sm"
                className="flex-1 min-w-0 h-9 text-xs"
                disabled={!isIdle || !machineState.connected}
                onClick={() => { impact('medium'); cmd(() => machine.preheat(), 'preheating') }}
              >
                <Fire size={14} weight="fill" className="mr-1 shrink-0" />
                {t('controlCenter.actions.preheat')}
              </Button>
            )}
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 min-w-0 h-9 text-xs"
              disabled={!machineState.connected}
              onClick={() => { impact('light'); cmd(() => machine.tareScale(), 'tared') }}
            >
              <Scales size={14} weight="fill" className="mr-1 shrink-0" />
              {t('controlCenter.actions.tare')}
            </Button>
          </div>

          {/* Live view shortcut during warmup/ready/pour-water */}
          {(isPreheating || isHeating || isReady || isPourWater) && onOpenLiveView && (
            <Button
              variant="dark-brew"
              size="sm"
              className="w-full h-9 text-xs"
              onClick={onOpenLiveView}
            >
              <Eye size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.live')}
            </Button>
          )}
        </>
      )}

      {/* ── BREWING STATE ──────────────────────────────── */}
      {isBrewing && (
        <>
          <div className="flex items-center justify-between">
            {stateBadge(machineState.state, true, t)}
            <span className="text-xs text-muted-foreground tabular-nums">
              <Thermometer size={12} className="inline mr-0.5" weight="duotone" />
              {machineState.boiler_temperature?.toFixed(1) ?? '—'}°C
            </span>
          </div>

          {/* Live metrics — 2×2 grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Timer */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.shot_timer != null ? machineState.shot_timer.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.time')}</div>
            </div>
            {/* Weight */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.shot_weight != null ? machineState.shot_weight.toFixed(1) : '0.0'}
                {machineState.target_weight != null && (
                  <span className="text-xs text-muted-foreground font-normal">
                    /{machineState.target_weight.toFixed(0)}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.weight')}</div>
            </div>
            {/* Pressure */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.pressure != null ? machineState.pressure.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.pressure')}</div>
            </div>
            {/* Flow */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.flow_rate != null ? machineState.flow_rate.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.flow')}</div>
            </div>
          </div>

          {/* Brewing actions */}
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="h-9 text-xs"
              onClick={() => { impact('heavy'); cmd(() => machine.stopShot(), 'stopping') }}
            >
              <Stop size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.stop')}
            </Button>
            {onOpenLiveView && (
              <Button
                variant="dark-brew"
                size="sm"
                className="h-9 text-xs"
                onClick={onOpenLiveView}
              >
                <Eye size={14} weight="fill" className="mr-1" />
                {t('controlCenter.actions.live')}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Expand / collapse toggle */}
      {!isBrewing && (
        <button
          className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? t('controlCenter.collapse') : t('controlCenter.showAll')}
          {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
        </button>
      )}

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && !isBrewing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ControlCenterExpanded machineState={machineState} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
