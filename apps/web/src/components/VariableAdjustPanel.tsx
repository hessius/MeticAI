import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Minus,
  Plus,
  ArrowCounterClockwise,
  Warning,
} from '@phosphor-icons/react'

export interface ProfileVariable {
  name: string
  key: string
  type: string
  value: number
}

export interface VariableAdjustPanelProps {
  profileVariables: ProfileVariable[]
  profileStages?: Record<string, unknown>[]
  overrides: Record<string, number>
  onOverridesChange: (overrides: Record<string, number>) => void
  onReset: () => void
}

interface VariableConfig {
  min: number
  max: number
  step: number
  unit: string
}

const VARIABLE_CONFIG: Record<string, VariableConfig> = {
  pressure: { min: 0, max: 15, step: 0.1, unit: 'bar' },
  flow: { min: 0, max: 10, step: 0.1, unit: 'ml/s' },
  weight: { min: 0, max: 100, step: 0.5, unit: 'g' },
  temperature: { min: 60, max: 100, step: 0.5, unit: '°C' },
  power: { min: 0, max: 100, step: 1, unit: '%' },
  time: { min: 0, max: 120, step: 1, unit: 's' },
  piston_position: { min: 0, max: 100, step: 1, unit: '%' },
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  pressure: 'variables.type.pressure',
  flow: 'variables.type.flow',
  weight: 'variables.type.weight',
  temperature: 'variables.type.temperature',
  power: 'variables.type.power',
  time: 'variables.type.time',
  piston_position: 'variables.type.piston',
}

// Base variable keys that get their own section at the top
const BASE_VAR_KEYS = new Set(['final_weight', 'temperature'])

/** Recursively find all $variable_key references in a stage object */
function findVariableRefs(obj: unknown, knownKeys: Set<string>): Set<string> {
  const refs = new Set<string>()
  if (typeof obj === 'string') {
    for (const key of knownKeys) {
      if (obj.includes(`$${key}`)) refs.add(key)
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      for (const ref of findVariableRefs(item, knownKeys)) refs.add(ref)
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      for (const ref of findVariableRefs(val, knownKeys)) refs.add(ref)
    }
  }
  return refs
}

export function VariableAdjustPanel({
  profileVariables,
  profileStages,
  overrides,
  onOverridesChange,
  onReset,
}: VariableAdjustPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  // Filter to only adjustable variables:
  // - Exclude info_ prefix variables (display-only metadata)
  // - Exclude variables whose name starts with an emoji (info variables)
  const adjustableVars = profileVariables.filter(
    (v) => !v.key.startsWith('info_') && !/^\p{Emoji}/u.test(v.name)
  )

  // Detect which variables are actually used in profile stages
  const usedKeys = useMemo(() => {
    if (!profileStages || profileStages.length === 0) return null // null = unknown (no stages data)
    const knownKeys = new Set(adjustableVars.map((v) => v.key))
    const used = new Set<string>()
    for (const stage of profileStages) {
      for (const ref of findVariableRefs(stage, knownKeys)) used.add(ref)
    }
    return used
  }, [profileStages, adjustableVars])

  if (adjustableVars.length === 0) {
    return null
  }

  // Split into base variables (final_weight, temperature) and the rest
  const baseVars = adjustableVars.filter((v) => BASE_VAR_KEYS.has(v.key))
  const otherVars = adjustableVars.filter((v) => !BASE_VAR_KEYS.has(v.key))

  // Group remaining variables by type
  const grouped = otherVars.reduce<Record<string, ProfileVariable[]>>(
    (acc, v) => {
      const type = v.type || 'other'
      if (!acc[type]) acc[type] = []
      acc[type].push(v)
      return acc
    },
    {}
  )

  const overrideCount = Object.keys(overrides).length

  const handleSliderChange = (key: string, value: number) => {
    const original = adjustableVars.find((v) => v.key === key)
    if (original && value === original.value) {
      // Reset to original — remove override
      const next = { ...overrides }
      delete next[key]
      onOverridesChange(next)
    } else {
      onOverridesChange({ ...overrides, [key]: value })
    }
  }

  const handleResetOne = (key: string) => {
    const next = { ...overrides }
    delete next[key]
    onOverridesChange(next)
  }

  const getDisplayValue = (variable: ProfileVariable): number => {
    return overrides[variable.key] ?? variable.value
  }

  const getDiff = (variable: ProfileVariable): number | null => {
    if (!(variable.key in overrides)) return null
    return overrides[variable.key] - variable.value
  }

  return (
    <Card className="p-4 space-y-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between"
        aria-expanded={isExpanded}
        aria-controls="variable-adjust-content"
      >
        <div className="flex items-center gap-2">
          <Label className="text-base font-medium cursor-pointer">
            {t('variables.adjust')}
          </Label>
          {overrideCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('variables.overridesApplied', { count: overrideCount })}
            </span>
          )}
        </div>
        {isExpanded ? <Minus size={18} /> : <Plus size={18} />}
      </button>
      <p className="text-xs text-muted-foreground">
        {t('variables.temporaryNote')}
      </p>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            id="variable-adjust-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pt-3 border-t">
              {/* Reset All */}
              {overrideCount > 0 && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" data-sound="adjust" onClick={onReset}>
                    <ArrowCounterClockwise size={14} className="mr-1" />
                    {t('variables.resetAll')}
                  </Button>
                </div>
              )}

              {/* Base Variables (Final Weight & Temperature) */}
              {baseVars.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('variables.baseVariables')}
                  </p>
                  {baseVars.map((variable) => renderVariable(variable))}
                </div>
              )}

              {/* Other Variable groups */}
              {Object.entries(grouped).map(([type, vars]) => (
                <div key={type} className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(TYPE_LABEL_KEYS[type] ?? type, type)}
                  </p>
                  {vars.map((variable) => renderVariable(variable))}
                </div>
              ))}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )

  function renderVariable(variable: ProfileVariable) {
    const config = VARIABLE_CONFIG[variable.type] ?? {
      min: 0,
      max: 100,
      step: 1,
      unit: '',
    }
    const currentValue = getDisplayValue(variable)
    const diff = getDiff(variable)
    const isModified = diff !== null
    const isUnused = usedKeys !== null && !BASE_VAR_KEYS.has(variable.key) && !usedKeys.has(variable.key)

    return (
      <div
        key={variable.key}
        className={`space-y-1.5 p-3 rounded-lg ${isUnused ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-muted/30'}`}
      >
        {/* Variable header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isUnused && (
              <Warning size={14} className="text-amber-500 shrink-0" weight="fill" />
            )}
            <span className={`text-sm font-medium truncate ${isUnused ? 'text-amber-700 dark:text-amber-400' : ''}`}>
              {variable.name}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isModified && (
              <>
                <span
                  className={`text-xs font-medium ${
                    diff! > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {diff! > 0 ? '+' : ''}
                  {Number(diff!.toFixed(2))}{config.unit}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  data-sound="adjust"
                  onClick={() => handleResetOne(variable.key)}
                  aria-label={t('a11y.resetVariable', { name: variable.name })}
                >
                  <ArrowCounterClockwise size={12} />
                </Button>
              </>
            )}
            <span className="text-sm font-mono tabular-nums min-w-[4rem] text-right">
              {Number(currentValue.toFixed(2))}{config.unit}
            </span>
          </div>
        </div>

        {/* Unused warning */}
        {isUnused && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('variables.unusedWarning')}
          </p>
        )}

        {/* Slider */}
        <Slider
          value={[currentValue]}
          min={config.min}
          max={config.max}
          step={config.step}
          onValueChange={([v]) =>
            handleSliderChange(variable.key, v)
          }
          aria-label={t('a11y.variableSlider', {
            name: variable.name,
            value: Number(currentValue.toFixed(2)),
            unit: config.unit,
            min: config.min,
            max: config.max,
          })}
          className={isModified ? '[&_[role=slider]]:border-primary' : ''}
        />

        {/* Original value hint */}
        {isModified && (
          <p className="text-xs text-muted-foreground">
            {t('variables.original', {
              value: `${variable.value}${config.unit}`,
            })}
          </p>
        )}
      </div>
    )
  }
}
