# Testing Guide for MeticAI-web

This document provides comprehensive information about the testing infrastructure and how to run tests for the MeticAI-web application.

## Overview

The MeticAI-web application has four layers of testing:

1. **Unit Tests** - Test individual functions and components in isolation
2. **Integration Tests** - Test how components work together
3. **End-to-End (E2E) Tests** - Test complete user flows in a real browser
4. **Accessibility Tests** - Test WCAG 2.1 AA compliance and keyboard navigation

## Testing Stack

- **Vitest** - Fast unit test framework with native ESM support
- **React Testing Library** - Testing utilities for React components
- **@testing-library/user-event** - Simulates user interactions
- **Playwright** - End-to-end testing framework
- **@axe-core/playwright** - Automated accessibility testing for WCAG compliance
- **jsdom** - DOM implementation for Node.js (used by Vitest)

## Quick Start

### Running All Tests

```bash
# Run all unit and integration tests
npm test

# Run tests in watch mode (recommended during development)
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with coverage report
npm run test:coverage

# Run tests with UI
npm run test:ui
```

### Running E2E Tests

```bash
# Run E2E tests
npm run e2e

# Run E2E tests with UI mode
npm run e2e:ui

# Run E2E tests in headed mode (see the browser)
npm run e2e:headed

# Run accessibility tests
npm run e2e -- e2e/accessibility.spec.ts

# Run specific accessibility test suite
npm run e2e -- e2e/accessibility.spec.ts -g "Keyboard Navigation"
```

### Running Accessibility Tests

```bash
# Run all accessibility tests
npm run e2e -- e2e/accessibility.spec.ts

# Run specific test category
npm run e2e -- e2e/accessibility.spec.ts -g "Color Contrast"
npm run e2e -- e2e/accessibility.spec.ts -g "ARIA Attributes"
npm run e2e -- e2e/accessibility.spec.ts -g "Multi-language"

# Run with UI mode (interactive)
npm run e2e:ui -- e2e/accessibility.spec.ts

# Run on specific browser
npm run e2e -- e2e/accessibility.spec.ts --project=chromium
```

For detailed accessibility testing information, see [ACCESSIBILITY_TESTING.md](./ACCESSIBILITY_TESTING.md).

## Test Structure

### Unit Tests

Unit tests are located next to the files they test with a `.test.ts` or `.test.tsx` extension.

```
src/
├── lib/
│   ├── utils.ts
│   └── utils.test.ts          # Unit tests for utils
├── hooks/
│   ├── use-mobile.ts
│   └── use-mobile.test.ts     # Unit tests for custom hook
├── App.tsx
├── App.test.tsx               # Integration tests for App component
├── ErrorFallback.tsx
└── ErrorFallback.test.tsx     # Component tests
```

### E2E Tests

End-to-end tests are in the `e2e/` directory:

```
e2e/
├── app.spec.ts                # E2E tests for main user flows
├── accessibility.spec.ts      # Accessibility and WCAG compliance tests
└── qr-code.spec.ts            # QR code functionality tests
```

## Test Coverage

### What's Tested

#### Unit Tests (`src/lib/utils.test.ts`)
- `cn()` utility function for class name merging
- Conditional class names
- Tailwind CSS class conflict resolution
- Array and object syntax support

#### Custom Hook Tests (`src/hooks/use-mobile.test.ts`)
- Mobile viewport detection
- Desktop viewport detection
- Breakpoint behavior (768px)
- Window resize handling
- Event listener cleanup

#### Component Tests (`src/ErrorFallback.test.tsx`)
- Error message display
- Error details rendering
- Reset error boundary functionality
- Accessible structure

#### Integration Tests (`src/App.test.tsx`)
- **Form View**
  - Application title and branding
  - File upload functionality
  - Taste preferences textarea
  - Preset tag selection and deselection
  - Submit button state management
  - Form validation

- **Loading State**
  - Loading spinner and messages
  - Progress indicator

- **Results State**
  - Success message display
  - API response rendering
  - Reset functionality

- **Error State**
  - Error message display
  - Retry functionality
  - Error recovery

- **API Integration**
  - FormData creation
  - Request payload structure
  - Combined preferences (tags + text)

#### E2E Tests (`e2e/app.spec.ts`)
- Homepage loading
- Form element visibility
- User interactions (text input, tag selection)
- Form validation
- Responsive design (desktop and mobile)
- Complete user flows

#### Accessibility Tests (`e2e/accessibility.spec.ts`)
- **Automated WCAG Scans** - axe-core automated accessibility testing
- **Keyboard Navigation** - Tab navigation, focus management, keyboard activation
- **ARIA Attributes** - Proper roles, labels, and semantic HTML
- **Skip Navigation** - Skip links for keyboard users
- **Focus Management** - Focus indicators, modal focus traps
- **Multi-language** - Accessibility maintained across all 6 languages
- **Color Contrast** - WCAG AA contrast ratios (4.5:1)
- **Form Accessibility** - Label associations, validation feedback
- **Screen Reader Compatibility** - Landmarks, alt text, live regions
- **Mobile Accessibility** - Touch targets, viewport scaling

See [ACCESSIBILITY_TESTING.md](./ACCESSIBILITY_TESTING.md) for comprehensive details.

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from './myFunction'

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input')
    expect(result).toBe('expected output')
  })
})
```

### Component Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MyComponent from './MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should handle user interaction', async () => {
    const user = userEvent.setup()
    render(<MyComponent />)
    
    const button = screen.getByRole('button')
    await user.click(button)
    
    expect(screen.getByText('Clicked')).toBeInTheDocument()
  })
})
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test'

test('should complete user flow', async ({ page }) => {
  await page.goto('/')
  
  await page.getByPlaceholder('Enter text').fill('Test input')
  await page.getByRole('button', { name: 'Submit' }).click()
  
  await expect(page.getByText('Success')).toBeVisible()
})
```

### Accessibility Test Example

```typescript
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('should pass WCAG AA accessibility scan', async ({ page }) => {
  await page.goto('/')
  
  // Run automated accessibility scan
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  
  expect(accessibilityScanResults.violations).toEqual([])
})

test('should navigate with keyboard only', async ({ page }) => {
  await page.goto('/')
  
  // Tab to button and activate with Enter
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  
  // Verify navigation occurred
  await expect(page.getByText('Expected Content')).toBeVisible()
})
```

## Configuration

### Vitest Configuration (`vitest.config.ts`)

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
```

### Playwright Configuration (`playwright.config.ts`)

```typescript
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],
})
```

## Best Practices

### 1. Test Behavior, Not Implementation
```typescript
// Good - tests user-facing behavior
expect(screen.getByRole('button')).toBeEnabled()

// Bad - tests implementation details
expect(component.state.isEnabled).toBe(true)
```

### 2. Use Accessible Queries
```typescript
// Preferred queries (in order)
screen.getByRole('button', { name: /submit/i })
screen.getByLabelText('Email')
screen.getByPlaceholderText('Enter email')
screen.getByText('Welcome')

// Avoid
screen.getByTestId('submit-button')  // Only as last resort
```

### 3. Wait for Asynchronous Updates
```typescript
// Use waitFor for async operations
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument()
})

// Or findBy queries (which wait automatically)
const element = await screen.findByText('Loaded')
```

### 4. Clean Up After Tests
Tests automatically clean up using the setup file, but be mindful of:
- Mocked functions (restore them)
- Timers (use `vi.useFakeTimers()` and `vi.useRealTimers()`)
- Global state

## CI/CD Integration

Tests run automatically in CI/CD pipelines. The test scripts are configured to:
- Run in CI mode when `process.env.CI` is set
- Generate coverage reports
- Fail the build if tests fail

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:run
      - run: npm run e2e
```

## Debugging Tests

### Vitest UI
```bash
npm run test:ui
```
Opens a browser interface for exploring and debugging tests.

### Playwright UI
```bash
npm run e2e:ui
```
Opens Playwright's UI mode for step-by-step debugging.

### VS Code Debugging

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test"],
  "console": "integratedTerminal"
}
```

## Coverage Reports

After running `npm run test:coverage`, view the coverage report:

```bash
# Open HTML coverage report
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

Coverage thresholds are not enforced but aim for:
- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

## Troubleshooting

### Common Issues

#### "Cannot find module" errors
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Tests timeout
```typescript
// Increase timeout for specific tests
test('slow test', async () => {
  // test code
}, 10000) // 10 second timeout
```

#### Flaky E2E tests
```typescript
// Use waitFor with explicit conditions
await page.waitForSelector('[data-testid="result"]')
await expect(page.getByText('Success')).toBeVisible({ timeout: 10000 })
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [axe-core Accessibility Rules](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Playwright Accessibility Testing](https://playwright.dev/docs/accessibility-testing)

## Contributing

When adding new features:
1. Write tests first (TDD approach recommended)
2. Ensure all tests pass before committing
3. Maintain or improve coverage
4. Update this documentation if adding new test patterns
