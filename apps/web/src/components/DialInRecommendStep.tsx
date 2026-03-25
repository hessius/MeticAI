import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ArrowClockwise, ListBullets, CheckCircle } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'

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

interface DialInRecommendStepProps {
  session: DialInSession
  onTryAgain: () => void
  onViewHistory: () => void
  onComplete: () => void
}

export function DialInRecommendStep({ session, onTryAgain, onViewHistory, onComplete }: DialInRecommendStepProps) {
  const { t } = useTranslation()
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const latestIteration = session.iterations[session.iterations.length - 1]

  useEffect(() => {
    if (!latestIteration) {
      setLoading(false)
      return
    }

    let cancelled = false
    const fetchRecommendations = async () => {
      try {
        const serverUrl = await getServerUrl()
        const res = await fetch(`${serverUrl}/api/dialin/sessions/${session.id}/recommend`, {
          method: 'POST',
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = await res.json()
        if (!cancelled) {
          setRecommendations(data.recommendations ?? [])
        }
      } catch {
        if (!cancelled) {
          // Fallback to basic rules if API call fails
          const { x, y } = latestIteration.taste
          const recs: string[] = []
          if (x < -0.2) {
            recs.push(t('dialIn.recommend.tips.grindFiner'))
            recs.push(t('dialIn.recommend.tips.increaseTemp'))
          }
          if (x > 0.2) {
            recs.push(t('dialIn.recommend.tips.grindCoarser'))
            recs.push(t('dialIn.recommend.tips.decreaseTemp'))
          }
          if (y < -0.2) recs.push(t('dialIn.recommend.tips.increaseDose'))
          if (y > 0.2) recs.push(t('dialIn.recommend.tips.decreaseDose'))
          if (recs.length === 0) recs.push(t('dialIn.recommend.tips.lookingGood'))
          setRecommendations(recs)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchRecommendations()
    return () => { cancelled = true }
  }, [session.id, latestIteration, t])

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h3 className="font-semibold">{t('dialIn.recommend.title')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('dialIn.recommend.iteration', { number: latestIteration?.iteration_number ?? 1 })}
        </p>
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('dialIn.recommend.loading')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg border bg-accent/50"
            >
              <span className="text-sm font-bold text-muted-foreground shrink-0">{i + 1}.</span>
              <span className="text-sm">{rec}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2">
        <Button
          variant="dark-brew"
          className="w-full h-12"
          onClick={onTryAgain}
        >
          <ArrowClockwise size={18} className="mr-2" />
          {t('dialIn.recommend.tryAgain')}
        </Button>

        {session.iterations.length > 1 && (
          <Button
            variant="outline"
            className="w-full"
            onClick={onViewHistory}
          >
            <ListBullets size={18} className="mr-2" />
            {t('dialIn.recommend.viewHistory')}
          </Button>
        )}

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
