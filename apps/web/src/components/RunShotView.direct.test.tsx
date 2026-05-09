import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFeature, type FeatureFlags } from '@/lib/featureFlags'
import * as runShotHelpers from './RunShotView.helpers'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@phosphor-icons/react', () => {
  const Icon = () => <span data-testid="icon" />
  return {
    CaretLeft: Icon,
    Play: Icon,
    Clock: Icon,
    Fire: Icon,
    Coffee: Icon,
    CalendarBlank: Icon,
    X: Icon,
    SpinnerGap: Icon,
    CheckCircle: Icon,
    Warning: Icon,
    Repeat: Icon,
    Plus: Icon,
    Trash: Icon,
    PencilSimple: Icon,
    FloppyDisk: Icon,
    FloppyDiskBack: Icon,
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn((feature: keyof FeatureFlags) => feature !== 'scheduledShots'),
}))

vi.mock('@/hooks/useKonstaOverride', () => ({
  useKonstaOverride: () => false,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
  }: {
    id?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      id={id}
      role="switch"
      type="checkbox"
      checked={checked ?? false}
      readOnly
    />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('./VariableAdjustPanel', () => ({
  VariableAdjustPanel: () => null,
}))

import { RunShotView } from './RunShotView'

const mockedHasFeature = vi.mocked(hasFeature)

describe('RunShotView scheduled-shot guards', () => {
  beforeEach(() => {
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => feature !== 'scheduledShots')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hides scheduling controls when scheduledShots is disabled', () => {
    const html = renderToString(<RunShotView onBack={() => {}} />)

    expect(html).not.toContain('runShot.schedule')
    expect(html).not.toContain('runShot.recurringSchedules')
  })

  it('keeps scheduling controls available when scheduledShots is enabled', () => {
    mockedHasFeature.mockReturnValue(true)

    const html = renderToString(<RunShotView onBack={() => {}} />)

    expect(html).toContain('runShot.schedule')
    expect(html).toContain('runShot.recurringSchedules')
  })

  it('does not schedule a profile after preheat when scheduledShots is disabled', () => {
    expect(runShotHelpers.shouldScheduleProfileAfterPreheat({
      scheduledShotsEnabled: false,
      hasSelectedProfile: true,
    })).toBe(false)
  })

  it('allows preheat handoff scheduling only when scheduling is enabled and a profile is selected', () => {
    expect(runShotHelpers.shouldScheduleProfileAfterPreheat({
      scheduledShotsEnabled: true,
      hasSelectedProfile: true,
    })).toBe(true)
    expect(runShotHelpers.shouldScheduleProfileAfterPreheat({
      scheduledShotsEnabled: true,
      hasSelectedProfile: false,
    })).toBe(false)
  })

  it('blocks scheduled-shot cancellation when scheduledShots is disabled', () => {
    const helpers = runShotHelpers as typeof runShotHelpers & {
      canCancelScheduledShot?: (args: { scheduledShotsEnabled: boolean }) => boolean
    }

    expect(helpers.canCancelScheduledShot?.({ scheduledShotsEnabled: false })).toBe(false)
    expect(helpers.canCancelScheduledShot?.({ scheduledShotsEnabled: true })).toBe(true)
  })

  it('shows variable adjustments when profile has variables', () => {
    const helpers = runShotHelpers as typeof runShotHelpers & {
      canShowVariableAdjustments?: (args: {
        hasSelectedProfile: boolean
        variableCount: number
      }) => boolean
    }

    expect(helpers.canShowVariableAdjustments?.({
      hasSelectedProfile: true,
      variableCount: 2,
    })).toBe(true)
    expect(helpers.canShowVariableAdjustments?.({
      hasSelectedProfile: true,
      variableCount: 2,
    })).toBe(true)
    expect(helpers.canShowVariableAdjustments?.({
      hasSelectedProfile: false,
      variableCount: 2,
    })).toBe(false)
    expect(helpers.canShowVariableAdjustments?.({
      hasSelectedProfile: true,
      variableCount: 0,
    })).toBe(false)
  })

  it('formats scheduled-shot preheat info through i18n', () => {
    const helpers = runShotHelpers as typeof runShotHelpers & {
      getSchedulePreheatInfo?: (args: {
        preheat: boolean
        minutes: number
        t: (key: string, options?: Record<string, unknown>) => string
      }) => string
    }
    const t = vi.fn((key: string, options?: Record<string, unknown>) => `${key}:${options?.minutes}`)

    expect(helpers.getSchedulePreheatInfo?.({ preheat: true, minutes: 10, t })).toBe('runShot.preheatStartsBefore:10')
    expect(helpers.getSchedulePreheatInfo?.({ preheat: false, minutes: 10, t })).toBe('')
  })
})
