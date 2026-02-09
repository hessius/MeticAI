import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageSelector } from './LanguageSelector';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

/**
 * LanguageSelector component allows users to switch between different languages.
 * It uses a dropdown menu to display available languages and marks the current selection.
 * 
 * ## Features
 * - Supports multiple languages (English, Spanish, French, German)
 * - Visual indicator for current language
 * - Accessible with ARIA labels
 * - Configurable variant and label visibility
 */
const meta = {
  title: 'Components/LanguageSelector',
  component: LanguageSelector,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A dropdown component for selecting the application language. Integrates with i18next for internationalization.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <I18nextProvider i18n={i18n}>
        <Story />
      </I18nextProvider>
    ),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'ghost', 'outline'],
      description: 'The visual variant of the button',
      table: {
        defaultValue: { summary: 'ghost' },
      },
    },
    showLabel: {
      control: 'boolean',
      description: 'Whether to show the language name next to the icon',
      table: {
        defaultValue: { summary: 'true' },
      },
    },
  },
} satisfies Meta<typeof LanguageSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default language selector with label shown
 */
export const Default: Story = {
  args: {
    variant: 'ghost',
    showLabel: true,
  },
};

/**
 * Language selector with outline variant
 */
export const Outline: Story = {
  args: {
    variant: 'outline',
    showLabel: true,
  },
};

/**
 * Language selector without label (icon only)
 */
export const IconOnly: Story = {
  args: {
    variant: 'ghost',
    showLabel: false,
  },
};

/**
 * Language selector with default button variant
 */
export const DefaultVariant: Story = {
  args: {
    variant: 'default',
    showLabel: true,
  },
};
