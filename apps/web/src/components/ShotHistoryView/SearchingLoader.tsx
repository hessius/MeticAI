import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Progress } from '@/components/ui/progress'

const SHOT_QUOTES = [
  { quote: "You Miss 100% of the Shots You Don't Take", author: "Wayne Gretzky", meta: "— Michael Scott" },
  { quote: "I'm not throwing away my shot", author: "Lin-Manuel Miranda" },
  { quote: "Take your best shot", author: "Common saying" },
  { quote: "Give it your best shot", author: "English proverb" },
  { quote: "One shot, one opportunity", author: "Eminem" },
  { quote: "A shot in the dark", author: "Ozzy Osbourne" },
  { quote: "Shoot for the moon", author: "Les Brown" },
]

export function SearchingLoader({ estimatedSeconds = 60 }: { estimatedSeconds?: number }) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState(0)
  const [showQuote, setShowQuote] = useState(false)
  const [currentQuote] = useState(() => SHOT_QUOTES[Math.floor(Math.random() * SHOT_QUOTES.length)])
  const [startTime] = useState(() => Date.now())
  
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000
      const newProgress = Math.min(95, (1 - Math.exp(-elapsed / (estimatedSeconds / 3))) * 100)
      setProgress(newProgress)
    }, 100)
    
    return () => clearInterval(interval)
  }, [estimatedSeconds, startTime])

  useEffect(() => {
    const timer = setTimeout(() => setShowQuote(true), 3000)
    return () => clearTimeout(timer)
  }, [])
  
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="w-full max-w-xs space-y-2">
        <Progress value={progress} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t('shotHistory.searching')}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
      <AnimatePresence mode="wait">
        {!showQuote ? (
          <motion.p
            key="scanning"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-xs text-muted-foreground/60 text-center max-w-[200px]"
          >
            {t('shotHistory.scanningLogs')}
          </motion.p>
        ) : (
          <motion.div
            key="quote"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-[280px] space-y-1"
          >
            <p className="text-xs text-muted-foreground/80 italic">
              "{currentQuote.quote}"
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              — {currentQuote.author}{currentQuote.meta ? ` ${currentQuote.meta}` : ''}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
