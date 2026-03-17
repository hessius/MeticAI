import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from '@phosphor-icons/react'

interface CoffeeDetails {
  roast_level: string
  origin?: string
  process?: string
  roast_date?: string
}

interface DialInCoffeeStepProps {
  coffee: CoffeeDetails
  onChange: (coffee: CoffeeDetails) => void
  onSubmit: (coffee: CoffeeDetails) => void
  loading: boolean
}

const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const
const PROCESSES = ['washed', 'natural', 'honey', 'anaerobic', 'other'] as const

export function DialInCoffeeStep({ coffee, onChange, onSubmit, loading }: DialInCoffeeStepProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('dialIn.coffee.description')}</p>

      <div className="space-y-4">
        <div>
          <Label>{t('dialIn.coffee.roastLevel')}</Label>
          <div className="grid grid-cols-5 gap-1.5 mt-2">
            {ROAST_LEVELS.map((level) => (
              <Button
                key={level}
                variant={coffee.roast_level === level ? 'default' : 'outline'}
                size="sm"
                className="text-xs px-1"
                onClick={() => onChange({ ...coffee, roast_level: level })}
              >
                {t(`dialIn.coffee.roasts.${level}`)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="origin">{t('dialIn.coffee.origin')}</Label>
          <Input
            id="origin"
            placeholder={t('dialIn.coffee.originPlaceholder')}
            value={coffee.origin || ''}
            onChange={(e) => onChange({ ...coffee, origin: e.target.value || undefined })}
          />
        </div>

        <div>
          <Label>{t('dialIn.coffee.process')}</Label>
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            {PROCESSES.map((proc) => (
              <Button
                key={proc}
                variant={coffee.process === proc ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
                onClick={() => onChange({ ...coffee, process: coffee.process === proc ? undefined : proc })}
              >
                {t(`dialIn.coffee.processes.${proc}`)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="roast-date">{t('dialIn.coffee.roastDate')}</Label>
          <Input
            id="roast-date"
            type="date"
            value={coffee.roast_date || ''}
            onChange={(e) => onChange({ ...coffee, roast_date: e.target.value || undefined })}
          />
        </div>
      </div>

      <Button
        variant="dark-brew"
        className="w-full h-12"
        onClick={() => onSubmit(coffee)}
        disabled={loading}
      >
        {loading ? t('common.loading') : t('dialIn.coffee.continue')}
        {!loading && <ArrowRight size={18} className="ml-2" />}
      </Button>
    </div>
  )
}
