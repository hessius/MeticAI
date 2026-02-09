import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkipNavigation } from './SkipNavigation';

/**
 * SkipNavigation component provides keyboard-accessible navigation skip links.
 * This is essential for accessibility, allowing users to bypass repetitive content.
 * 
 * ## Accessibility Features
 * - Allows keyboard users to jump to main content areas
 * - Visible on focus for keyboard navigation
 * - Automatically manages focus and tabindex
 * - Smooth scroll to target elements
 * 
 * ## Usage
 * Place this component at the top of your page layout, before any other content.
 */
const meta = {
  title: 'Components/SkipNavigation',
  component: SkipNavigation,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Skip navigation links for keyboard accessibility. Helps users bypass repetitive navigation and jump directly to main content areas.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div>
        <Story />
        <div id="main-content" style={{ padding: '2rem', border: '2px dashed #888', margin: '1rem' }}>
          <h2>Main Content</h2>
          <p>This is the main content area that skip navigation links to.</p>
        </div>
        <div id="navigation" style={{ padding: '2rem', border: '2px dashed #888', margin: '1rem' }}>
          <h2>Navigation</h2>
          <p>This is the navigation area.</p>
        </div>
      </div>
    ),
  ],
  argTypes: {
    links: {
      control: 'object',
      description: 'Array of skip link objects with id and label properties',
      table: {
        type: { summary: 'Array<{ id: string, label: string }>' },
      },
    },
  },
} satisfies Meta<typeof SkipNavigation>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default skip navigation with standard links
 */
export const Default: Story = {
  args: {},
};

/**
 * Custom skip navigation links
 */
export const CustomLinks: Story = {
  args: {
    links: [
      { id: 'main-content', label: 'Jump to content' },
      { id: 'navigation', label: 'Jump to menu' },
    ],
  },
};

/**
 * Skip navigation with single link
 */
export const SingleLink: Story = {
  args: {
    links: [
      { id: 'main-content', label: 'Skip to main content' },
    ],
  },
};
