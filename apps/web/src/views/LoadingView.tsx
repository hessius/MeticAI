import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Sparkle } from '@phosphor-icons/react'
import type { ProgressEvent } from '@/hooks/useGenerationProgress'
import { PHASE_ORDER, phaseProgress } from '@/hooks/useGenerationProgress'

// Fallback messages in case i18n is not loaded
const FALLBACK_LOADING_MESSAGES = [
  "Analyzing coffee beans...",
  "Detecting roast profile...",
  "Watching a Lance video...",
  "Identifying flavor notes...",
  "Checking for Kickstarter updates...",
  "Feeling some Aramse ASMR...",
  "Calculating extraction parameters...",
  "Perusing a Daddy Hoff book...",
  "Optimizing grind settings...",
  "Logging into Discord...",
  "Checking James Hoffmann's notes...",
  "Fine-tuning flow curve...",
  "Consulting the Sprometheus archives...",
  "Generating espresso profile...",
  "Channeling my inner Morgan Drinks Coffee...",
  "Aligning the puck particles...",
  "Debating WDT technique...",
  "Calibrating the refractometer...",
  "Asking the beans how they feel...",
  "Adjusting for altitude and humidity...",
  "Running through the Barista Hustle curriculum...",
  "Polishing the portafilter...",
  "Measuring TDS for the nth time...",
  "Contemplating the meaning of crema...",
  "Dialing in the perfect ratio...",
  "Channeling is bad, unless it's channeling vibes...",
  "Watching one more Weiss Distribution video...",
  "Preheating the group head of knowledge...",
  "Applying 6 bar of computational pressure...",
  "Tasting notes: patience, with hints of anticipation...",
  "Almost there..."
]

export const LOADING_MESSAGE_COUNT = FALLBACK_LOADING_MESSAGES.length

// Timing for cycling between progress and funny messages
const SHOW_PROGRESS_MS = 5000
const SHOW_FUNNY_MS = 4000

interface LoadingViewProps {
  currentMessage: number
  /** Real-time progress event from SSE, if available. */
  progress?: ProgressEvent | null
}

/** Phase segment labels for the segmented progress bar (i18n keys). */
const PHASE_LABEL_KEYS: Record<string, string> = {
  analyzing: 'loading.phases.analyze',
  generating: 'loading.phases.generate',
  validating: 'loading.phases.validate',
  uploading: 'loading.phases.upload',
  complete: 'loading.phases.done',
}

export function LoadingView({ currentMessage, progress }: LoadingViewProps) {
  const { t } = useTranslation()
  
  const messages = t('loading.messages', { returnObjects: true }) as string[]
  const loadingMessages = Array.isArray(messages) ? messages : FALLBACK_LOADING_MESSAGES
  const safeIndex = Math.min(currentMessage, loadingMessages.length - 1)

  // When we have real progress, show the phase message instead of random quips
  const hasProgress = progress && progress.phase !== 'queued'
  
  // Track whether to show the progress message or a funny string
  const [showFunny, setShowFunny] = useState(false)
  const [funnyIndex, setFunnyIndex] = useState(0)
  const lastPhaseRef = useRef<string | null>(null)
  
  // Pick a random funny message when switching to funny mode
  const pickRandomFunny = useCallback(() => {
    setFunnyIndex(Math.floor(Math.random() * loadingMessages.length))
  }, [loadingMessages.length])
  
  // When progress phase changes, reset to show progress message
  useEffect(() => {
    if (hasProgress && progress.phase !== lastPhaseRef.current) {
      lastPhaseRef.current = progress.phase
      setShowFunny(false)
    }
  }, [hasProgress, progress?.phase])
  
  // Cycle between showing progress message and funny strings
  useEffect(() => {
    if (!hasProgress) return
    
    // After SHOW_PROGRESS_MS, switch to funny; after SHOW_FUNNY_MS, switch back
    const interval = showFunny ? SHOW_FUNNY_MS : SHOW_PROGRESS_MS
    
    const timer = setTimeout(() => {
      if (showFunny) {
        // Was showing funny, switch back to progress
        setShowFunny(false)
      } else {
        // Was showing progress, switch to a random funny
        pickRandomFunny()
        setShowFunny(true)
      }
    }, interval)
    
    return () => clearTimeout(timer)
  }, [hasProgress, showFunny, pickRandomFunny])
  
  // Determine what message to display
  const displayMessage = useMemo(() => {
    if (!hasProgress) {
      return loadingMessages[safeIndex]
    }
    if (showFunny) {
      return loadingMessages[funnyIndex]
    }
    return progress.message
  }, [hasProgress, showFunny, progress?.message, loadingMessages, safeIndex, funnyIndex])
  
  const messageKey = useMemo(() => {
    if (!hasProgress) return `msg-${currentMessage}`
    if (showFunny) return `funny-${funnyIndex}`
    return `sse-${progress.phase}-${progress.attempt}`
  }, [hasProgress, showFunny, currentMessage, funnyIndex, progress?.phase, progress?.attempt])

  // Calculate progress fraction
  const fraction = hasProgress ? phaseProgress(progress.phase) : 0
  // Determine which segments are completed
  const currentPhaseIdx = hasProgress
    ? (progress.phase === 'retrying'
      ? PHASE_ORDER.indexOf('validating')
      : PHASE_ORDER.indexOf(progress.phase))
    : -1

  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="p-10">
        <div className="flex flex-col items-center gap-8">
          <motion.div
            animate={{ 
              rotate: 360,
            }}
            transition={{ 
              rotate: { duration: 3, repeat: Infinity, ease: "linear" },
            }}
            className="rounded-full p-5 bg-primary/10 border border-primary/20 shadow-[var(--gold-glow)]"
          >
            <Sparkle size={40} className="text-primary" weight="fill" />
          </motion.div>

          <div className="text-center space-y-4 w-full">
            <AnimatePresence mode="wait">
              <motion.p
                key={messageKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="text-lg font-semibold text-primary min-h-[3.5rem]"
              >
                {displayMessage}
              </motion.p>
            </AnimatePresence>

            {/* Show elapsed time when progress is available */}
            {hasProgress && progress.elapsed > 0 ? (
              <p className="text-sm text-muted-foreground">
                {Math.round(progress.elapsed)}s elapsed
                {progress.phase === 'retrying' && (
                  <span className="ml-1">
                    — retry {progress.attempt}/{progress.max_attempts - 1}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('loading.pleaseWait')}
              </p>
            )}
          </div>

          {/* Segmented progress bar when SSE is active, regular bar otherwise */}
          {hasProgress ? (
            <div className="w-full space-y-2">
              <div className="flex w-full gap-1">
                {PHASE_ORDER.map((phase, idx) => {
                  const isComplete = idx < currentPhaseIdx
                  const isCurrent = idx === currentPhaseIdx
                  const isFuture = idx > currentPhaseIdx

                  return (
                    <div key={phase} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full h-1.5 rounded-full overflow-hidden bg-[rgba(0,0,0,0.3)]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{
                            background: isFuture
                              ? 'transparent'
                              : isComplete
                                ? 'linear-gradient(135deg, #FFC107, #FF8F00)'
                                : 'linear-gradient(135deg, #FFC107 0%, #FF8F00 50%, #FF6F00 100%)',
                          }}
                          initial={{ width: "0%" }}
                          animate={{
                            width: isComplete
                              ? "100%"
                              : isCurrent
                                ? "60%"
                                : "0%"
                          }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                      <span className={`text-[10px] ${
                        isComplete || isCurrent
                          ? 'text-primary/80'
                          : 'text-muted-foreground/50'
                      }`}>
                        {t(PHASE_LABEL_KEYS[phase] || phase)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="w-full bg-[rgba(0,0,0,0.3)] rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(135deg, #FFC107 0%, #FF8F00 50%, #FF6F00 100%)' }}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.min(fraction * 100, 95)}%` }}
                transition={{ duration: 420, ease: "linear" }}
              />
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
