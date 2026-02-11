import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Sparkle } from '@phosphor-icons/react'

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
  "Almost there..."
]

export const LOADING_MESSAGE_COUNT = FALLBACK_LOADING_MESSAGES.length

interface LoadingViewProps {
  currentMessage: number
}

export function LoadingView({ currentMessage }: LoadingViewProps) {
  const { t } = useTranslation()
  
  const messages = t('loading.messages', { returnObjects: true }) as string[]
  const loadingMessages = Array.isArray(messages) ? messages : FALLBACK_LOADING_MESSAGES
  const safeIndex = Math.min(currentMessage, loadingMessages.length - 1)

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
                key={currentMessage}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="text-lg font-semibold text-primary min-h-[3.5rem]"
              >
                {loadingMessages[safeIndex]}
              </motion.p>
            </AnimatePresence>
            <p className="text-sm text-muted-foreground">
              {t('loading.pleaseWait')}
            </p>
          </div>

          <div className="w-full bg-[rgba(0,0,0,0.3)] rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-[var(--gold-gradient)] rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 75, ease: "linear" }}
            />
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
