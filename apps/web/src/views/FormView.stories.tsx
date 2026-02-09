import type { Meta, StoryObj } from '@storybook/react-vite';
import { FormView } from './FormView';
import { useRef, type ComponentProps } from 'react';

// Wrapper component to properly use hooks in Storybook
function FormViewWithRef(props: Omit<ComponentProps<typeof FormView>, 'fileInputRef'>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return <FormView {...props} fileInputRef={fileInputRef} />;
}

/**
 * FormView component for creating new espresso profiles.
 * Users can upload a coffee bag image, enter taste preferences, select tags, and configure advanced options.
 * 
 * ## Features
 * - Image upload with preview
 * - Taste preference text input
 * - Preset tag selection
 * - Advanced customization options
 * - Form validation and error display
 * - Profile count display
 * 
 * ## Usage
 * Used as the main form for generating new espresso profiles.
 */
const meta = {
  title: 'Views/FormView',
  component: FormViewWithRef,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Form view for creating new espresso profiles with image upload, preferences, tags, and advanced options.',
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
    imagePreview: {
      control: 'text',
      description: 'Data URL of the uploaded image preview',
    },
    userPrefs: {
      control: 'text',
      description: 'User-entered taste preferences',
    },
    selectedTags: {
      control: 'object',
      description: 'Array of selected preset tags',
    },
    errorMessage: {
      control: 'text',
      description: 'Error message to display',
    },
    canSubmit: {
      control: 'boolean',
      description: 'Whether the form can be submitted',
    },
    profileCount: {
      control: 'number',
      description: 'Number of saved profiles',
    },
  },
} satisfies Meta<typeof FormViewWithRef>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Empty form ready for input
 */
export const Empty: Story = {
  args: {
    imagePreview: null,
    userPrefs: '',
    selectedTags: [],
    advancedOptions: {},
    errorMessage: '',
    canSubmit: true,
    profileCount: 5,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};

/**
 * Form with user preferences entered
 */
export const WithPreferences: Story = {
  args: {
    imagePreview: null,
    userPrefs: 'Balanced extraction with nutty notes and chocolate undertones',
    selectedTags: [],
    advancedOptions: {},
    errorMessage: '',
    canSubmit: true,
    profileCount: 5,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};

/**
 * Form with selected tags
 */
export const WithTags: Story = {
  args: {
    imagePreview: null,
    userPrefs: '',
    selectedTags: ['Bright', 'Fruity', 'Light Roast'],
    advancedOptions: {},
    errorMessage: '',
    canSubmit: true,
    profileCount: 5,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};

/**
 * Form with image preview
 */
export const WithImage: Story = {
  args: {
    imagePreview: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext fill="%23fff" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="24"%3ECoffee Bag%3C/text%3E%3C/svg%3E',
    userPrefs: '',
    selectedTags: [],
    advancedOptions: {},
    errorMessage: '',
    canSubmit: true,
    profileCount: 5,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};

/**
 * Form with error message
 */
export const WithError: Story = {
  args: {
    imagePreview: null,
    userPrefs: '',
    selectedTags: [],
    advancedOptions: {},
    errorMessage: 'Please enter taste preferences or select at least one tag',
    canSubmit: false,
    profileCount: 5,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};

/**
 * Form for first-time user (no profiles)
 */
export const FirstTime: Story = {
  args: {
    imagePreview: null,
    userPrefs: '',
    selectedTags: [],
    advancedOptions: {},
    errorMessage: '',
    canSubmit: true,
    profileCount: 0,
    onFileSelect: () => console.log('File selected'),
    onRemoveImage: () => console.log('Image removed'),
    onUserPrefsChange: () => console.log('Prefs changed'),
    onToggleTag: () => console.log('Tag toggled'),
    onAdvancedOptionsChange: () => console.log('Advanced options changed'),
    onSubmit: () => console.log('Submit clicked'),
    onBack: () => console.log('Back clicked'),
    onViewHistory: () => console.log('View history clicked'),
  },
  render: (args) => <FormViewWithRef {...args} />,
};
