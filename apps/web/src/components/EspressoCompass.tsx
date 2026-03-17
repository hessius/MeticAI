import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Info, Warning, ArrowRight, Crosshair, Eraser } from '@phosphor-icons/react'

// --- BH Compass Descriptors ---
// Each descriptor is mapped to (x, y) coordinates based on the Barista Hustle Espresso Compass.
// X-Axis: -1 (under-extracted) to +1 (over-extracted)
// Y-Axis: -1 (weak/thin) to +1 (strong/heavy)
type Zone = 'sweet' | 'under' | 'over' | 'strong' | 'weak'
interface Descriptor { word: string; x: number; y: number; zone: Zone }

const DESCRIPTORS = ([
  // Sour / Under-extracted quadrant
  { word: 'Overwhelming', x: -1.0, y: 0.8, zone: 'under' },
  { word: 'Intense Sour', x: -0.8, y: 0.6, zone: 'under' },
  { word: 'Salty', x: -0.8, y: 0.8, zone: 'under' },
  { word: 'Sour', x: -0.9, y: 0.5, zone: 'under' },
  { word: 'Generic', x: -0.7, y: 0.0, zone: 'under' },
  { word: 'Quick Finish', x: -0.8, y: -0.2, zone: 'under' },
  { word: 'Bland', x: -0.6, y: -0.4, zone: 'under' },
  { word: 'Thin', x: -0.4, y: -0.5, zone: 'weak' },
  // Strong / Heavy
  { word: 'Strong', x: -0.2, y: 0.8, zone: 'strong' },
  { word: 'Thick', x: 0.0, y: 0.9, zone: 'strong' },
  { word: 'Robust', x: -0.1, y: 0.7, zone: 'strong' },
  { word: 'Plump', x: 0.0, y: 0.6, zone: 'strong' },
  { word: 'Substantial', x: -0.2, y: 0.4, zone: 'strong' },
  // Sweet Spot (Center)
  { word: 'Balanced', x: 0.0, y: 0.0, zone: 'sweet' },
  { word: 'Ripe', x: -0.1, y: -0.1, zone: 'sweet' },
  { word: 'Tasty', x: 0.0, y: -0.2, zone: 'sweet' },
  { word: 'Transparent', x: 0.1, y: 0.4, zone: 'sweet' },
  { word: 'Sweet', x: 0.2, y: 0.3, zone: 'sweet' },
  { word: 'Luscious', x: 0.3, y: 0.2, zone: 'sweet' },
  { word: 'Rich', x: 0.2, y: 0.1, zone: 'sweet' },
  { word: 'Creamy', x: 0.3, y: 0.0, zone: 'sweet' },
  { word: 'Fruity', x: 0.4, y: -0.1, zone: 'sweet' },
  { word: 'Nuanced', x: 0.3, y: -0.2, zone: 'sweet' },
  { word: 'Fluffy', x: 0.2, y: -0.3, zone: 'sweet' },
  // Weak
  { word: 'Light', x: 0.0, y: -0.4, zone: 'weak' },
  { word: 'Slender', x: 0.3, y: -0.5, zone: 'weak' },
  { word: 'Delicate', x: 0.4, y: -0.6, zone: 'weak' },
  { word: 'Watery', x: 0.0, y: -1.0, zone: 'weak' },
  // Bitter / Over-extracted
  { word: 'Bitter', x: 0.8, y: -0.5, zone: 'over' },
  { word: 'Dry', x: 0.7, y: -0.7, zone: 'over' },
  { word: 'Powdery', x: 0.6, y: -0.6, zone: 'over' },
  { word: 'Empty', x: 0.9, y: -0.8, zone: 'over' },
] satisfies Descriptor[]).sort((a, b) => a.word.localeCompare(b.word))

// --- Color helpers ---
const ZONE_COLORS = {
  sweet: {
    normal: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25',
    selected: 'bg-emerald-500 text-white border-emerald-600',
  },
  under: {
    normal: 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25',
    selected: 'bg-amber-500 text-white border-amber-600',
  },
  over: {
    normal: 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25',
    selected: 'bg-red-500 text-white border-red-600',
  },
  strong: {
    normal: 'bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25',
    selected: 'bg-purple-500 text-white border-purple-600',
  },
  weak: {
    normal: 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25',
    selected: 'bg-blue-500 text-white border-blue-600',
  },
} as const

function getDescriptorColor(d: Descriptor): string {
  return ZONE_COLORS[d.zone]?.normal ?? 'bg-secondary/60 text-muted-foreground border-border/40 hover:bg-secondary/80'
}

function getSelectedColor(d: Descriptor): string {
  return ZONE_COLORS[d.zone]?.selected ?? 'bg-foreground text-background border-foreground'
}

// --- Analysis ---
interface Analysis {
  x: number
  y: number
  titleKey: string
  adviceKeys: { descKey: string; adviceKey: string }[]
  statusColor: string
  isUneven: boolean
}

function analyzeDescriptors(selected: string[]): Analysis | null {
  if (selected.length === 0) return null

  let sumX = 0, sumY = 0

  const hasUnder = selected.some(w => {
    const d = DESCRIPTORS.find(dd => dd.word === w)
    return d && d.x < -0.5
  })
  const hasOver = selected.some(w => {
    const d = DESCRIPTORS.find(dd => dd.word === w)
    return d && d.x > 0.5
  })
  const isUneven = hasUnder && hasOver

  selected.forEach(word => {
    const item = DESCRIPTORS.find(d => d.word === word)
    if (item) { sumX += item.x; sumY += item.y }
  })

  const avgX = sumX / selected.length
  const avgY = sumY / selected.length

  const adviceKeys: { descKey: string; adviceKey: string }[] = []
  let titleKey = 'espressoCompass.analysis.sweetSpot'
  let statusColor = 'text-emerald-400'

  if (isUneven) {
    titleKey = 'espressoCompass.analysis.unevenExtraction'
    statusColor = 'text-amber-400'
    adviceKeys.push({ descKey: 'espressoCompass.analysis.unevenDesc', adviceKey: 'espressoCompass.analysis.unevenAdvice' })
  } else {
    if (avgX < -0.3) {
      titleKey = 'espressoCompass.analysis.underExtracted'
      statusColor = 'text-amber-400'
      adviceKeys.push({ descKey: 'espressoCompass.analysis.underDesc', adviceKey: 'espressoCompass.analysis.underAdvice' })
    } else if (avgX > 0.4) {
      titleKey = 'espressoCompass.analysis.overExtracted'
      statusColor = 'text-red-400'
      adviceKeys.push({ descKey: 'espressoCompass.analysis.overDesc', adviceKey: 'espressoCompass.analysis.overAdvice' })
    }

    if (avgY > 0.4) {
      if (titleKey === 'espressoCompass.analysis.sweetSpot') {
        titleKey = 'espressoCompass.analysis.tooConcentrated'
        statusColor = 'text-purple-400'
      }
      adviceKeys.push({ descKey: 'espressoCompass.analysis.strongDesc', adviceKey: 'espressoCompass.analysis.strongAdvice' })
    } else if (avgY < -0.4) {
      if (titleKey === 'espressoCompass.analysis.sweetSpot') {
        titleKey = 'espressoCompass.analysis.lackingBody'
        statusColor = 'text-blue-400'
      }
      adviceKeys.push({ descKey: 'espressoCompass.analysis.weakDesc', adviceKey: 'espressoCompass.analysis.weakAdvice' })
    }

    if (adviceKeys.length === 0) {
      adviceKeys.push({ descKey: 'espressoCompass.analysis.sweetSpotDesc', adviceKey: 'espressoCompass.analysis.sweetSpotAdvice' })
    }
  }

  return { x: avgX, y: avgY, titleKey, adviceKeys, statusColor, isUneven }
}

// --- Component ---
interface EspressoCompassProps {
  onBack: () => void
}

export function EspressoCompass({ onBack }: EspressoCompassProps) {
  const { t } = useTranslation()
  const [selectedWords, setSelectedWords] = useState<string[]>([])

  const toggleWord = (word: string) => {
    setSelectedWords(prev =>
      prev.includes(word) ? prev.filter(w => w !== word) : [...prev, word]
    )
  }

  const analysis = useMemo(() => analyzeDescriptors(selectedWords), [selectedWords])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h2 className="text-xl font-bold">{t('espressoCompass.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('espressoCompass.subtitle')}</p>
        </div>
      </div>

      {/* Descriptor Selection */}
      <Card className="p-5 border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <Crosshair size={18} className="text-muted-foreground" />
          <h3 className="font-semibold text-sm">{t('espressoCompass.whatTasting')}</h3>
          {selectedWords.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs text-muted-foreground"
              onClick={() => setSelectedWords([])}
            >
              <Eraser size={14} className="mr-1" />
              {t('espressoCompass.clear')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {DESCRIPTORS.map((item) => {
            const isSelected = selectedWords.includes(item.word)
            return (
              <button
                key={item.word}
                onClick={() => toggleWord(item.word)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 border cursor-pointer ${
                  isSelected
                    ? getSelectedColor(item)
                    : getDescriptorColor(item)
                }`}
              >
                {item.word}
              </button>
            )
          })}
        </div>
      </Card>

      {/* Flavor Map + Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Compass Visualization */}
        <Card className="p-5 border-border/40 flex flex-col items-center">
          <h3 className="font-semibold text-sm w-full mb-4">{t('espressoCompass.flavorMap')}</h3>
          <div className="relative w-full max-w-[280px] aspect-square">
            {/* Background quadrants */}
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded-xl overflow-hidden">
              <div className="bg-amber-500/10 border-r border-b border-border/20" />
              <div className="bg-red-500/10 border-b border-border/20" />
              <div className="bg-blue-500/10 border-r border-border/20" />
              <div className="bg-purple-500/10" />
            </div>

            {/* Axes */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-full h-px bg-border/40 absolute" />
              <div className="h-full w-px bg-border/40 absolute" />
            </div>

            {/* Sweet spot zone */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-1/3 h-1/3 bg-emerald-500/15 rounded-full border border-emerald-500/30" />
            </div>

            {/* Axis labels */}
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('espressoCompass.strong')}</span>
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('espressoCompass.weak')}</span>
            <span className="absolute top-1/2 -left-1 -translate-y-1/2 -rotate-90 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{t('espressoCompass.under')}</span>
            <span className="absolute top-1/2 -right-1 -translate-y-1/2 rotate-90 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{t('espressoCompass.over')}</span>

            {/* Plotted point */}
            <AnimatePresence>
              {analysis && (
                analysis.isUneven ? (
                  // Uneven extraction: show warning indicator instead of misleading center dot
                  <motion.div
                    key="uneven"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="absolute w-6 h-6 bg-amber-500 rounded-full shadow-lg z-10 flex items-center justify-center"
                    style={{
                      left: `${((analysis.x + 1) / 2) * 100}%`,
                      top: `${((1 - analysis.y) / 2) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <Warning size={14} weight="fill" className="text-white" />
                    <div className="absolute inset-0 bg-amber-500 rounded-full animate-ping opacity-20" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="point"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="absolute w-4 h-4 bg-foreground rounded-full shadow-lg z-10"
                    style={{
                      left: `${((analysis.x + 1) / 2) * 100}%`,
                      top: `${((1 - analysis.y) / 2) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="absolute inset-0 bg-foreground rounded-full animate-ping opacity-20" />
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* Analysis / Advice */}
        <Card className="p-5 border-border/40">
          <AnimatePresence mode="wait">
            {analysis ? (
              <motion.div
                key={analysis.titleKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className={`text-lg font-bold mb-3 flex items-center gap-2 ${analysis.statusColor}`}>
                  {analysis.isUneven && <Warning size={20} weight="fill" />}
                  {t(analysis.titleKey)}
                </h3>
                <div className="space-y-3">
                  {analysis.adviceKeys.map((pair, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="text-sm leading-relaxed text-muted-foreground">
                        {t(pair.descKey)}
                      </div>
                      <div className="text-sm leading-relaxed bg-secondary/40 p-3 rounded-lg flex items-start gap-2">
                        <ArrowRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span>{t(pair.adviceKey)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center text-center text-muted-foreground/50 py-8 space-y-3"
              >
                <Crosshair size={48} weight="duotone" />
                <p className="text-sm">{t('espressoCompass.emptyState')}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      {/* General Tips */}
      <Card className="p-5 border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-muted-foreground" />
          <h3 className="font-semibold text-sm">{t('espressoCompass.goldenRulesTitle')}</h3>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc ml-5">
          <li dangerouslySetInnerHTML={{ __html: t('espressoCompass.ruleStartSimple') }} />
          <li dangerouslySetInnerHTML={{ __html: t('espressoCompass.ruleDontChangeDose') }} />
          <li>{t('espressoCompass.ruleYieldTime')}</li>
          <li>{t('espressoCompass.ruleEvenExtraction')}</li>
          <li>{t('espressoCompass.rulePreciseControl')}</li>
        </ul>
      </Card>

      {/* Attribution */}
      <p className="text-xs text-muted-foreground/60 text-center px-4" dangerouslySetInnerHTML={{ __html: t('espressoCompass.attribution') }} />
    </motion.div>
  )
}
