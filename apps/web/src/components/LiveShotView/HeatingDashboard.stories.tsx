import type { Meta, StoryObj } from '@storybook/react-vite'
import { HeatingDashboard } from './HeatingDashboard'
import type { TempSample } from './estimateTimeToReady'
import type { ProfileData } from '@/components/ProfileBreakdown'

const meta = {
  title: 'Components/HeatingDashboard',
  component: HeatingDashboard,
  parameters: { disableAnimation: true },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeatingDashboard>

export default meta
type Story = StoryObj<typeof meta>

const SET_TEMP = 93
const LANCE_CUTOFF = 90

const samples: TempSample[] = [
  { t: 0, temp: 25, chamber: 26 },
  { t: 30, temp: 40, chamber: 42 },
  { t: 60, temp: 58, chamber: 60 },
  { t: 90, temp: 72, chamber: 74 },
  { t: 120, temp: 82, chamber: 84 },
  { t: 150, temp: 87, chamber: 89 },
  { t: 180, temp: 89, chamber: 91 },
]

const profile: ProfileData = {
  temperature: 93,
  final_weight: 40,
  stages: [
    {
      name: 'Preinfuse',
      type: 'flow',
      exit_triggers: [{ type: 'time', value: 8 }],
    },
    {
      name: 'Extraction',
      type: 'pressure',
      exit_triggers: [{ type: 'weight', value: 40 }],
    },
  ],
}

export const Heating: Story = {
  args: {
    isReady: false,
    isHeating: true,
    profileName: 'Slow-Mo Blossom',
    setTemp: SET_TEMP,
    chamberTemp: 84,
    headTemp: 75,
    lanceReadyCutoff: LANCE_CUTOFF,
    samples,
    profile,
    description: 'A gentle flow profile with a long preinfusion for sweet, transparent shots.',
    startDisabled: true,
    onStart: () => {},
    onAbort: () => {},
  },
}

export const ReadyToBrew: Story = {
  args: {
    isReady: true,
    isHeating: false,
    profileName: 'Slow-Mo Blossom',
    setTemp: SET_TEMP,
    chamberTemp: 91,
    headTemp: 88,
    lanceReadyCutoff: LANCE_CUTOFF,
    samples: [
      ...samples,
      { t: 200, temp: 88, chamber: 92 },
    ],
    profile,
    description: 'A gentle flow profile with a long preinfusion for sweet, transparent shots.',
    startDisabled: false,
    onStart: () => {},
    onAbort: () => {},
  },
}

export const Stable: Story = {
  args: {
    isReady: true,
    isHeating: false,
    profileName: 'Slow-Mo Blossom',
    setTemp: SET_TEMP,
    chamberTemp: 93,
    headTemp: 91,
    lanceReadyCutoff: LANCE_CUTOFF,
    samples: [
      ...samples,
      { t: 200, temp: 88, chamber: 92 },
      { t: 230, temp: 91, chamber: 93 },
    ],
    profile,
    description: 'A gentle flow profile with a long preinfusion for sweet, transparent shots.',
    startDisabled: false,
    onStart: () => {},
    onAbort: () => {},
  },
}
