import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft } from '@phosphor-icons/react'
import { getServerUrl } from '@/lib/config'
import { toast } from 'sonner'
import { useScreenReaderAnnouncement } from '@/hooks/a11y/useScreenReader'
import { useScrollToTop } from '@/hooks/useScrollToTop'
import { DialInCoffeeStep } from './DialInCoffeeStep'
import { DialInProfileStep } from './DialInProfileStep'
import { DialInPrepStep } from './DialInPrepStep'
import { DialInBrewStep } from './DialInBrewStep'
import { DialInTasteStep } from './DialInTasteStep'
import { DialInRecommendStep } from './DialInRecommendStep'
import { DialInHistoryStep } from './DialInHistoryStep'
import type { TasteData } from './TasteCompassInput'

// Types
interface CoffeeDetails {
  roast_level: string
  origin?: string
  process?: string
  roast_date?: string
}

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
  coffee: CoffeeDetails
  profile_name?: string
  iterations: Iteration[]
  status: string
  created_at: string
  updated_at: string
}

type WizardStep = 'coffee' | 'profile' | 'prep' | 'brew' | 'taste' | 'recommend' | 'history'

const STEPS: WizardStep[] = ['coffee', 'profile', 'prep', 'brew', 'taste', 'recommend', 'history']

interface DialInWizardProps {
  onBack: () => void
  aiConfigured?: boolean
}

export function DialInWizard({ onBack, aiConfigured = true }: DialInWizardProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>('coffee')
  const [session, setSession] = useState<DialInSession | null>(null)
  const [coffee, setCoffee] = useState<CoffeeDetails>({ roast_level: 'medium' })
  const [profileName, setProfileName] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useScrollToTop([step])

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex + 1) / STEPS.length) * 100
  const announce = useScreenReaderAnnouncement()

  useEffect(() => {
    announce(t('a11y.stepProgress', { current: stepIndex + 1, total: STEPS.length, step: t(`dialIn.steps.${step}`) }))
  }, [step, stepIndex, announce, t])

  // API helpers
  const apiCall = useCallback(async (path: string, options?: RequestInit) => {
    const serverUrl = await getServerUrl()
    const resp = await fetch(`${serverUrl}/api/dialin${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(err.detail || `HTTP ${resp.status}`)
    }
    return resp.json()
  }, [])

  // Step 1 complete: create session
  const handleCoffeeSubmit = useCallback(async (details: CoffeeDetails) => {
    setCoffee(details)
    setLoading(true)
    try {
      const data = await apiCall('/sessions', {
        method: 'POST',
        body: JSON.stringify({ coffee: details, profile_name: profileName || undefined }),
      })
      setSession(data)
      setStep('profile')
    } catch {
      toast.error(t('dialIn.errors.createFailed'))
    } finally {
      setLoading(false)
    }
  }, [apiCall, profileName, t])

  // Step 2 complete: profile selected
  const handleProfileSelected = useCallback((name: string) => {
    setProfileName(name)
    setStep('prep')
  }, [])

  // Step 3 complete: prep done
  const handlePrepDone = useCallback(() => {
    setStep('brew')
  }, [])

  // Step 4 complete: brew done
  const handleBrewDone = useCallback(() => {
    setStep('taste')
  }, [])

  // Step 5 complete: taste submitted
  const handleTasteSubmit = useCallback(async (taste: TasteData) => {
    if (!session) return
    setLoading(true)
    try {
      const feedback: TasteFeedback = {
        x: taste.x,
        y: taste.y,
        descriptors: taste.descriptors,
      }
      await apiCall(`/sessions/${session.id}/iterations`, {
        method: 'POST',
        body: JSON.stringify({ taste: feedback }),
      })
      // Refresh session to get updated iterations
      const updated = await apiCall(`/sessions/${session.id}`)
      setSession(updated)
      setStep('recommend')
    } catch {
      toast.error(t('dialIn.errors.iterationFailed'))
    } finally {
      setLoading(false)
    }
  }, [session, apiCall, t])

  // Step 6: try another iteration
  const handleTryAgain = useCallback(() => {
    setStep('brew')
  }, [])

  // Step 6/7: view history
  const handleViewHistory = useCallback(() => {
    setStep('history')
  }, [])

  // Complete session
  const handleComplete = useCallback(async () => {
    if (!session) return
    try {
      await apiCall(`/sessions/${session.id}/complete`, { method: 'POST' })
      toast.success(t('dialIn.sessionCompleted'))
      onBack()
    } catch {
      toast.error(t('dialIn.errors.completeFailed'))
    }
  }, [session, apiCall, t, onBack])

  // Navigate back within wizard
  const handleStepBack = useCallback(() => {
    const idx = STEPS.indexOf(step)
    if (idx <= 0) {
      onBack()
    } else {
      setStep(STEPS[idx - 1])
    }
  }, [step, onBack])

  return (
    <motion.div
      key="dial-in"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" data-sound="back" onClick={handleStepBack} aria-label={t('a11y.goBack')}>
            <ArrowLeft size={20} />
          </Button>
          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-tight">{t('dialIn.title')}</h2>
            <p className="text-xs text-muted-foreground">
              {t(`dialIn.steps.${step}`)} — {t('dialIn.stepOf', { current: stepIndex + 1, total: STEPS.length })}
            </p>
          </div>
        </div>

        {/* Progress */}
        <Progress
          value={progress}
          className="h-1.5"
          aria-label={t('a11y.progressBar', { percent: Math.round(progress) })}
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        />

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'coffee' && (
              <DialInCoffeeStep
                coffee={coffee}
                onChange={setCoffee}
                onSubmit={handleCoffeeSubmit}
                loading={loading}
              />
            )}
            {step === 'profile' && (
              <DialInProfileStep
                coffee={coffee}
                onSelect={handleProfileSelected}
                aiConfigured={aiConfigured}
              />
            )}
            {step === 'prep' && (
              <DialInPrepStep
                profileName={profileName}
                onDone={handlePrepDone}
              />
            )}
            {step === 'brew' && (
              <DialInBrewStep
                onDone={handleBrewDone}
              />
            )}
            {step === 'taste' && (
              <DialInTasteStep
                onSubmit={handleTasteSubmit}
                loading={loading}
              />
            )}
            {step === 'recommend' && session && (
              <DialInRecommendStep
                session={session}
                onTryAgain={handleTryAgain}
                onViewHistory={handleViewHistory}
                onComplete={handleComplete}
              />
            )}
            {step === 'history' && session && (
              <DialInHistoryStep
                session={session}
                onTryAgain={handleTryAgain}
                onComplete={handleComplete}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}
