import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Coffee, ArrowRight } from '@phosphor-icons/react'

interface DialInBrewStepProps {
  onDone: () => void
}

export function DialInBrewStep({ onDone }: DialInBrewStepProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6 text-center py-4">
      <div className="flex justify-center">
        <div className="rounded-full bg-accent p-6">
          <Coffee size={48} weight="duotone" className="text-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t('dialIn.brew.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('dialIn.brew.description')}</p>
      </div>

      <Button
        variant="dark-brew"
        className="w-full h-12"
        onClick={onDone}
      >
        {t('dialIn.brew.done')}
        <ArrowRight size={18} className="ml-2" />
      </Button>
    </div>
  )
}
