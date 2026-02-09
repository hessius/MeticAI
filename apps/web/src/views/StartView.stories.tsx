import type { Meta, StoryObj } from '@storybook/react-vite';
import { StartView } from './StartView';

/**
 * StartView is the initial view displayed when the app starts.
 * It provides a welcoming message and action buttons for the main app features.
 * 
 * ## Features
 * - Time-based greeting (morning, afternoon, evening)
 * - Profile count display
 * - Quick access to main features
 * - Animated transitions
 * 
 * ## Props
 * - `profileCount`: Number of saved profiles (null if not loaded)
 * - Event handlers for each action button
 */
const meta = {
  title: 'Views/StartView',
  component: StartView,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'The starting view of the application with greeting and action buttons for generating profiles, viewing history, running shots, and accessing settings.',
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
    profileCount: {
      control: 'number',
      description: 'Number of saved profiles (null if not loaded)',
    },
    onGenerateNew: {
      description: 'Callback when "Generate New Profile" is clicked',
    },
    onViewHistory: {
      description: 'Callback when "Profile Catalogue" is clicked',
    },
    onRunShot: {
      description: 'Callback when "Run / Schedule" is clicked',
    },
    onSettings: {
      description: 'Callback when "Settings" is clicked',
    },
  },
} satisfies Meta<typeof StartView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default start view with no saved profiles
 */
export const NoProfiles: Story = {
  args: {
    profileCount: 0,
    onGenerateNew: () => console.log('Generate new clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunShot: () => console.log('Run shot clicked'),
    onSettings: () => console.log('Settings clicked'),
  },
};

/**
 * Start view with multiple saved profiles
 */
export const WithProfiles: Story = {
  args: {
    profileCount: 12,
    onGenerateNew: () => console.log('Generate new clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunShot: () => console.log('Run shot clicked'),
    onSettings: () => console.log('Settings clicked'),
  },
};

/**
 * Start view with single saved profile
 */
export const SingleProfile: Story = {
  args: {
    profileCount: 1,
    onGenerateNew: () => console.log('Generate new clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunShot: () => console.log('Run shot clicked'),
    onSettings: () => console.log('Settings clicked'),
  },
};

/**
 * Start view while profile count is loading
 */
export const Loading: Story = {
  args: {
    profileCount: null,
    onGenerateNew: () => console.log('Generate new clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunShot: () => console.log('Run shot clicked'),
    onSettings: () => console.log('Settings clicked'),
  },
};
