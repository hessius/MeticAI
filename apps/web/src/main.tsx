import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { isDirectMode } from '@/lib/machineMode'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// In direct mode (PWA on machine), intercept MeticAI proxy API calls that
// don't exist on the Meticulous backend. The machine only serves /api/v1/...
// endpoints (via espresso-api/axios). All other /api/ paths are MeticAI-specific.
if (isDirectMode()) {
  const _fetch = window.fetch
  window.fetch = function directModeFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request ? input.url : ''

    // Allow Meticulous machine API (/api/v1/...) and external URLs
    // Block MeticAI proxy endpoints (/api/settings, /api/machine/*, /api/history, etc.)
    if (url.match(/\/api\/(?!v\d)/)) {
      return Promise.resolve(new Response('{}', { status: 404, statusText: 'Not available in direct mode' }))
    }

    return _fetch(input, init)
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <MachineServiceProvider>
        <AIServiceProvider>
          <App />
        </AIServiceProvider>
      </MachineServiceProvider>
    </ThemeProvider>
   </ErrorBoundary>
)
