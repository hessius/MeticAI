import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { CheckCircle, Circle, ArrowRight } from '@phosphor-icons/react'

interface DialInPrepStepProps {
  profileName: string
  onDone: () => void
}

const PREP_ITEMS = [
  'grind',
  'dose',
  'distribute',
  'tamp',
  'purge',
] as const

export function DialInPrepStep({ profileName, onDone }: DialInPrepStepProps) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const toggle = (item: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  const allChecked = PREP_ITEMS.every((item) => checked.has(item))

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('dialIn.prep.description', { profile: profileName })}
      </p>

      <div className="space-y-2">
        {PREP_ITEMS.map((item) => (
          <button
            key={item}
            onClick={() => toggle(item)}
            className="flex items-center gap-3 w-full p-3 rounded-lg border hover:bg-accent transition-colors text-left"
          >
            {checked.has(item) ? (
              <CheckCircle size={22} weight="fill" className="text-green-500 shrink-0" />
            ) : (
              <Circle size={22} className="text-muted-foreground shrink-0" />
            )}
            <span className="text-sm font-medium">{t(`dialIn.prep.items.${item}`)}</span>
          </button>
        ))}
      </div>

      <Button
        variant="dark-brew"
        className="w-full h-12"
        onClick={onDone}
        disabled={!allChecked}
      >
        {t('dialIn.prep.ready')}
        <ArrowRight size={18} className="ml-2" />
      </Button>

      <Button
        variant="ghost"
        className="w-full"
        onClick={onDone}
      >
        {t('dialIn.prep.skip')}
      </Button>
    </div>
  )
}
