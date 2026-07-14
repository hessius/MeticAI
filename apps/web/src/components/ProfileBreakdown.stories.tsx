import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProfileBreakdown } from './ProfileBreakdown'
import type { ProfileData } from './ProfileBreakdown'

const meta = {
  title: 'Components/ProfileBreakdown',
  component: ProfileBreakdown,
  parameters: { disableAnimation: true },
} satisfies Meta<typeof ProfileBreakdown>

export default meta
type Story = StoryObj<typeof meta>

const realisticProfile: ProfileData = {
  temperature: 93,
  final_weight: 40,
  variables: [
    { name: 'Dose', key: 'dose', type: 'info', value: 18 },
    { name: 'Preinfusion Time', key: 'preinfuse_time', type: 'time', value: 8 },
    { name: 'Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 9 },
  ],
  stages: [
    {
      name: 'Preinfuse',
      type: 'flow',
      exit_triggers: [{ type: 'time', value: 8 }],
      limits: [{ type: 'pressure', value: 3 }],
    },
    {
      name: 'Ramp',
      type: 'flow',
      exit_triggers: [{ type: 'pressure', value: 9 }],
      limits: [{ type: 'pressure', value: 11 }],
    },
    {
      name: 'Extraction',
      type: 'pressure',
      exit_triggers: [{ type: 'weight', value: 40 }],
      limits: [{ type: 'flow', value: 6 }],
    },
  ],
}

export const Default: Story = {
  args: {
    profile: realisticProfile,
  },
}

export const Empty: Story = {
  args: {
    profile: null,
  },
}

export const RuntimeMode: Story = {
  args: {
    profile: realisticProfile,
    hideVariables: true,
  },
}
