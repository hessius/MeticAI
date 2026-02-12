# Storybook Documentation

This project uses Storybook for component documentation and development.

## Getting Started

### Install Dependencies
```bash
bun install
```

### Run Storybook
```bash
bun run storybook
```

Storybook will start at http://localhost:6006/

### Build Storybook
```bash
bun run build-storybook
```

This builds a static Storybook to the `storybook-static` directory.

## Configuration

### Main Configuration (.storybook/main.ts)
- Configured for React + Vite + TypeScript
- Path alias support (@/* → src/*)
- Includes addons:
  - **@storybook/addon-docs**: Auto-generated documentation
  - **@storybook/addon-a11y**: Accessibility testing
  - **@chromatic-com/storybook**: Visual testing integration

### Preview Configuration (.storybook/preview.tsx)
- Tailwind CSS integration
- Dark theme by default
- i18n support with language selector
- Responsive decorators

## Component Stories

### Available Stories

#### Components
- **LanguageSelector**: Language switching dropdown
  - Default, Outline, IconOnly, DefaultVariant variants
  - Props: `variant`, `showLabel`

- **SkipNavigation**: Keyboard accessibility navigation
  - Default, CustomLinks, SingleLink variants
  - Props: `links`

#### Views
- **StartView**: Initial app view with greeting
  - NoProfiles, WithProfiles, SingleProfile, Loading variants
  - Props: `profileCount`, action handlers

- **FormView**: Profile creation form
  - Empty, WithPreferences, WithTags, WithImage, WithError, FirstTime variants
  - Props: `imagePreview`, `userPrefs`, `selectedTags`, etc.

- **LoadingView**: Loading state with messages
  - Start, Middle, NearEnd, AlmostThere variants
  - Props: `currentMessage`

- **ErrorView**: Error display with retry
  - SimpleError, NetworkError, APIError, LongError, ValidationError variants
  - Props: `errorMessage`, `onRetry`, `onBack`

- **ResultsView**: Generated profile results
  - Success, TextOnly, Capturing, SimpleProfile variants
  - Props: `apiResponse`, `currentProfileJson`, `createdProfileId`, etc.

## Writing Stories

### Basic Story Structure
```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { YourComponent } from './YourComponent';

const meta = {
  title: 'Category/YourComponent',
  component: YourComponent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Description of your component',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    propName: {
      control: 'text',
      description: 'Description of the prop',
    },
  },
} satisfies Meta<typeof YourComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    propName: 'value',
  },
};
```

### Story Decorators
Use decorators to wrap stories with context providers:

```tsx
decorators: [
  (Story) => (
    <div style={{ width: '400px' }}>
      <Story />
    </div>
  ),
],
```

### Accessibility Testing
The a11y addon automatically checks stories for accessibility issues:
- Tab through interactive elements
- Check color contrast
- Verify ARIA labels
- Test keyboard navigation

View accessibility results in the "Accessibility" panel in Storybook.

## Best Practices

1. **Document Props**: Use `argTypes` to describe all component props
2. **Multiple Variants**: Create stories for different component states
3. **Meaningful Names**: Use descriptive names for stories
4. **Add Descriptions**: Include JSDoc comments explaining features
5. **Test Interactions**: Use the Controls addon to test prop changes
6. **Check Accessibility**: Review a11y panel for each story

## Troubleshooting

### Path Alias Issues
If imports using `@/*` don't resolve, check that:
- `.storybook/main.ts` includes the `viteFinal` configuration
- `tsconfig.json` has the correct path mapping

### Styling Issues
If Tailwind classes don't work:
- Verify `src/main.css` is imported in `.storybook/preview.tsx`
- Check that dark mode decorator is applied

### i18n Issues
If translations don't work:
- Ensure i18n is imported in `.storybook/preview.tsx`
- Wrap stories requiring i18n with `I18nextProvider`

## Additional Resources

- [Storybook Documentation](https://storybook.js.org/docs)
- [Vite Documentation](https://vitejs.dev/)
- [Accessibility Addon](https://storybook.js.org/addons/@storybook/addon-a11y)
