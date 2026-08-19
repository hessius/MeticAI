import { useTranslation } from 'react-i18next'
import type { ChartLayoutPref } from '@/lib/chartLayout'

export interface ChartLayoutToggleProps {
  pref: ChartLayoutPref
  onChange: (pref: ChartLayoutPref) => void
  className?: string
}

/** Segmented Combined/Separated control for chart views (#589). */
export function ChartLayoutToggle({ pref, onChange, className }: ChartLayoutToggleProps) {
  const { t } = useTranslation()
  return (
    <div
      className={`inline-flex rounded-md border border-border p-0.5 text-xs ${className ?? ''}`}
      role="group"
      aria-label={t('charts.layout.label')}
    >
      {(['combined', 'separated'] as const).map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded px-2 py-1 transition-colors ${
            pref === opt
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground'
          }`}
          aria-pressed={pref === opt}
        >
          {t(`charts.layout.${opt}`)}
        </button>
      ))}
    </div>
  )
}
