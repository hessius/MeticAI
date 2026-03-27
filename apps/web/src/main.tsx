import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { isDirectMode } from '@/lib/machineMode'
import { installDirectModeInterceptor } from '@/services/interceptor/DirectModeInterceptor'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"
// Platform themes must load AFTER Tailwind (index.css) to override utilities
import "./styles/ios-theme.css"
import "./styles/material-theme.css"

// In direct mode (PWA on machine), intercept MeticAI proxy API calls and either
// translate them to Meticulous-native /api/v1/ endpoints or return empty responses.
// The machine only serves /api/v1/... (via espresso-api/axios). All other /api/
// paths are MeticAI-specific and don't exist on the machine.
if (isDirectMode()) {
  installDirectModeInterceptor()
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
