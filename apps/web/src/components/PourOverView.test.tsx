import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PourOverView } from './PourOverView'
import type { MachineState } from '@/hooks/useWebSocket'

const mockCmd = vi.fn()

// Track mock state for useMachineActions
const mockMachineActions = {
  cmd: mockCmd,
  isBrewing: false,
  isConnected: true,
  canStart: true,
  isClickToPurge: false,
  stateLC: 'idle',
  isIdle: true,
  isPreheating: false,
  isHeating: false,
  isReady: false,
  isPourWater: false,
  canAbortWarmup: false,
}

// Mock react-i18next to return English translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'pourOver.title': 'Pour-over',
        'pourOver.freeMode': 'Free mode',
        'pourOver.ratioMode': 'Ratio mode',
        'pourOver.weight': 'Weight',
        'pourOver.timer': 'Timer',
        'pourOver.flow': 'Flow',
        'pourOver.unitGrams': 'g',
        'pourOver.unitTime': 's',
        'pourOver.unitFlowRate': 'g/s',
        'pourOver.start': 'Start',
        'pourOver.stop': 'Stop',
        'pourOver.reset': 'Reset',
        'pourOver.tare': 'Tare',
        'pourOver.targetWater': 'Target water',
        'pourOver.remaining': 'Remaining',
        'pourOver.offlineNotice': 'Machine is offline. Scale actions are disabled until connection is restored.',
        'pourOver.doseLabel': 'Dose (g)',
        'pourOver.ratioLabel': 'Ratio (1:x)',
        'pourOver.weighFromScale': 'Weigh from scale',
        'pourOver.weighFromScaleShort': 'Set dose from scale',
        'pourOver.weighFromScaleDescription': 'Transfers the current scale reading as your coffee dose',
        'pourOver.doseWarningTitle': 'Dose seems high',
        'pourOver.doseWarningDescription': 'You\'re about to set {{weight}}g as your dose. Did you forget to tare the scale?',
        'pourOver.doseWarningConfirm': 'Use {{weight}}g',
        'pourOver.integration.toggle': 'Machine integration',
        'pourOver.integration.toggleDescription': 'Create and run a profile on your Meticulous machine.',
        'pourOver.integration.startOnMachine': 'Start on machine',
        'pourOver.integration.stop': 'Stop',
        'pourOver.integration.newShot': 'New shot',
        'pourOver.integration.invalidWeight': 'Set a valid dose and ratio.',
        'pourOver.integration.status.preparing': 'Preparing profile…',
        'pourOver.integration.status.ready': 'Profile loaded',
        'pourOver.integration.status.brewing': 'Brewing on machine…',
        'pourOver.integration.status.drawdown': 'Target reached — timing drawdown…',
        'pourOver.integration.status.purging': 'Cleaning up profile…',
        'pourOver.integration.status.done': 'Shot complete!',
        'pourOver.integration.status.error': 'Something went wrong.',
        'pourOver.integration.shotEndedAt': 'Shot ended at',
        'pourOver.autoStartTimer': 'Auto-start timer',
        'pourOver.autoStartDescription': 'Starts when pour is detected.',
        'pourOver.bloomIndicator': 'Bloom indicator',
        'pourOver.bloomDescription': 'Shows a bloom countdown.',
        'pourOver.bloomDuration': 'Bloom duration (sec)',
        'pourOver.bloomDone': 'done',
        'pourOver.bloomWeightMultiplier': 'Bloom weight target',
        'pourOver.bloomWeightMultiplierDescription': 'Target water weight during bloom, as a multiple of your dose.',
        'common.back': 'Back',
      }
      return translations[key] || key
    },
    i18n: { language: 'en' },
  }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@/hooks/useMachineActions', () => ({
  useMachineActions: () => mockMachineActions,
}))

vi.mock('@/hooks/useMachineService', () => ({
  useMachineService: () => ({
    name: 'MockMachineService',
    startShot: vi.fn().mockResolvedValue({ success: true }),
    stopShot: vi.fn().mockResolvedValue({ success: true }),
    abortShot: vi.fn().mockResolvedValue({ success: true }),
    continueShot: vi.fn().mockResolvedValue({ success: true }),
    preheat: vi.fn().mockResolvedValue({ success: true }),
    tareScale: vi.fn().mockResolvedValue({ success: true }),
    homePlunger: vi.fn().mockResolvedValue({ success: true }),
    purge: vi.fn().mockResolvedValue({ success: true }),
    loadProfile: vi.fn().mockResolvedValue({ success: true }),
    setBrightness: vi.fn().mockResolvedValue({ success: true }),
    enableSounds: vi.fn().mockResolvedValue({ success: true }),
  }),
}))

vi.mock('@/lib/mqttCommands', () => ({
  tareScale: 'tare_scale',
  startShot: vi.fn().mockResolvedValue({ success: true }),
  stopShot: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/pourOverApi', () => ({
  preparePourOver: vi.fn().mockResolvedValue({ profile_id: 'test-id', profile_name: 'MeticAI Ratio Pour-Over', loaded: true }),
  cleanupPourOver: vi.fn().mockResolvedValue({ deleted: true, purged: true }),
  forceCleanupPourOver: vi.fn().mockResolvedValue({ deleted: true }),
  getActivePourOver: vi.fn().mockResolvedValue({ active: false }),
  getPourOverPreferences: vi.fn().mockResolvedValue({
    free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
    ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
    recipe: { machineIntegration: false },
  }),
  savePourOverPreferences: vi.fn().mockResolvedValue({
    free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
    ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
    recipe: { machineIntegration: false },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

function makeMachineState(overrides: Partial<MachineState> = {}): MachineState {
  return {
    connected: true,
    availability: 'online',
    boiler_temperature: null,
    brew_head_temperature: null,
    target_temperature: null,
    brewing: false,
    state: 'idle',
    pressure: null,
    flow_rate: null,
    power: null,
    shot_weight: 42,
    shot_timer: null,
    target_weight: null,
    preheat_countdown: null,
    active_profile: null,
    total_shots: null,
    brightness: null,
    sounds_enabled: null,
    voltage: null,
    firmware_version: null,
    last_shot_time: null,
    last_shot_name: null,
    _ts: Date.now(),
    _stale: false,
    _wsConnected: true,
    ...overrides,
  }
}

describe('PourOverView', () => {
  beforeEach(async () => {
    mockCmd.mockReset()
    // Reset machine actions to defaults
    mockMachineActions.cmd = mockCmd
    mockMachineActions.isBrewing = false
    mockMachineActions.isConnected = true
    mockMachineActions.canStart = true
    mockMachineActions.isClickToPurge = false
    mockMachineActions.stateLC = 'idle'
    mockMachineActions.isIdle = true

    // Reset preferences mocks to default values
    const { getPourOverPreferences, savePourOverPreferences } = await import('@/lib/pourOverApi')
    vi.mocked(getPourOverPreferences).mockResolvedValue({
      free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      recipe: { machineIntegration: false, autoStart: true, progressionMode: 'weight' as const },
    })
    vi.mocked(savePourOverPreferences).mockResolvedValue({
      free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      recipe: { machineIntegration: false, autoStart: true, progressionMode: 'weight' as const },
    })
  })

  it('renders free mode by default with live weight and timer controls', () => {
    render(
      <PourOverView
        machineState={makeMachineState({ shot_weight: 18.3 })}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Pour-over')).toBeInTheDocument()
    expect(screen.getByText('18.3')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Free mode' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tare' })).toBeInTheDocument()
  })

  it('switches to ratio mode and computes target + remaining grams', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState({ shot_weight: 120 })}
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    const doseInput = screen.getByLabelText('Dose (g)')
    const ratioInput = screen.getByLabelText('Ratio (1:x)')

    await user.clear(doseInput)
    await user.type(doseInput, '20')
    await user.clear(ratioInput)
    await user.type(ratioInput, '15')

    expect(screen.getByText('Target water')).toBeInTheDocument()
    expect(screen.getByText('300.0 g')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
    expect(screen.getByText('180.0 g')).toBeInTheDocument()
    // Two 40% elements: one for mobile layout, one for desktop layout
    expect(screen.getAllByText('40%').length).toBeGreaterThanOrEqual(1)
  })

  it('shows offline notice and disables tare when machine is disconnected', async () => {
    render(
      <PourOverView
        machineState={makeMachineState({ connected: false, shot_weight: 0 })}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Machine is offline. Scale actions are disabled until connection is restored.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tare' })).toBeDisabled()
  })

  it('captures scale weight into dose via "Set dose from scale" button', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState({ shot_weight: 18.5 })}
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    const weighBtn = screen.getByRole('button', { name: 'Weigh from scale' })
    expect(weighBtn).toBeEnabled()

    // Single click captures dose immediately
    await user.click(weighBtn)

    const doseInput = screen.getByLabelText('Dose (g)') as HTMLInputElement
    expect(doseInput.value).toBe('18.5')
  })

  it('shows warning dialog when scale weight > 50g on dose capture', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState({ shot_weight: 120 })}
        onBack={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    const weighBtn = screen.getByRole('button', { name: 'Weigh from scale' })
    await user.click(weighBtn)

    // Warning dialog should appear
    expect(screen.getByText('Dose seems high')).toBeInTheDocument()
  })

  it('shows flow rate card alongside weight and timer', () => {
    render(
      <PourOverView
        machineState={makeMachineState({ shot_weight: 10 })}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(screen.getByText('g/s')).toBeInTheDocument()
  })

  it('shows machine integration toggle in ratio mode settings', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Switch to ratio mode
    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    // Integration toggle should be visible
    expect(screen.getByText('Machine integration')).toBeInTheDocument()
  })

  it('does not show integration toggle in free mode', () => {
    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Free mode by default — no integration toggle
    expect(screen.queryByText('Machine integration')).not.toBeInTheDocument()
  })

  it('shows "Start on machine" button when integration is enabled', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Switch to ratio mode
    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    // Enable integration
    const integrationSwitch = screen.getByText('Machine integration').closest('div')?.parentElement?.querySelector('[role="switch"]')
    expect(integrationSwitch).toBeInTheDocument()
    await user.click(integrationSwitch!)

    // Should show machine-specific start button
    expect(screen.getByRole('button', { name: /Start on machine/i })).toBeInTheDocument()
  })

  it('disables auto-start when integration is toggled on', async () => {
    const user = userEvent.setup()
    const { getPourOverPreferences } = await import('@/lib/pourOverApi')

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Wait for preferences to be loaded before interacting
    await vi.waitFor(() => {
      expect(getPourOverPreferences).toHaveBeenCalled()
    })

    // Switch to ratio mode
    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    // Enable integration
    const integrationSwitch = screen.getByText('Machine integration').closest('div')?.parentElement?.querySelector('[role="switch"]')
    await user.click(integrationSwitch!)

    // Auto-start switch should be disabled (wait for state to propagate)
    await vi.waitFor(() => {
      const autoStartSwitch = screen.getByText('Auto-start timer').closest('div')?.parentElement?.querySelector('[role="switch"]')
      expect(autoStartSwitch).toHaveAttribute('disabled')
    })
  })

  it('disables integration toggle when machine is disconnected', async () => {
    const user = userEvent.setup()
    mockMachineActions.isConnected = false

    render(
      <PourOverView
        machineState={makeMachineState({ connected: false })}
        onBack={vi.fn()}
      />,
    )

    // Switch to ratio mode
    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    // Integration switch should be disabled
    const integrationSwitch = screen.getByText('Machine integration').closest('div')?.parentElement?.querySelector('[role="switch"]')
    expect(integrationSwitch).toHaveAttribute('disabled')
  })

  it('loads preferences from server on mount', async () => {
    const { getPourOverPreferences } = await import('@/lib/pourOverApi')

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    expect(getPourOverPreferences).toHaveBeenCalled()
  })

  it('applies stored preferences for ratio mode when switching tabs', async () => {
    const { getPourOverPreferences } = await import('@/lib/pourOverApi')
    const user = userEvent.setup()

    // Return different prefs per mode: ratio has autoStart off
    vi.mocked(getPourOverPreferences).mockResolvedValue({
      free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      ratio: { autoStart: false, bloomEnabled: false, bloomSeconds: 45, bloomWeightMultiplier: 2, machineIntegration: false },
      recipe: { machineIntegration: false, autoStart: true, progressionMode: 'weight' as const },
    })

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Wait for prefs to load
    await vi.waitFor(() => {
      expect(getPourOverPreferences).toHaveBeenCalled()
    })

    // Switch to ratio mode – bloom should be off
    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))

    const bloomSwitch = screen.getByText('Bloom indicator').closest('div')?.parentElement?.querySelector('[role="switch"]')
    expect(bloomSwitch).toHaveAttribute('aria-checked', 'false')
  })

  it('saves preferences to server when a toggle changes', async () => {
    const { savePourOverPreferences, getPourOverPreferences } = await import('@/lib/pourOverApi')
    const user = userEvent.setup()

    vi.mocked(getPourOverPreferences).mockResolvedValue({
      free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false },
      recipe: { machineIntegration: false, autoStart: true, progressionMode: 'weight' as const },
    })

    render(
      <PourOverView
        machineState={makeMachineState()}
        onBack={vi.fn()}
      />,
    )

    // Wait for prefs to load
    await vi.waitFor(() => {
      expect(getPourOverPreferences).toHaveBeenCalled()
    })

    // Toggle bloom off
    const bloomSwitch = screen.getByText('Bloom indicator').closest('div')?.parentElement?.querySelector('[role="switch"]')
    await user.click(bloomSwitch!)

    // save is debounced (500ms), advance timers
    await vi.waitFor(() => {
      expect(savePourOverPreferences).toHaveBeenCalled()
    }, { timeout: 2000 })
  })
})
