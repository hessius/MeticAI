import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ArrowClockwise, CheckCircle } from '@phosphor-icons/react'

interface TasteFeedback {
  x: number
  y: number
  descriptors: string[]
  notes?: string
}

interface Iteration {
  iteration_number: number
  taste: TasteFeedback
  recommendations: string[]
  timestamp: string
}

interface DialInSession {
  id: string
  coffee: {
    roast_level: string
    origin?: string
    process?: string
    roast_date?: string
  }
  profile_name?: string
  iterations: Iteration[]
  status: string
  created_at: string
  updated_at: string
}

interface DialInHistoryStepProps {
  session: DialInSession
  onTryAgain: () => void
  onComplete: () => void
}

function describeBalance(x: number, t: (key: string) => string): string {
  if (Math.abs(x) < 0.15) return t('dialIn.history.balanced')
  if (x < 0) return t('dialIn.history.sour')
  return t('dialIn.history.bitter')
}

function describeBody(y: number, t: (key: string) => string): string {
  if (Math.abs(y) < 0.15) return t('dialIn.history.medium')
  if (y < 0) return t('dialIn.history.weak')
  return t('dialIn.history.strong')
}

export function DialInHistoryStep({ session, onTryAgain, onComplete }: DialInHistoryStepProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h3 className="font-semibold">{t('dialIn.history.title')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('dialIn.history.iterations', { count: session.iterations.length })}
        </p>
      </div>

      <div className="space-y-3">
        {session.iterations.map((it) => (
          <div
            key={it.iteration_number}
            className="p-3 rounded-lg border space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {t('dialIn.history.iterationLabel', { number: it.iteration_number })}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(it.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs bg-accent px-2 py-0.5 rounded">
                {describeBalance(it.taste.x, t)} · {describeBody(it.taste.y, t)}
              </span>
              {it.taste.descriptors.map((d) => (
                <span key={d} className="text-xs bg-accent px-2 py-0.5 rounded">
                  {d}
                </span>
              ))}
            </div>
            {it.recommendations.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {it.recommendations.join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-2">
        <Button
          variant="dark-brew"
          className="w-full h-12"
          onClick={onTryAgain}
        >
          <ArrowClockwise size={18} className="mr-2" />
          {t('dialIn.recommend.tryAgain')}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={onComplete}
        >
          <CheckCircle size={18} className="mr-2" />
          {t('dialIn.recommend.done')}
        </Button>
      </div>
    </div>
  )
}
