import type { Meta, StoryObj } from '@storybook/react-vite'
import { EspressoCompass } from './EspressoCompass'

const meta = {
  title: 'Components/EspressoCompass',
  component: EspressoCompass,
  parameters: { disableAnimation: true },
} satisfies Meta<typeof EspressoCompass>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    onBack: () => {},
  },
}
