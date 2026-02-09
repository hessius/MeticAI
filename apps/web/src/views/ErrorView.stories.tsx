import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorView } from './ErrorView';

/**
 * ErrorView displays error messages when profile generation fails.
 * 
 * ## Features
 * - Clear error message display
 * - Retry and back actions
 * - Scrollable error details for long messages
 * - Warning icon for visual emphasis
 * 
 * ## Props
 * - `errorMessage`: The error message to display
 * - `onRetry`: Callback when retry button is clicked
 * - `onBack`: Callback when back button is clicked
 * 
 * ## Usage
 * Display when API calls fail or validation errors occur.
 */
const meta = {
  title: 'Views/ErrorView',
  component: ErrorView,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Error view displayed when profile generation or other operations fail. Provides error details and recovery options.',
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
    errorMessage: {
      control: 'text',
      description: 'The error message to display to the user',
    },
    onRetry: {
      description: 'Callback function when retry button is clicked',
    },
    onBack: {
      description: 'Callback function when back button is clicked',
    },
  },
} satisfies Meta<typeof ErrorView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Simple error message
 */
export const SimpleError: Story = {
  args: {
    errorMessage: 'Failed to generate profile. Please try again.',
    onRetry: () => console.log('Retry clicked'),
    onBack: () => console.log('Back clicked'),
  },
};

/**
 * Network error
 */
export const NetworkError: Story = {
  args: {
    errorMessage: 'Network error: Unable to connect to the server. Please check your internet connection and try again.',
    onRetry: () => console.log('Retry clicked'),
    onBack: () => console.log('Back clicked'),
  },
};

/**
 * API error with details
 */
export const APIError: Story = {
  args: {
    errorMessage: 'API Error: Invalid response from server.\n\nStatus: 500\nMessage: Internal Server Error\n\nPlease try again later.',
    onRetry: () => console.log('Retry clicked'),
    onBack: () => console.log('Back clicked'),
  },
};

/**
 * Long error message (scrollable)
 */
export const LongError: Story = {
  args: {
    errorMessage: `An unexpected error occurred while processing your request.

Error Details:
- Code: ERR_PROCESSING_FAILED
- Timestamp: ${new Date().toISOString()}
- Request ID: abc123def456

Stack Trace:
at processImage (profile-generator.js:42)
at generateProfile (api-handler.js:156)
at handleRequest (server.js:89)

This error has been logged. Please try again or contact support if the problem persists.`,
    onRetry: () => console.log('Retry clicked'),
    onBack: () => console.log('Back clicked'),
  },
};

/**
 * Validation error
 */
export const ValidationError: Story = {
  args: {
    errorMessage: 'Validation failed: Please provide either taste preferences or select at least one tag to generate a profile.',
    onRetry: () => console.log('Retry clicked'),
    onBack: () => console.log('Back clicked'),
  },
};
