import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { TasteCompassInput, DEFAULT_TASTE_DATA, type TasteData } from '../TasteCompassInput'

interface Props {
  onAnalyze: (taste: TasteData) => void
  onSkip: () => void
  initialTaste?: TasteData
}

export function AnalysisTasteGate({ onAnalyze, onSkip, initialTaste }: Props) {
  const { t } = useTranslation()
  const [taste, setTaste] = useState<TasteData>(initialTaste ?? DEFAULT_TASTE_DATA)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t('analysis.taste.gateTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('analysis.taste.gateBody')}</p>
      </div>
      <TasteCompassInput value={taste} onChange={setTaste} />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" data-testid="taste-gate-skip" onClick={onSkip}>
          {t('analysis.taste.skip')}
        </Button>
        <Button data-testid="taste-gate-analyze" onClick={() => onAnalyze(taste)}>
          {t('analysis.taste.analyzeWithTaste')}
        </Button>
      </div>
    </div>
  )
}
