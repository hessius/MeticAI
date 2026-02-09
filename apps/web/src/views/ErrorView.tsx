import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Warning, ArrowClockwise } from '@phosphor-icons/react'

interface ErrorViewProps {
  errorMessage: string
  onRetry: () => void
  onBack: () => void
}

export function ErrorView({ errorMessage, onRetry, onBack }: ErrorViewProps) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-destructive/15">
            <Warning size={24} weight="fill" className="text-destructive" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Something went wrong</h2>
        </div>

        <Alert variant="destructive" className="border-destructive/30 bg-destructive/8 rounded-xl overflow-hidden">
          <AlertDescription className="text-sm break-words whitespace-pre-wrap max-h-48 overflow-y-auto">
            {errorMessage}
          </AlertDescription>
        </Alert>

        <div className="flex gap-3">
          <Button
            onClick={onRetry}
            className="flex-1 h-12 text-sm font-semibold"
          >
            <ArrowClockwise size={18} weight="bold" className="mr-2" />
            Retry
          </Button>
          <Button
            onClick={onBack}
            variant="outline"
            className="flex-1 h-12 text-sm font-semibold"
          >
            Back to Form
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}
