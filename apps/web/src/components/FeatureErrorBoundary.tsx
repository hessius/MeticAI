import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

interface FeatureErrorFallbackProps {
  error: Error
  resetErrorBoundary: () => void
  feature: string
}

function FeatureErrorFallback({ error, resetErrorBoundary, feature }: FeatureErrorFallbackProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 my-2">
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">
            {t('errorBoundary.featureError', { feature })}
          </p>
          <pre className="mt-1 text-xs text-muted-foreground truncate">
            {error?.message}
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={resetErrorBoundary}
            className="mt-3"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
            {t('errorBoundary.tryAgain')}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface FeatureErrorBoundaryProps {
  feature: string
  children: ReactNode
}

export function FeatureErrorBoundary({ feature, children }: FeatureErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={(props) => <FeatureErrorFallback {...props} feature={feature} />}
      onError={(error) => {
        console.error(`[FeatureErrorBoundary] Error in "${feature}":`, error)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
