import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResultsView } from './ResultsView';
import { useRef, type ComponentProps } from 'react';

// Wrapper component to properly use hooks in Storybook
function ResultsViewWithRef(props: Omit<ComponentProps<typeof ResultsView>, 'resultsCardRef'>) {
  const resultsCardRef = useRef<HTMLDivElement>(null);
  return <ResultsView {...props} resultsCardRef={resultsCardRef} />;
}

/**
 * ResultsView displays the generated espresso profile with analysis and details.
 * 
 * ## Features
 * - Profile name display
 * - Coffee analysis section
 * - Profile sections (Description, Preparation, Why This Works, Special Notes)
 * - Profile breakdown with technical details
 * - Export options (image, JSON)
 * - Quick actions (run shot, view history)
 * 
 * ## Props
 * - `apiResponse`: The API response containing profile data
 * - `currentProfileJson`: JSON representation of the profile
 * - `createdProfileId`: ID of the created profile
 * - `isCapturing`: Whether currently capturing screenshot
 * - Event handlers for various actions
 */
const meta = {
  title: 'Views/ResultsView',
  component: ResultsViewWithRef,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Results view showing the generated espresso profile with analysis, details, and export options.',
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
    apiResponse: {
      control: 'object',
      description: 'API response containing profile analysis and details',
    },
    currentProfileJson: {
      control: 'object',
      description: 'JSON representation of the profile',
    },
    createdProfileId: {
      control: 'text',
      description: 'ID of the created profile',
    },
    isCapturing: {
      control: 'boolean',
      description: 'Whether currently capturing screenshot',
    },
  },
} satisfies Meta<typeof ResultsViewWithRef>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleResponse = {
  status: 'success' as const,
  analysis: 'This medium roast Ethiopian coffee shows bright citrus notes with floral aromatics. The bean density suggests a higher altitude origin, ideal for balanced extraction.',
  reply: `Profile Created: **Bright Ethiopian Blend**

**Description:**
A vibrant single-origin profile highlighting the natural sweetness and complexity of Ethiopian beans. This profile emphasizes clarity and brightness while maintaining body.

**Preparation:**
- Grind: Medium-fine (20-click range on Niche Zero)
- Dose: 18g in, 36g out (1:2 ratio)
- Temperature: 93°C (199°F)
- Time: 25-30 seconds

**Why This Works:**
The slightly lower temperature preserves the delicate floral notes while the moderate pressure curve prevents over-extraction of the citrus elements. The 1:2 ratio ensures a balanced cup that showcases the bean's natural sweetness.

**Special Notes:**
Best enjoyed as a straight espresso or in a cortado. The bright acidity cuts through milk beautifully without losing character.`,
};

const sampleProfileJson = {
  name: 'Bright Ethiopian Blend',
  dose: 18,
  targetVolume: 36,
  temperature: 93,
  steps: [
    { time: 0, pressure: 9, flow: 2 },
    { time: 5, pressure: 9, flow: 2.5 },
    { time: 25, pressure: 6, flow: 2.5 },
  ],
};

/**
 * Success result with full profile details
 */
export const Success: Story = {
  args: {
    apiResponse: sampleResponse,
    currentProfileJson: sampleProfileJson,
    createdProfileId: 'profile-123',
    isCapturing: false,
    onBack: () => console.log('Back clicked'),
    onSaveResults: () => console.log('Save results clicked'),
    onDownloadJson: () => console.log('Download JSON clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunProfile: () => console.log('Run profile clicked'),
  },
  render: (args) => <ResultsViewWithRef {...args} />,
};

/**
 * Results without profile JSON (text only)
 */
export const TextOnly: Story = {
  args: {
    apiResponse: sampleResponse,
    currentProfileJson: null,
    createdProfileId: null,
    isCapturing: false,
    onBack: () => console.log('Back clicked'),
    onSaveResults: () => console.log('Save results clicked'),
    onDownloadJson: () => console.log('Download JSON clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunProfile: () => console.log('Run profile clicked'),
  },
  render: (args) => <ResultsViewWithRef {...args} />,
};

/**
 * Capturing mode (for screenshot)
 */
export const Capturing: Story = {
  args: {
    apiResponse: sampleResponse,
    currentProfileJson: sampleProfileJson,
    createdProfileId: 'profile-123',
    isCapturing: true,
    onBack: () => console.log('Back clicked'),
    onSaveResults: () => console.log('Save results clicked'),
    onDownloadJson: () => console.log('Download JSON clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunProfile: () => console.log('Run profile clicked'),
  },
  render: (args) => <ResultsViewWithRef {...args} />,
};

/**
 * Simple profile without sections
 */
export const SimpleProfile: Story = {
  args: {
    apiResponse: {
      status: 'success' as const,
      analysis: 'Well-balanced medium roast with chocolate and nut notes.',
      reply: 'A versatile espresso profile suitable for both straight shots and milk-based drinks. Dose 18g, extract 36g in 28 seconds at 93°C.',
    },
    currentProfileJson: sampleProfileJson,
    createdProfileId: 'profile-456',
    isCapturing: false,
    onBack: () => console.log('Back clicked'),
    onSaveResults: () => console.log('Save results clicked'),
    onDownloadJson: () => console.log('Download JSON clicked'),
    onViewHistory: () => console.log('View history clicked'),
    onRunProfile: () => console.log('Run profile clicked'),
  },
  render: (args) => <ResultsViewWithRef {...args} />,
};
