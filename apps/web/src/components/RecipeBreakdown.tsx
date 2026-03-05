import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Flower,
  Drop,
  Timer,
  ArrowsClockwise,
  CoffeeBean,
  Scales,
} from '@phosphor-icons/react'
import type { Recipe, RecipeStep } from '@/types'

interface RecipeBreakdownProps {
  recipe: Recipe
  compact?: boolean
}

type ActionType = RecipeStep['action']

function getActionIcon(action: ActionType, size = 14) {
  switch (action) {
    case 'bloom':
      return <Flower size={size} weight="bold" />
    case 'pour':
      return <Drop size={size} weight="bold" />
    case 'wait':
      return <Timer size={size} weight="bold" />
    case 'swirl':
      return <ArrowsClockwise size={size} weight="bold" />
    case 'stir':
      return <ArrowsClockwise size={size} weight="bold" />
  }
}

function getActionColors(action: ActionType): { text: string; border: string; bg: string } {
  switch (action) {
    case 'bloom':
      return {
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-300 dark:border-amber-700',
        bg: 'bg-amber-500/10',
      }
    case 'pour':
      return {
        text: 'text-blue-600 dark:text-blue-400',
        border: 'border-blue-300 dark:border-blue-700',
        bg: 'bg-blue-500/10',
      }
    case 'wait':
      return {
        text: 'text-slate-500 dark:text-slate-400',
        border: 'border-slate-300 dark:border-slate-600',
        bg: 'bg-slate-500/10',
      }
    case 'swirl':
      return {
        text: 'text-purple-600 dark:text-purple-400',
        border: 'border-purple-300 dark:border-purple-700',
        bg: 'bg-purple-500/10',
      }
    case 'stir':
      return {
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-300 dark:border-emerald-700',
        bg: 'bg-emerald-500/10',
      }
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function getStepLabel(step: RecipeStep): string {
  switch (step.action) {
    case 'bloom':
      return step.water_g !== undefined ? `Bloom ${step.water_g}g` : 'Bloom'
    case 'pour':
      return step.water_g !== undefined ? `Pour ${step.water_g}g` : 'Pour'
    case 'wait':
      return `Wait ${formatDuration(step.duration_s)}`
    case 'swirl':
      return 'Swirl'
    case 'stir':
      return 'Stir'
  }
}

export function RecipeBreakdown({ recipe, compact = false }: RecipeBreakdownProps) {
  const { metadata, equipment, ingredients, protocol } = recipe

  const dripperLabel = useMemo(() => {
    const { model, material } = equipment.dripper
    return material ? `${model} ${material}` : model
  }, [equipment.dripper])

  const ratio = useMemo(() => {
    const r = ingredients.water_g / ingredients.coffee_g
    return r.toFixed(1)
  }, [ingredients.coffee_g, ingredients.water_g])

  // Compute cumulative weight for pour/bloom steps
  const cumulativeWeights = useMemo(() => {
    const weights: number[] = []
    let running = 0
    for (const step of protocol) {
      if ((step.action === 'bloom' || step.action === 'pour') && step.water_g !== undefined) {
        running += step.water_g
      }
      weights.push(running)
    }
    return weights
  }, [protocol])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 bg-secondary/40 rounded-xl border border-border/60 space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-foreground leading-tight">
            {metadata.name}
          </h2>
          {metadata.author && (
            <p className="text-xs text-muted-foreground">by {metadata.author}</p>
          )}
          {metadata.description && (
            <p className="text-sm text-muted-foreground leading-snug">
              {metadata.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="text-xs border-border/60 text-foreground"
          >
            {dripperLabel}
          </Badge>
          <Badge
            variant="outline"
            className="text-xs border-border/60 text-foreground"
          >
            Grind: {ingredients.grind_setting}
          </Badge>
        </div>
      </div>

      {/* Ingredients row */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 bg-secondary/40 text-sm">
          <CoffeeBean size={15} weight="bold" className="text-amber-700 dark:text-amber-400" />
          <span className="font-medium text-foreground">{ingredients.coffee_g}g coffee</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 bg-secondary/40 text-sm">
          <Drop size={15} weight="bold" className="text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-foreground">{ingredients.water_g}g water</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 bg-secondary/40 text-sm">
          <Scales size={15} weight="bold" className="text-muted-foreground" />
          <span className="font-medium text-foreground">1:{ratio}</span>
        </div>
      </div>

      {/* Protocol steps */}
      {compact ? (
        /* Compact one-line-per-step view */
        <div className="p-3 bg-secondary/40 rounded-xl border border-border/60 space-y-1">
          {protocol.map((step, idx) => {
            const colors = getActionColors(step.action)
            const label = getStepLabel(step)
            return (
              <div
                key={step.step}
                className="flex items-center justify-between gap-2 py-1 px-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-muted-foreground w-4 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <span className={`shrink-0 ${colors.text}`}>
                    {getActionIcon(step.action, 13)}
                  </span>
                  <span className="text-sm font-medium text-foreground truncate">{label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(step.action === 'bloom' || step.action === 'pour') &&
                    step.water_g !== undefined && (
                      <span className="text-[11px] text-muted-foreground">
                        {cumulativeWeights[idx]}g total
                      </span>
                    )}
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded border ${colors.text} ${colors.border} ${colors.bg}`}
                  >
                    {formatDuration(step.duration_s)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Full vertical step list */
        <div className="space-y-2">
          {protocol.map((step, idx) => {
            const colors = getActionColors(step.action)
            const label = getStepLabel(step)
            const hasPourWeight =
              (step.action === 'bloom' || step.action === 'pour') &&
              step.water_g !== undefined

            return (
              <div
                key={step.step}
                className={`p-3 rounded-xl border bg-secondary/40 space-y-1.5 ${colors.border}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Step number */}
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0 mt-px">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    {/* Action icon in coloured pill */}
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-lg border shrink-0 ${colors.text} ${colors.border} ${colors.bg}`}
                    >
                      {getActionIcon(step.action, 13)}
                    </span>

                    {/* Label */}
                    <span className="text-sm font-semibold text-foreground leading-tight">
                      {label}
                    </span>
                  </div>

                  {/* Right side: cumulative + duration */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasPourWeight && (
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {cumulativeWeights[idx]}g total
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[11px] px-1.5 py-0 h-5 border ${colors.text} ${colors.border} ${colors.bg}`}
                    >
                      {formatDuration(step.duration_s)}
                    </Badge>
                  </div>
                </div>

                {/* Notes */}
                {step.notes && (
                  <p className="text-xs text-muted-foreground pl-[52px]">{step.notes}</p>
                )}

                {/* Valve state */}
                {step.valve_state && (
                  <div className="pl-[52px]">
                    <Badge
                      variant="outline"
                      className={
                        step.valve_state === 'open'
                          ? 'text-[10px] px-1.5 py-0 h-4 border text-sky-600 dark:text-sky-400 border-sky-300 dark:border-sky-700 bg-sky-500/10'
                          : 'text-[10px] px-1.5 py-0 h-4 border text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 bg-slate-500/10'
                      }
                    >
                      Valve {step.valve_state}
                    </Badge>
                  </div>
                )}

                {/* Flow rate hint */}
                {step.flow_rate && (
                  <div className="pl-[52px]">
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {step.flow_rate} flow
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
