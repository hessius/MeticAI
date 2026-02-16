import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  Thermometer, 
  Scales, 
  Sliders, 
  ListNumbers,
  Timer,
  Drop,
  Gauge,
  Info,
  Warning
} from '@phosphor-icons/react'

// Distinct colors for variables - designed to be easily distinguishable
const VARIABLE_COLORS = [
  { bg: 'bg-violet-500/20', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-500/40', dot: 'bg-violet-500 dark:bg-violet-400' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-500/40', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  { bg: 'bg-rose-500/20', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-500/40', dot: 'bg-rose-500 dark:bg-rose-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-700 dark:text-cyan-400', border: 'border-cyan-500/40', dot: 'bg-cyan-500 dark:bg-cyan-400' },
  { bg: 'bg-orange-500/20', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-500/40', dot: 'bg-orange-500 dark:bg-orange-400' },
  { bg: 'bg-pink-500/20', text: 'text-pink-700 dark:text-pink-400', border: 'border-pink-500/40', dot: 'bg-pink-500 dark:bg-pink-400' },
  { bg: 'bg-teal-500/20', text: 'text-teal-700 dark:text-teal-400', border: 'border-teal-500/40', dot: 'bg-teal-500 dark:bg-teal-400' },
  { bg: 'bg-yellow-500/20', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-500/40', dot: 'bg-yellow-500 dark:bg-yellow-400' },
]

interface ProfileVariable {
  name: string
  key: string
  type: string
  value: number
}

interface StageDynamics {
  points?: unknown[]
  over?: string
  interpolation?: string
}

interface StageLimit {
  type: string
  value: number | string
}

interface ExitTrigger {
  type: string
  value?: number
  comparison?: string
}

interface ProfileStage {
  name: string
  type: string
  dynamics?: StageDynamics
  // Flattened format (from history storage)
  dynamics_points?: unknown[]
  dynamics_over?: string
  dynamics_interpolation?: string
  exit_triggers?: ExitTrigger[]
  limits?: StageLimit[]
  key?: string
}

// Find which stages use each variable using proper recursive traversal
function findVariableUsage(stages: ProfileStage[], variables: ProfileVariable[]): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  
  // Initialize all adjustable variables with empty arrays
  variables.forEach(v => {
    if (!v.key.startsWith('info_')) {
      usage.set(v.key, [])
    }
  })
  
  // Recursively find variable references in an object
  const findVariableRefs = (obj: unknown): Set<string> => {
    const refs = new Set<string>()
    
    if (typeof obj === 'string') {
      // Match $variable_key pattern - must be exact match with word boundary
      const matches = obj.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g)
      if (matches) {
        matches.forEach(match => {
          const varKey = match.substring(1) // Remove $
          refs.add(varKey)
        })
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(item => {
        findVariableRefs(item).forEach(ref => refs.add(ref))
      })
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(val => {
        findVariableRefs(val).forEach(ref => refs.add(ref))
      })
    }
    
    return refs
  }
  
  stages.forEach(stage => {
    const refsInStage = findVariableRefs(stage)
    
    variables.forEach(v => {
      if (v.key.startsWith('info_')) return // Skip info variables
      
      if (refsInStage.has(v.key)) {
        const stageList = usage.get(v.key) || []
        stageList.push(stage.name)
        usage.set(v.key, stageList)
      }
    })
  })
  
  return usage
}

// Check if a string starts with an emoji or symbol
function startsWithEmoji(str: string): boolean {
  // Match emojis and symbols using Unicode property classes
  // \p{Emoji} covers most emoji characters
  // \p{Symbol} and \p{So} cover other symbols
  const emojiRegex = /^[\p{Emoji}\p{Symbol}\p{So}]/u
  return emojiRegex.test(str)
}

// Validate variable naming conventions
interface ValidationWarning {
  type: 'info-missing-emoji' | 'adjustable-has-emoji' | 'adjustable-unused'
  variableName: string
  message: string
}

function validateVariables(
  variables: ProfileVariable[], 
  variableUsage: Map<string, string[]>
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  
  variables.forEach(v => {
    const isInfo = v.key.startsWith('info_')
    const hasEmoji = startsWithEmoji(v.name)
    
    if (isInfo && !hasEmoji) {
      warnings.push({
        type: 'info-missing-emoji',
        variableName: v.name,
        message: `Info variable "${v.name}" should start with an emoji`
      })
    }
    
    if (!isInfo && hasEmoji) {
      warnings.push({
        type: 'adjustable-has-emoji',
        variableName: v.name,
        message: `Adjustable variable "${v.name}" should not start with an emoji`
      })
    }
    
    if (!isInfo) {
      const usedIn = variableUsage.get(v.key) || []
      if (usedIn.length === 0) {
        warnings.push({
          type: 'adjustable-unused',
          variableName: v.name,
          message: `Variable "${v.name}" is defined but not used in any stage`
        })
      }
    }
  })
  
  return warnings
}

// Normalize stage dynamics - handles both nested and flattened formats
function getNormalizedDynamics(stage: ProfileStage): StageDynamics | undefined {
  // If we have nested dynamics object
  if (stage.dynamics && stage.dynamics.points) {
    return stage.dynamics
  }
  // If we have flattened format (dynamics_points, dynamics_over, etc.)
  if (stage.dynamics_points) {
    return {
      points: stage.dynamics_points,
      over: stage.dynamics_over,
      interpolation: stage.dynamics_interpolation
    }
  }
  // No dynamics found
  return undefined
}

export interface ProfileData {
  temperature?: number
  final_weight?: number
  variables?: ProfileVariable[]
  stages?: ProfileStage[]
}

interface ProfileBreakdownProps {
  profile: ProfileData | null
  className?: string
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'pressure':
      return <Gauge size={14} weight="bold" className="text-amber-600 dark:text-amber-400" />
    case 'flow':
      return <Drop size={14} weight="bold" className="text-blue-600 dark:text-blue-400" />
    case 'power':
      return <Thermometer size={14} weight="bold" className="text-red-600 dark:text-red-400" />
    default:
      return <Sliders size={14} weight="bold" className="text-muted-foreground" />
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case 'pressure':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
    case 'flow':
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30'
    case 'power':
      return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
    default:
      return 'bg-muted text-muted-foreground border-muted'
  }
}

function getTypeUnit(type: string): string {
  switch (type) {
    case 'pressure':
      return 'bar'
    case 'flow':
      return 'ml/s'
    case 'power':
      return '%'
    default:
      return ''
  }
}

function resolveValue(value: unknown, variables?: ProfileVariable[]): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.startsWith('$') && variables) {
    const varKey = value.substring(1)
    const variable = variables.find(v => v.key === varKey)
    if (variable) return variable.value
  }
  return null
}

function analyzePattern(values: (number | null)[]): 'flat' | 'ascending' | 'descending' | 'ramp-up-hold' | 'ramp-down-hold' | 'oscillating' | 'peak' | 'valley' | 'complex' {
  const validValues = values.filter((v): v is number => v !== null)
  if (validValues.length === 0) return 'complex'
  if (validValues.length === 1) return 'flat'
  
  const min = Math.min(...validValues)
  const max = Math.max(...validValues)
  
  // Check if all values are the same (flat)
  if (max - min < 0.1) return 'flat'
  
  // Check for simple ascending/descending
  let isAscending = true
  let isDescending = true
  for (let i = 1; i < validValues.length; i++) {
    if (validValues[i] < validValues[i - 1] - 0.1) isAscending = false
    if (validValues[i] > validValues[i - 1] + 0.1) isDescending = false
  }
  if (isAscending) return 'ascending'
  if (isDescending) return 'descending'
  
  // Check for ramp-up-hold or ramp-down-hold
  const midPoint = Math.floor(validValues.length / 2)
  const firstHalf = validValues.slice(0, midPoint)
  const secondHalf = validValues.slice(midPoint)
  
  const firstHalfAscending = firstHalf.every((v, i) => i === 0 || v >= firstHalf[i - 1] - 0.1)
  const secondHalfFlat = secondHalf.length > 1 && Math.max(...secondHalf) - Math.min(...secondHalf) < 0.5
  if (firstHalfAscending && secondHalfFlat) return 'ramp-up-hold'
  
  const firstHalfDescending = firstHalf.every((v, i) => i === 0 || v <= firstHalf[i - 1] + 0.1)
  if (firstHalfDescending && secondHalfFlat) return 'ramp-down-hold'
  
  // Check for peak (goes up then down)
  const maxIndex = validValues.indexOf(max)
  if (maxIndex > 0 && maxIndex < validValues.length - 1) {
    const beforePeak = validValues.slice(0, maxIndex + 1)
    const afterPeak = validValues.slice(maxIndex)
    const beforeAscending = beforePeak.every((v, i) => i === 0 || v >= beforePeak[i - 1] - 0.1)
    const afterDescending = afterPeak.every((v, i) => i === 0 || v <= afterPeak[i - 1] + 0.1)
    if (beforeAscending && afterDescending) return 'peak'
  }
  
  // Check for valley (goes down then up)
  const minIndex = validValues.indexOf(min)
  if (minIndex > 0 && minIndex < validValues.length - 1) {
    const beforeValley = validValues.slice(0, minIndex + 1)
    const afterValley = validValues.slice(minIndex)
    const beforeDescending = beforeValley.every((v, i) => i === 0 || v <= beforeValley[i - 1] + 0.1)
    const afterAscending = afterValley.every((v, i) => i === 0 || v >= afterValley[i - 1] - 0.1)
    if (beforeDescending && afterAscending) return 'valley'
  }
  
  // Check for oscillating (multiple direction changes)
  let directionChanges = 0
  for (let i = 2; i < validValues.length; i++) {
    const prevDir = validValues[i - 1] - validValues[i - 2]
    const currDir = validValues[i] - validValues[i - 1]
    if ((prevDir > 0.1 && currDir < -0.1) || (prevDir < -0.1 && currDir > 0.1)) {
      directionChanges++
    }
  }
  if (directionChanges >= 2) return 'oscillating'
  
  return 'complex'
}

function getPatternEmoji(pattern: string): string {
  switch (pattern) {
    case 'flat': return '➡️'
    case 'ascending': return '📈'
    case 'descending': return '📉'
    case 'ramp-up-hold': return '📈➡️'
    case 'ramp-down-hold': return '📉➡️'
    case 'peak': return '⛰️'
    case 'valley': return '🏜️'
    case 'oscillating': return '〰️'
    default: return '🔀'
  }
}

function getPatternDescription(pattern: string): string {
  switch (pattern) {
    case 'flat': return 'constant'
    case 'ascending': return 'ramping up'
    case 'descending': return 'declining'
    case 'ramp-up-hold': return 'ramp then hold'
    case 'ramp-down-hold': return 'decline then hold'
    case 'peak': return 'up then down'
    case 'valley': return 'down then up'
    case 'oscillating': return 'oscillating'
    default: return 'variable'
  }
}

interface DynamicsDescription {
  summary: string
  startValue: string | null
  endValue: string | null
  pattern: string
  duration: string | null
}

function describeDynamics(dynamics: StageDynamics | undefined, stageType: string, variables?: ProfileVariable[]): DynamicsDescription {
  const unit = getTypeUnit(stageType)
  
  if (!dynamics || !dynamics.points || dynamics.points.length === 0) {
    return {
      summary: 'Static (no dynamics defined)',
      startValue: null,
      endValue: null,
      pattern: 'flat',
      duration: null
    }
  }
  
  const points = dynamics.points as [number | string, number | string][]
  const times = points.map(p => typeof p[0] === 'number' ? p[0] : null)
  const values = points.map(p => resolveValue(p[1], variables))
  
  const validValues = values.filter((v): v is number => v !== null)
  const validTimes = times.filter((t): t is number => t !== null)
  
  const startValue = validValues.length > 0 ? validValues[0] : null
  const endValue = validValues.length > 0 ? validValues[validValues.length - 1] : null
  const minValue = validValues.length > 0 ? Math.min(...validValues) : null
  const maxValue = validValues.length > 0 ? Math.max(...validValues) : null
  
  const pattern = analyzePattern(values)
  const patternDesc = getPatternDescription(pattern)
  const patternEmoji = getPatternEmoji(pattern)
  
  // Calculate duration
  let duration: string | null = null
  if (validTimes.length >= 2 && dynamics.over === 'time') {
    const totalTime = validTimes[validTimes.length - 1] - validTimes[0]
    duration = `${totalTime.toFixed(0)}s`
  } else if (dynamics.over === 'weight' && validTimes.length >= 2) {
    const weightRange = validTimes[validTimes.length - 1] - validTimes[0]
    duration = `${weightRange.toFixed(0)}g range`
  }
  
  // Build summary
  let summary = ''
  if (startValue !== null && endValue !== null) {
    if (pattern === 'flat') {
      summary = `${patternEmoji} Holds at ${startValue.toFixed(1)} ${unit}`
    } else if (pattern === 'ascending' || pattern === 'descending') {
      summary = `${patternEmoji} ${startValue.toFixed(1)} → ${endValue.toFixed(1)} ${unit} (${patternDesc})`
    } else if (pattern === 'peak' && maxValue !== null) {
      summary = `${patternEmoji} ${startValue.toFixed(1)} → ${maxValue.toFixed(1)} → ${endValue.toFixed(1)} ${unit}`
    } else if (pattern === 'valley' && minValue !== null) {
      summary = `${patternEmoji} ${startValue.toFixed(1)} → ${minValue.toFixed(1)} → ${endValue.toFixed(1)} ${unit}`
    } else if (pattern === 'oscillating' && minValue !== null && maxValue !== null) {
      summary = `${patternEmoji} Oscillates ${minValue.toFixed(1)}-${maxValue.toFixed(1)} ${unit}`
    } else {
      summary = `${patternEmoji} ${startValue.toFixed(1)} → ${endValue.toFixed(1)} ${unit} (${patternDesc})`
    }
  } else {
    summary = `${patternEmoji} Variable ${stageType} (uses variables)`
  }
  
  // Add interpolation info
  if (dynamics.interpolation === 'curve') {
    summary += ' (smooth)'
  }
  
  return {
    summary,
    startValue: startValue !== null ? `${startValue.toFixed(1)} ${unit}` : null,
    endValue: endValue !== null ? `${endValue.toFixed(1)} ${unit}` : null,
    pattern,
    duration
  }
}

function formatExitTriggers(triggers?: ExitTrigger[]): string | null {
  if (!triggers || triggers.length === 0) return null
  
  return triggers.map(t => {
    if (t.value !== undefined) {
      const unit = t.type === 'weight' ? 'g' : t.type === 'time' ? 's' : ''
      return `${t.type} ${t.comparison || '>='} ${t.value}${unit}`
    }
    return t.type
  }).join(', ')
}

function formatLimits(limits?: StageLimit[], variables?: ProfileVariable[]): string | null {
  if (!limits || limits.length === 0) return null
  
  return limits.map(l => {
    const unit = getTypeUnit(l.type)
    // Resolve variable references
    let displayValue: string
    if (typeof l.value === 'string' && l.value.startsWith('$')) {
      const resolved = resolveValue(l.value, variables)
      displayValue = resolved !== null ? resolved.toFixed(1) : l.value
    } else {
      displayValue = typeof l.value === 'number' ? l.value.toFixed(1) : String(l.value)
    }
    return `${l.type} ≤ ${displayValue}${unit ? ` ${unit}` : ''}`
  }).join(', ')
}

export function ProfileBreakdown({ profile, className = '' }: ProfileBreakdownProps) {
  // Memoize expensive variable calculations
  const { adjustableVars, infoVars, variableColorMap, variableUsage, warnings } = useMemo(() => {
    if (!profile) {
      return {
        adjustableVars: [] as ProfileVariable[],
        infoVars: [] as ProfileVariable[],
        variableColorMap: new Map<string, typeof VARIABLE_COLORS[0]>(),
        variableUsage: new Map<string, string[]>(),
        warnings: [] as ValidationWarning[]
      }
    }
    
    const hasVars = profile.variables && profile.variables.length > 0
    const hasStg = profile.stages && profile.stages.length > 0
    
    const adjustable = hasVars ? profile.variables!.filter(v => !v.key.startsWith('info_')) : []
    const info = hasVars ? profile.variables!.filter(v => v.key.startsWith('info_')) : []
    
    // Build color map
    const colorMap = new Map<string, typeof VARIABLE_COLORS[0]>()
    adjustable.forEach((v, idx) => {
      colorMap.set(v.key, VARIABLE_COLORS[idx % VARIABLE_COLORS.length])
    })
    
    // Find variable usage
    const usage = hasStg && hasVars ? findVariableUsage(profile.stages!, adjustable) : new Map<string, string[]>()
    
    // Validate variables
    const warns = hasVars ? validateVariables(profile.variables!, usage) : []
    
    return {
      adjustableVars: adjustable,
      infoVars: info,
      variableColorMap: colorMap,
      variableUsage: usage,
      warnings: warns
    }
  }, [profile])
  
  if (!profile) return null
  
  const hasBasicInfo = profile.temperature !== undefined || profile.final_weight !== undefined
  const hasVariables = profile.variables && profile.variables.length > 0
  const hasStages = profile.stages && profile.stages.length > 0
  
  if (!hasBasicInfo && !hasVariables && !hasStages) return null
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className={`space-y-3 ${className}`}
    >
      <Label className="text-sm font-semibold tracking-wide text-primary">
        Profile Details
      </Label>
      
      <div className="p-4 bg-secondary/60 rounded-xl border border-primary/20 space-y-4">
        {/* Temperature and Target Weight */}
        {hasBasicInfo && (
          <div className="flex flex-wrap gap-4">
            {profile.temperature !== undefined && (
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-red-500/15">
                  <Thermometer size={16} weight="bold" className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Temperature</p>
                  <p className="text-sm font-semibold">{profile.temperature}°C</p>
                </div>
              </div>
            )}
            
            {profile.final_weight !== undefined && (
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-green-500/15">
                  <Scales size={16} weight="bold" className="text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Target Weight</p>
                  <p className="text-sm font-semibold">{profile.final_weight}g</p>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Variables */}
        {hasVariables && (
          <div className="space-y-3">
            {/* Validation Warnings */}
            {warnings.length > 0 && (
              <div className="space-y-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center gap-1.5">
                  <Warning size={14} weight="bold" className="text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">Variable Issues</p>
                </div>
                <div className="space-y-1">
                  {warnings.map((warning, idx) => (
                    <p key={idx} className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                      • {warning.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
            
            {/* Info Variables - display as tips/recommendations */}
            {infoVars.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Info size={14} weight="bold" className="text-blue-600 dark:text-blue-400" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preparation</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {infoVars.map((variable, idx) => {
                    // Format the display value based on the variable type and key
                    let displayValue = ''
                    if (variable.type === 'weight') {
                      // Weight type displays as grams
                      displayValue = `${variable.value}g`
                    } else if (variable.type === 'flow') {
                      displayValue = `${variable.value} ml/s`
                    } else if (variable.type === 'pressure') {
                      displayValue = `${variable.value} bar`
                    } else if (variable.type === 'time') {
                      displayValue = `${variable.value}s`
                    } else if (variable.type === 'power') {
                      // Power type: 100 = true/yes, 0 = false/no
                      // Show percentage for clarity
                      if (variable.value === 100) {
                        displayValue = '✓'
                      } else if (variable.value === 0) {
                        displayValue = '' // Label already implies the action, e.g. "Use bottom filter"
                      } else {
                        displayValue = `${variable.value}%`
                      }
                    } else {
                      displayValue = String(variable.value)
                    }
                    
                    return (
                      <div 
                        key={idx}
                        className="px-2.5 py-1.5 rounded-lg border text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 whitespace-nowrap"
                      >
                        <span className="font-medium">{variable.name}</span>
                        {displayValue && (
                          <span className="opacity-80 ml-1.5">{displayValue}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/60 italic">
                  💡 Also visible in the Meticulous app under Profile Settings → Variables
                </p>
              </div>
            )}
            
            {/* Adjustable Variables */}
            {adjustableVars.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sliders size={14} weight="bold" className="text-muted-foreground shrink-0" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Adjustable Variables</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {adjustableVars.map((variable, idx) => {
                    const color = variableColorMap.get(variable.key) || VARIABLE_COLORS[0]
                    const usedInStages = variableUsage.get(variable.key) || []
                    
                    return (
                      <div 
                        key={idx}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs whitespace-nowrap ${color.bg} ${color.text} ${color.border}`}
                        title={usedInStages.length > 0 ? `Used in: ${usedInStages.join(', ')}` : 'Not used in any stage'}
                      >
                        {/* Color dot indicator */}
                        <span className={`inline-block w-2 h-2 rounded-full ${color.dot} mr-1.5`} />
                        <span className="font-medium">{variable.name}</span>
                        <span className="opacity-70 ml-1.5">
                          {variable.value}
                          {variable.type === 'pressure' && ' bar'}
                          {variable.type === 'flow' && ' ml/s'}
                          {variable.type === 'time' && 's'}
                        </span>
                        {usedInStages.length > 0 && (
                          <span className="ml-1.5 opacity-60 text-[10px]">
                            → {usedInStages.length} stage{usedInStages.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Stages */}
        {hasStages && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ListNumbers size={14} weight="bold" className="text-muted-foreground shrink-0" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Stages ({profile.stages!.length})
              </p>
            </div>
            <div className="space-y-2">
              {profile.stages!.map((stage, idx) => {
                const exitInfo = formatExitTriggers(stage.exit_triggers)
                const limitsInfo = formatLimits(stage.limits, profile.variables)
                // Normalize dynamics - handles both nested and flattened formats
                const normalizedDynamics = getNormalizedDynamics(stage)
                const dynamicsDesc = describeDynamics(normalizedDynamics, stage.type, profile.variables)
                
                // Find which variables are used in this stage using variableUsage map
                const usedVars = adjustableVars.filter(v => {
                  const stagesUsingVar = variableUsage.get(v.key) || []
                  return stagesUsingVar.includes(stage.name)
                })
                
                return (
                  <div 
                    key={idx}
                    className="p-2.5 rounded-lg bg-background/50 border border-border/30 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {getTypeIcon(stage.type)}
                        <span className="text-sm font-medium truncate">{stage.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Show colored variable badges used in this stage */}
                        {usedVars.map(v => {
                          const color = variableColorMap.get(v.key)
                          return (
                            <span 
                              key={v.key}
                              className={`w-2 h-2 rounded-full ${color?.dot}`}
                              title={`Uses ${v.name}`}
                            />
                          )
                        })}
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1.5 py-0 ${getTypeColor(stage.type)}`}
                        >
                          {stage.type}
                        </Badge>
                      </div>
                    </div>
                    
                    {/* Dynamics Summary - the main info about what this stage does */}
                    <p className="text-xs text-foreground/90">
                      {dynamicsDesc.summary}
                    </p>
                    
                    {/* Show which variables are used, with their colors */}
                    {usedVars.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {usedVars.map(v => {
                          const color = variableColorMap.get(v.key)
                          return (
                            <span 
                              key={v.key} 
                              className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${color?.bg} ${color?.text} border ${color?.border}`}
                            >
                              {v.name} = {v.value}{v.type === 'pressure' && ' bar'}{v.type === 'flow' && ' ml/s'}{v.type === 'time' && 's'}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    
                    {/* Additional details */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {dynamicsDesc.duration && (
                        <span className="flex items-center gap-1">
                          <Timer size={11} />
                          {dynamicsDesc.duration}
                        </span>
                      )}
                      {limitsInfo && (
                        <span className="text-amber-700/80 dark:text-amber-400/80 whitespace-nowrap">
                          Max: {limitsInfo}
                        </span>
                      )}
                      {exitInfo && (
                        <span className="text-green-700/80 dark:text-green-400/80 whitespace-nowrap">
                          Exit: {exitInfo}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
