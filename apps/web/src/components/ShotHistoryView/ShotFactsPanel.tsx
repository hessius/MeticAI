import { useTranslation } from 'react-i18next'
import type { ShotFacts } from '../../lib/shotFacts'

interface Props {
  facts: ShotFacts
}

export function ShotFactsPanel({ facts }: Props) {
  const { t } = useTranslation()
  const reached = facts.stages.filter(s => s.reached)
  if (reached.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('analysis.facts.title')}</h3>
      <ul className="space-y-2">
        {reached.map((s, i) => (
          <li key={`${s.stage_name}-${i}`} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{s.stage_name}</span>
              {s.trigger_class && (
                <span
                  className={
                    'text-xs px-2 py-0.5 rounded-full ' +
                    (s.trigger_class.kind === 'targeted'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : s.trigger_class.kind === 'failsafe'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-muted text-muted-foreground')
                  }
                >
                  {s.trigger_class.label}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {s.stall?.stalled && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">{t('analysis.facts.stalled')}</span>
              )}
              {s.channeling?.channeling && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">{t('analysis.facts.channeling')}</span>
              )}
              {s.curve_adherence && Math.abs(s.curve_adherence.delta) >= 0.5 && (
                <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {t('analysis.facts.curveDelta', { delta: s.curve_adherence.delta })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
