import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShotFactsPanel } from './ShotFactsPanel'
import type { ShotFacts } from '../../lib/shotFacts'
import type { StoredTaste } from '../../lib/shotTasteStore'

const meta = {
  title: 'Components/ShotFactsPanel',
  component: ShotFactsPanel,
  parameters: { disableAnimation: true },
} satisfies Meta<typeof ShotFactsPanel>

export default meta
type Story = StoryObj<typeof meta>

const facts: ShotFacts = {
  stages: [
    {
      stage_name: 'Preinfuse',
      reached: true,
      control_mode: 'flow',
      declared_mode: 'flow',
      mode_overridden: false,
      trigger_type: 'time',
      trigger_class: { kind: 'targeted', label: 'Targeted (planned duration)', reason: 'Time is the only trigger.' },
      stall: { stalled: false, weight_gain: 2.1 },
      channeling: { channeling: false, pressure_drop: 0.2, flow_rise: 0.1 },
      curve_adherence: { target: 2.0, measured: 2.1, delta: 0.1 },
    },
    {
      stage_name: 'Extraction',
      reached: true,
      control_mode: 'pressure',
      declared_mode: 'pressure',
      mode_overridden: false,
      trigger_type: 'weight',
      trigger_class: { kind: 'failsafe', label: 'Failsafe (caught channeling or choking)', reason: 'Pressure-controlled stage exited on a flow backstop.' },
      stall: { stalled: false, weight_gain: 38.0 },
      channeling: { channeling: true, pressure_drop: 2.0, flow_rise: 1.8 },
      curve_adherence: { target: 9.0, measured: 7.8, delta: -1.2 },
    },
    {
      stage_name: 'Decline',
      reached: false,
    },
  ],
  phases: [
    { stage_name: 'Preinfuse', phase: 'pre-infusion', avg_pressure: 1.8, avg_flow: 2.0, weight_gain: 2.1 },
    { stage_name: 'Extraction', phase: 'peak', avg_pressure: 8.5, avg_flow: 3.2, weight_gain: 38.0 },
  ],
  weight: { actual: 40.1, target: 40, deviation_pct: 0.25 },
  total_time_s: 32,
}

const taste: StoredTaste = {
  x: -0.6,
  y: 0.1,
  descriptors: ['sour', 'generic'],
}

export const Default: Story = {
  args: { facts },
}

export const WithTaste: Story = {
  args: { facts, taste },
}
