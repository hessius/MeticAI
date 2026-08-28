import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

/* Specs that require infrastructure CI does not provide.
   - verify-tasks.spec.ts needs a running Docker container (port 3550); it is
     executed separately in the docker-build job, which sets BASE_URL.
   - fullapp-sweep.spec.ts is a local live-verify tool: it needs the unified
     Bun server (port 35590) AND a real machine on the LAN, so it can never
     run on a hosted CI runner. */
const ciTestIgnore: string[] = []
if (isCI) {
  ciTestIgnore.push('**/fullapp-sweep.spec.ts')
  if (!process.env.BASE_URL) ciTestIgnore.push('**/verify-tasks.spec.ts')
}

// In CI, only run Chromium to keep E2E fast. Locally, test all browsers.
const projects = isCI
  ? [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ]
  : [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'firefox',
        use: { ...devices['Desktop Firefox'] },
      },
      {
        name: 'webkit',
        use: { ...devices['Desktop Safari'] },
      },
      {
        name: 'Mobile Chrome',
        use: { ...devices['Pixel 5'] },
      },
    ]

export default defineConfig({
  testDir: './e2e',
  /* verify-tasks.spec.ts needs a running Docker container (port 3550),
     so it's excluded from normal CI e2e runs and executed separately
     in the docker-build job (which sets BASE_URL). fullapp-sweep.spec.ts
     is a local-only live-verify tool (needs the unified Bun server + a real
     machine), so it is always excluded in CI. */
  testIgnore: ciTestIgnore,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? 'github' : 'html',
  timeout: isCI ? 30_000 : 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },

  projects,

  /* Start the Vite dev server for tests that run against the SPA.
     Skip when BASE_URL is set (integration tests run against Docker). */
  ...(!process.env.BASE_URL && {
    webServer: {
      command: 'bunx vite --host --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  }),
})
