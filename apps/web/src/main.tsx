import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { ShotDataServiceProvider } from '@/services/shots'
import { CatalogueServiceProvider } from '@/services/catalogue'
import { isDirectMode, isDemoMode } from '@/lib/machineMode'
import { installCoreInterceptor } from '@/services/interceptor/coreInterceptor'
import { startDiagnostics } from '@/lib/diagnostics'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// Start passive on-device diagnostics as early as possible so we capture
// main-thread stalls (ANR/freeze) and errors from the very first frame. This
// is our only window into field freezes on devices we cannot attach a debugger
// to. See src/lib/diagnostics.ts.
startDiagnostics()

// In direct mode (native/PWA on the machine), route MeticAI proxy API calls
// through the shared @metic/core handler (the same handler the Bun server uses
// in proxy mode). Machine-native /api/v1/ calls and external URLs pass straight
// through to the original fetch. Skip in demo mode — DemoAdapter handles it all.
if (isDirectMode() && !isDemoMode()) {
  // Capture the true, unpatched fetch before we patch it, so the core Platform
  // can reach the machine without re-entering the interceptor.
  const originalFetch = window.fetch.bind(window)
  installCoreInterceptor({ originalFetch })
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <MachineServiceProvider>
        <AIServiceProvider>
          <ShotDataServiceProvider>
            <CatalogueServiceProvider>
              <App />
            </CatalogueServiceProvider>
          </ShotDataServiceProvider>
        </AIServiceProvider>
      </MachineServiceProvider>
    </ThemeProvider>
   </ErrorBoundary>
)
