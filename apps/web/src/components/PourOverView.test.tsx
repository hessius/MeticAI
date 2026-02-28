import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PourOverView } from './PourOverView'
import type { MachineState } from '@/hooks/useWebSocket'

const mockCmd = vi.fn()

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@/hooks/useMachineActions', () => ({
  useMachineActions: () => ({ cmd: mockCmd }),
}))

vi.mock('@/lib/mqttCommands', () => ({
  tareScale: 'tare_scale',
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
  beforeEach(() => {
    mockCmd.mockReset()
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
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('shows offline notice and disables tare when machine is disconnected', async () => {
    const user = userEvent.setup()

    render(
      <PourOverView
        machineState={makeMachineState({ connected: false, shot_weight: 0 })}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByText('Machine is offline. Scale actions are disabled until connection is restored.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tare' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Ratio mode' }))
    const ratioTare = screen.getAllByRole('button', { name: 'Tare' })
    expect(ratioTare[0]).toBeDisabled()
  })
})
