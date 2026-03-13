import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  CaretDown,
  CaretUp,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'

export interface ProfileVariable {
  name: string
  key: string
  type: string
  value: number
}

export interface VariableAdjustPanelProps {
  profileVariables: ProfileVariable[]
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
  power: { min: 0, max: 100, step: 1, unit: '%' },
  time: { min: 0, max: 120, step: 1, unit: 's' },
  piston_position: { min: 0, max: 100, step: 1, unit: '%' },
}

const TYPE_LABELS: Record<string, string> = {
  pressure: 'Pressure',
  flow: 'Flow',
  weight: 'Weight',
  power: 'Power',
  time: 'Time',
  piston_position: 'Piston',
}

export function VariableAdjustPanel({
  profileVariables,
  overrides,
  onOverridesChange,
  onReset,
}: VariableAdjustPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  // Filter to only adjustable variables (no info_ prefix)
  const adjustableVars = profileVariables.filter(
    (v) => !v.key.startsWith('info_')
  )

  if (adjustableVars.length === 0) {
    return null
  }

  // Group by type
  const grouped = adjustableVars.reduce<Record<string, ProfileVariable[]>>(
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
        {isExpanded ? <CaretUp size={18} /> : <CaretDown size={18} />}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pt-3 border-t">
              {/* Reset All */}
              {overrideCount > 0 && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={onReset}>
                    <ArrowCounterClockwise size={14} className="mr-1" />
                    {t('variables.resetAll')}
                  </Button>
                </div>
              )}

              {/* Variable groups */}
              {Object.entries(grouped).map(([type, vars]) => (
                <div key={type} className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {TYPE_LABELS[type] ?? type}
                  </p>

                  {vars.map((variable) => {
                    const config = VARIABLE_CONFIG[variable.type] ?? {
                      min: 0,
                      max: 100,
                      step: 1,
                      unit: '',
                    }
                    const currentValue = getDisplayValue(variable)
                    const diff = getDiff(variable)
                    const isModified = diff !== null

                    return (
                      <div
                        key={variable.key}
                        className="space-y-1.5 p-3 rounded-lg bg-muted/30"
                      >
                        {/* Variable header */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">
                            {variable.name}
                          </span>
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
                                  onClick={() => handleResetOne(variable.key)}
                                  title={t('variables.reset')}
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

                        {/* Slider */}
                        <Slider
                          value={[currentValue]}
                          min={config.min}
                          max={config.max}
                          step={config.step}
                          onValueChange={([v]) =>
                            handleSliderChange(variable.key, v)
                          }
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
                  })}
                </div>
              ))}

              {adjustableVars.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('variables.noAdjustable')}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
