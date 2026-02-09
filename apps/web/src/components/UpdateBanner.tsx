import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { ArrowClockwise, DownloadSimple, X, CheckCircle, Warning } from '@phosphor-icons/react'
import { useState, useEffect, useRef } from 'react'

interface UpdateBannerProps {
  updateAvailable: boolean
  isUpdating: boolean
  updateError: string | null
  onUpdate: () => void
  onDismiss: () => void
}

// Maximum expected update duration (3 minutes)
const MAX_UPDATE_DURATION = 180000
// Update progress bar every 500ms for smooth animation
const PROGRESS_UPDATE_INTERVAL = 500

export function UpdateBanner({
  updateAvailable,
  isUpdating,
  updateError,
  onUpdate,
  onDismiss,
}: UpdateBannerProps) {
  const [progress, setProgress] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Clear timers helper function
  const clearTimers = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  // Clean up timers on unmount or when isUpdating changes
  useEffect(() => {
    if (!isUpdating) {
      // Reset progress and clear timers when update finishes
      setProgress(0)
      clearTimers()
    }
    
    // Cleanup on unmount
    return () => {
      clearTimers()
    }
  }, [isUpdating])

  // Simulate progress during update
  const handleUpdate = () => {
    // Clear any existing timers before starting new ones
    clearTimers()
    
    // Reset progress for new update
    setProgress(0)
    
    onUpdate()
    
    // Animate progress bar
    const startTime = Date.now()
    
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      const percentage = Math.min((elapsed / MAX_UPDATE_DURATION) * 100, 95)
      setProgress(percentage)
    }, PROGRESS_UPDATE_INTERVAL)

    // Clear interval when update completes
    timeoutRef.current = setTimeout(() => {
      clearTimers()
    }, MAX_UPDATE_DURATION)
  }

  if (!updateAvailable && !isUpdating && !updateError) {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -100 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        className="fixed top-0 left-0 right-0 z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
      >
        <div className="max-w-md mx-auto">
          {isUpdating ? (
            <Alert className="!bg-card/95 backdrop-blur-md border-primary/30 shadow-xl ring-1 ring-white/10">
              <ArrowClockwise size={20} className="animate-spin" />
              <AlertDescription>
                <div className="space-y-3">
                  <div className="font-semibold">Updating MeticAI...</div>
                  <div className="text-xs text-muted-foreground">
                    Please wait while we update the system. This may take a few minutes.
                    The page will automatically refresh when complete.
                  </div>
                  <Progress value={progress} className="h-2" />
                  <div className="text-xs text-center text-muted-foreground">
                    {progress < 30 && 'Starting update...'}
                    {progress >= 30 && progress < 60 && 'Pulling latest updates...'}
                    {progress >= 60 && progress < 80 && 'Rebuilding containers...'}
                    {progress >= 80 && 'Restarting services...'}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          ) : updateError ? (
            <Alert variant="destructive" className="!bg-card/95 backdrop-blur-md border-destructive/50 shadow-xl ring-1 ring-destructive/20">
              <Warning size={20} weight="fill" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-semibold">Update Failed</div>
                  <div className="text-sm">{updateError}</div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleUpdate}
                      size="sm"
                      variant="outline"
                      className="h-8"
                    >
                      <ArrowClockwise size={16} className="mr-1" />
                      Retry
                    </Button>
                    <Button
                      onClick={onDismiss}
                      size="sm"
                      variant="ghost"
                      className="h-8"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          ) : updateAvailable ? (
            <Alert className="!bg-card/95 backdrop-blur-md border-success/30 shadow-xl ring-1 ring-success/20">
              <DownloadSimple size={20} weight="fill" className="text-success" />
              <AlertDescription>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-semibold text-success">Update Available</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      A new version of MeticAI is ready to install
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleUpdate}
                      size="sm"
                      className="h-9 bg-success text-black hover:bg-success/90"
                    >
                      <CheckCircle size={16} className="mr-1" weight="fill" />
                      Update Now
                    </Button>
                    <Button
                      onClick={onDismiss}
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 p-0"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
