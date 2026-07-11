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
import { installDirectModeInterceptor } from '@/services/interceptor/DirectModeInterceptor'
import { installCoreInterceptor } from '@/services/interceptor/coreInterceptor'
import { isCoreInterceptorEnabled } from '@/services/interceptor/coreInterceptorFlag'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// In direct mode (PWA on machine), intercept MeticAI proxy API calls and either
// translate them to Meticulous-native /api/v1/ endpoints or return 501 for
// unhandled routes. Skip in demo mode — DemoAdapter handles everything.
if (isDirectMode() && !isDemoMode()) {
  // Capture the true, unpatched fetch before the interceptor patches it, so the
  // core Platform can reach the machine without re-entering the interceptors.
  const originalFetch = window.fetch.bind(window)
  installDirectModeInterceptor()
  // Experimental (off by default): layer the shared @metic/core handler on top,
  // delegating any route it doesn't own back to DirectModeInterceptor.
  if (isCoreInterceptorEnabled()) {
    installCoreInterceptor({ originalFetch, fallbackFetch: window.fetch.bind(window) })
  }
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
