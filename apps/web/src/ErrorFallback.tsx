import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";

import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

interface ErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: (...args: unknown[]) => void;
}

export const ErrorFallback = ({ error, resetErrorBoundary }: ErrorFallbackProps) => {
  const err = error instanceof Error ? error : new Error(String(error))
  // Log error details to console for debugging
  console.error('ErrorFallback caught error:', err);
  console.error('Error stack:', err.stack);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>Application Error</AlertTitle>
          <AlertDescription>
            Something unexpected happened while running the application. The error details are shown below.
          </AlertDescription>
        </Alert>
        
        <div className="bg-card border rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-sm text-muted-foreground mb-2">Error Message:</h3>
          <pre className="text-xs text-destructive bg-muted/50 p-3 rounded border overflow-auto max-h-24 whitespace-pre-wrap">
            {err.message || String(err)}
          </pre>
        </div>

        {err.stack && (
          <div className="bg-card border rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-sm text-muted-foreground mb-2">Stack Trace:</h3>
            <pre className="text-[10px] text-muted-foreground bg-muted/50 p-3 rounded border overflow-auto max-h-48 whitespace-pre-wrap">
              {err.stack}
            </pre>
          </div>
        )}
        
        <Button 
          onClick={resetErrorBoundary} 
          className="w-full"
          variant="outline"
        >
          <RefreshCwIcon />
          Try Again
        </Button>
      </div>
    </div>
  );
}
