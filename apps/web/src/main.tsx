import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { ShotDataServiceProvider } from '@/services/shots'
import { CatalogueServiceProvider } from '@/services/catalogue'
import { isDirectMode } from '@/lib/machineMode'
import { installDirectModeInterceptor } from '@/services/interceptor/DirectModeInterceptor'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// In direct mode (PWA on machine), intercept MeticAI proxy API calls and either
// translate them to Meticulous-native /api/v1/ endpoints or return 501 for
// unhandled routes. The machine only serves /api/v1/... (via espresso-api/axios).
// All other /api/ paths are MeticAI-specific and don't exist on the machine.
if (isDirectMode()) {
  installDirectModeInterceptor()
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
