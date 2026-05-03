/**
 * ProfileDropdown — Popover-based profile selector for the Control Center.
 *
 * Replaces the basic ActionSheet with a rich dropdown showing profile image,
 * name, author, and a one-line description for each profile.
 *
 * Accessibility: uses aria-activedescendant on a focusable listbox container
 * so DOM focus stays on the list while visual focus tracks the active option.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ProfileImage } from '@/components/ProfileImage'
import { Check, CaretUpDown } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export interface DropdownProfile {
  id: string
  name: string
  author?: string
  image?: string
  display?: {
    description?: string
    shortDescription?: string
    image?: string
  }
  /** Resolved image URL ready for <img src> */
  resolvedImageUrl?: string | null
  /** Profile metadata for smart subtitle fallback */
  temperature?: number
  final_weight?: number
  stageCount?: number
}

interface ProfileDropdownProps {
  profiles: DropdownProfile[]
  activeProfile: string | null
  onSelectProfile: (name: string) => void
  disabled?: boolean
  children?: React.ReactNode
  /** Ref to an ancestor element the popover should center on */
  anchorRef?: React.RefObject<HTMLElement | null>
}

function optionId(profileId: string) {
  return `profile-option-${profileId}`
}

export function ProfileDropdown({ profiles, activeProfile, onSelectProfile, disabled, children, anchorRef }: ProfileDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Focus the listbox when popover opens, set initial focus index
  useEffect(() => {
    if (open) {
      const idx = profiles.findIndex(p => p.name === activeProfile)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusIndex(idx >= 0 ? idx : 0)
      // Defer focus to after Radix renders the content
      requestAnimationFrame(() => listRef.current?.focus())
    }
  }, [open, profiles, activeProfile])

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusIndex < 0) return
    const el = listRef.current?.querySelector(`[data-index="${focusIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, focusIndex])

  const handleSelect = useCallback((name: string) => {
    onSelectProfile(name)
    setOpen(false)
  }, [onSelectProfile])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusIndex(i => Math.min(i + 1, profiles.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusIndex >= 0 && focusIndex < profiles.length) {
          handleSelect(profiles[focusIndex].name)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }, [focusIndex, profiles, handleSelect])

  const getDescription = (profile: DropdownProfile): string => {
    if (profile.display?.shortDescription) return profile.display.shortDescription
    if (profile.display?.description) return profile.display.description
    // Build a smart fallback from profile metadata
    const parts: string[] = []
    if (profile.stageCount && profile.stageCount > 0) {
      parts.push(t('controlCenter.profileSelector.stageCount', '{{count}} stages', { count: profile.stageCount }))
    }
    if (profile.final_weight) {
      const weightStr = `${profile.final_weight} g`
      if (profile.temperature) {
        parts.push(`${weightStr} @ ${profile.temperature}°C`)
      } else {
        parts.push(weightStr)
      }
    } else if (profile.temperature) {
      parts.push(`${profile.temperature}°C`)
    }
    return parts.length > 0 ? parts.join(' · ') : t('controlCenter.profileSelector.defaultDescription')
  }

  // Compute horizontal offset to center popover on the anchorRef element
  const [alignOffset, setAlignOffset] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !anchorRef?.current || !triggerRef.current) {
      setAlignOffset(0)
      return
    }
    const anchorRect = anchorRef.current.getBoundingClientRect()
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const anchorCenter = anchorRect.left + anchorRect.width / 2
    const triggerCenter = triggerRect.left + triggerRect.width / 2
    setAlignOffset(Math.round(anchorCenter - triggerCenter))
  }, [open, anchorRef])

  if (profiles.length === 0) return null

  const activeDescendant = focusIndex >= 0 && focusIndex < profiles.length
    ? optionId(profiles[focusIndex].id)
    : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children ? (
          <div
            ref={triggerRef as React.RefObject<HTMLDivElement>}
            role="button"
            tabIndex={0}
            className="cursor-pointer"
            aria-label={t('controlCenter.profileSelector.placeholder')}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {children}
          </div>
        ) : (
          <button
            ref={triggerRef as React.RefObject<HTMLButtonElement>}
            className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label={t('controlCenter.profileSelector.placeholder')}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <CaretUpDown size={16} weight="bold" />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="center"
        alignOffset={alignOffset}
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(320px,calc(100vw-2rem))] p-0 overflow-hidden"
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border/50">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('controlCenter.profileSelector.placeholder')}
          </h4>
        </div>

        {/* Profile list — focusable container with aria-activedescendant */}
        <div
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={t('controlCenter.profileSelector.placeholder')}
          aria-activedescendant={activeDescendant}
          onKeyDown={handleKeyDown}
          className="max-h-[280px] overflow-y-auto overscroll-contain py-1 outline-none"
        >
          {profiles.map((profile, index) => {
            const isActive = profile.name === activeProfile
            const isFocused = index === focusIndex
            const desc = getDescription(profile)

            return (
              <div
                key={profile.id}
                id={optionId(profile.id)}
                role="option"
                aria-selected={isActive}
                data-index={index}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer',
                  'min-h-[44px]',
                  isFocused && 'bg-accent',
                  isActive && !isFocused && 'bg-accent/50',
                  !isFocused && !isActive && 'hover:bg-muted/50',
                )}
                onClick={() => handleSelect(profile.name)}
                onMouseEnter={() => setFocusIndex(index)}
              >
                <ProfileImage
                  imageUrl={profile.resolvedImageUrl ?? undefined}
                  alt={profile.name}
                  size="sm"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">
                      {profile.name}
                    </span>
                    {isActive && (
                      <Check size={14} weight="bold" className="text-primary shrink-0" />
                    )}
                  </div>
                  {desc && (
                    <span className="text-xs text-foreground/70 line-clamp-1">
                      {desc}
                    </span>
                  )}
                  {profile.author && (
                    <span className="text-xs text-foreground/50 line-clamp-1">
                      {t('controlCenter.labels.by')} {profile.author}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
