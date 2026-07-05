import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type { ShotFacts } from '../../lib/shotFacts'
import { compassAdjustments } from '../../lib/compassRules'
import type { StoredTaste } from '../../lib/shotTasteStore'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

interface Props {
  facts: ShotFacts
  taste?: StoredTaste | null
}

export function ShotFactsPanel({ facts, taste }: Props) {
  const { t } = useTranslation()
  const reached = facts.stages.filter(s => s.reached)
  if (reached.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-foreground">{t('analysis.facts.title')}</h3>
        <Popover>
          <PopoverTrigger
            className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            aria-label={t('analysis.facts.infoLabel')}
          >
            <Info className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="max-w-xs text-xs text-muted-foreground">
            {t('analysis.facts.subtitle')}
          </PopoverContent>
        </Popover>
      </div>
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
      {taste && (() => {
        const adj = compassAdjustments(taste.x, taste.y)
        if (adj.length === 0) return null
        return (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-foreground">{t('analysis.facts.adjustmentsTitle')}</h4>
            <ul className="space-y-1">
              {adj.map((a, i) => (
                <li key={`${a.kind}-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-mono">{a.kind}</span>: {a.reason}
                </li>
              ))}
            </ul>
          </div>
        )
      })()}
    </div>
  )
}
