import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadingView, LOADING_MESSAGE_COUNT } from './LoadingView';

/**
 * LoadingView displays animated loading state while generating espresso profiles.
 * 
 * ## Features
 * - Rotating icon animation
 * - Cycling through humorous loading messages
 * - Progress bar with estimated time
 * - Message references to coffee community personalities
 * 
 * ## Props
 * - `currentMessage`: Index of the current loading message to display (0-based)
 * 
 * ## Usage
 * Display this view when generating a profile, cycling through messages every few seconds.
 */
const meta = {
  title: 'Views/LoadingView',
  component: LoadingView,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Loading view displayed while generating espresso profiles. Shows animated icon, rotating messages, and progress indicator.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '400px', maxWidth: '100%' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    currentMessage: {
      control: { type: 'range', min: 0, max: LOADING_MESSAGE_COUNT - 1, step: 1 },
      description: `Index of the loading message to display (0-${LOADING_MESSAGE_COUNT - 1})`,
    },
  },
} satisfies Meta<typeof LoadingView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * First loading message
 */
export const Start: Story = {
  args: {
    currentMessage: 0,
  },
};

/**
 * Middle of loading sequence
 */
export const Middle: Story = {
  args: {
    currentMessage: 7,
  },
};

/**
 * Near end of loading sequence
 */
export const NearEnd: Story = {
  args: {
    currentMessage: 14,
  },
};

/**
 * Last loading message
 */
export const AlmostThere: Story = {
  args: {
    currentMessage: LOADING_MESSAGE_COUNT - 1,
  },
};
