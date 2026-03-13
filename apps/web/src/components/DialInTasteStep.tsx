import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ArrowRight } from '@phosphor-icons/react'
import { TasteCompassInput, DEFAULT_TASTE_DATA } from './TasteCompassInput'
import type { TasteData } from './TasteCompassInput'

interface DialInTasteStepProps {
  onSubmit: (taste: TasteData) => void
  loading: boolean
}

export function DialInTasteStep({ onSubmit, loading }: DialInTasteStepProps) {
  const { t } = useTranslation()
  const [taste, setTaste] = useState<TasteData>({ ...DEFAULT_TASTE_DATA })

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('dialIn.taste.description')}</p>

      <TasteCompassInput value={taste} onChange={setTaste} />

      <Button
        variant="dark-brew"
        className="w-full h-12"
        onClick={() => onSubmit(taste)}
        disabled={!taste.hasInput || loading}
      >
        {loading ? t('common.loading') : t('dialIn.taste.submit')}
        {!loading && <ArrowRight size={18} className="ml-2" />}
      </Button>
    </div>
  )
}
