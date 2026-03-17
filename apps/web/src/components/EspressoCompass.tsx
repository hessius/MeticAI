import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Info, Warning, ArrowRight, Crosshair, Eraser } from '@phosphor-icons/react'

// --- BH Compass Descriptors ---
// Each descriptor is mapped to (x, y) coordinates based on the Barista Hustle Espresso Compass.
// X-Axis: -1 (under-extracted) to +1 (over-extracted)
// Y-Axis: -1 (weak/thin) to +1 (strong/heavy)
const DESCRIPTORS = [
  // Sour / Under-extracted quadrant
  { word: 'Overwhelming', x: -1.0, y: 0.8 },
  { word: 'Intense Sour', x: -0.8, y: 0.6 },
  { word: 'Salty', x: -0.8, y: 0.8 },
  { word: 'Sour', x: -0.9, y: 0.5 },
  { word: 'Generic', x: -0.7, y: 0.0 },
  { word: 'Quick Finish', x: -0.8, y: -0.2 },
  { word: 'Bland', x: -0.6, y: -0.4 },
  { word: 'Thin', x: -0.4, y: -0.5 },
  // Strong / Heavy
  { word: 'Strong', x: -0.2, y: 0.8 },
  { word: 'Thick', x: 0.0, y: 0.9 },
  { word: 'Robust', x: -0.1, y: 0.7 },
  { word: 'Plump', x: 0.0, y: 0.6 },
  { word: 'Substantial', x: -0.2, y: 0.4 },
  // Sweet Spot (Center)
  { word: 'Balanced', x: 0.0, y: 0.0 },
  { word: 'Ripe', x: -0.1, y: -0.1 },
  { word: 'Tasty', x: 0.0, y: -0.2 },
  { word: 'Transparent', x: 0.1, y: 0.4 },
  { word: 'Sweet', x: 0.2, y: 0.3 },
  { word: 'Luscious', x: 0.3, y: 0.2 },
  { word: 'Rich', x: 0.2, y: 0.1 },
  { word: 'Creamy', x: 0.3, y: 0.0 },
  { word: 'Fruity', x: 0.4, y: -0.1 },
  { word: 'Nuanced', x: 0.3, y: -0.2 },
  { word: 'Fluffy', x: 0.2, y: -0.3 },
  // Weak
  { word: 'Light', x: 0.0, y: -0.4 },
  { word: 'Slender', x: 0.3, y: -0.5 },
  { word: 'Delicate', x: 0.4, y: -0.6 },
  { word: 'Watery', x: 0.0, y: -1.0 },
  // Bitter / Over-extracted
  { word: 'Bitter', x: 0.8, y: -0.5 },
  { word: 'Dry', x: 0.7, y: -0.7 },
  { word: 'Powdery', x: 0.6, y: -0.6 },
  { word: 'Empty', x: 0.9, y: -0.8 },
].sort((a, b) => a.word.localeCompare(b.word))

// --- Color helpers ---
function getDescriptorColor(d: { x: number; y: number }): string {
  // Sweet spot area — green
  if (Math.abs(d.x) < 0.35 && Math.abs(d.y) < 0.35) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
  // Under-extracted — amber/yellow
  if (d.x < -0.3) return 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
  // Over-extracted — red
  if (d.x > 0.3) return 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
  // Strong — purple
  if (d.y > 0.3) return 'bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25'
  // Weak — blue
  if (d.y < -0.3) return 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25'
  return 'bg-secondary/60 text-muted-foreground border-border/40 hover:bg-secondary/80'
}

function getSelectedColor(d: { x: number; y: number }): string {
  if (Math.abs(d.x) < 0.35 && Math.abs(d.y) < 0.35) return 'bg-emerald-500 text-white border-emerald-600'
  if (d.x < -0.3) return 'bg-amber-500 text-white border-amber-600'
  if (d.x > 0.3) return 'bg-red-500 text-white border-red-600'
  if (d.y > 0.3) return 'bg-purple-500 text-white border-purple-600'
  if (d.y < -0.3) return 'bg-blue-500 text-white border-blue-600'
  return 'bg-foreground text-background border-foreground'
}

// --- Analysis ---
interface Analysis {
  x: number
  y: number
  title: string
  advice: { text: string; isAction: boolean }[]
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

  const advice: { text: string; isAction: boolean }[] = []
  let title = 'In the Sweet Spot'
  let statusColor = 'text-emerald-400'

  if (isUneven) {
    title = 'Uneven Extraction'
    statusColor = 'text-amber-400'
    advice.push({
      text: 'You\'re tasting both sourness and bitterness simultaneously — a classic sign of channeling (water finding paths of least resistance through the puck).',
      isAction: false,
    })
    advice.push({
      text: 'Focus on puck preparation before changing your profile. Use a WDT tool to distribute grounds evenly, and ensure a perfectly level tamp. On the Meticulous, also verify that the pre-infusion stage has enough time to saturate the puck evenly.',
      isAction: true,
    })
  } else {
    // Extraction axis
    if (avgX < -0.3) {
      title = 'Under-Extracted'
      statusColor = 'text-amber-400'
      advice.push({
        text: 'The shot is under-extracted — too much acidity is coming through before the sweet and balanced compounds can dissolve.',
        isAction: false,
      })
      advice.push({
        text: 'In your Meticulous profile, try increasing the target volume/yield to allow more water through the puck. You can also try increasing the water temperature by 1–2°C. If extraction is severely low, grind finer.',
        isAction: true,
      })
    } else if (avgX > 0.4) {
      title = 'Over-Extracted'
      statusColor = 'text-red-400'
      advice.push({
        text: 'The espresso is over-extracted — bitter, dry, and harsh compounds from late in the extraction are dominating.',
        isAction: false,
      })
      advice.push({
        text: 'In your Meticulous profile, reduce the target volume/yield so the shot ends earlier. You can also try decreasing the temperature by 1–2°C. If severely over-extracted, grind coarser.',
        isAction: true,
      })
    }

    // Strength axis
    if (avgY > 0.4) {
      if (title === 'In the Sweet Spot') {
        title = 'Too Concentrated'
        statusColor = 'text-purple-400'
      }
      advice.push({
        text: 'The shot is very dense and intense — the concentration is high.',
        isAction: false,
      })
      advice.push({
        text: 'In your Meticulous profile, increase the target volume so more water passes through, diluting the concentration. This shifts the brew ratio toward a longer shot.',
        isAction: true,
      })
    } else if (avgY < -0.4) {
      if (title === 'In the Sweet Spot') {
        title = 'Lacking Body'
        statusColor = 'text-blue-400'
      }
      advice.push({
        text: 'The shot feels thin or watery — it lacks the syrupy body expected from espresso.',
        isAction: false,
      })
      advice.push({
        text: 'In your Meticulous profile, decrease the target volume so less water passes through, concentrating the flavors. You can also slightly increase the dose.',
        isAction: true,
      })
    }

    if (advice.length === 0) {
      advice.push({
        text: 'You\'re right in the sweet spot! The extraction and strength are well-balanced.',
        isAction: false,
      })
      advice.push({
        text: 'Any further changes are up to personal preference. Try small tweaks — ±0.5°C temperature or ±1g yield — to explore the flavors of your coffee.',
        isAction: true,
      })
    }
  }

  return { x: avgX, y: avgY, title, advice, statusColor, isUneven }
}

// --- Component ---
interface EspressoCompassProps {
  onBack: () => void
}

export function EspressoCompass({ onBack }: EspressoCompassProps) {
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
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h2 className="text-xl font-bold">Espresso Compass</h2>
          <p className="text-sm text-muted-foreground">Select the flavors you&apos;re tasting to get dialing-in advice.</p>
        </div>
      </div>

      {/* Descriptor Selection */}
      <Card className="p-5 border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <Crosshair size={18} className="text-muted-foreground" />
          <h3 className="font-semibold text-sm">What are you tasting?</h3>
          {selectedWords.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs text-muted-foreground"
              onClick={() => setSelectedWords([])}
            >
              <Eraser size={14} className="mr-1" />
              Clear
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
          <h3 className="font-semibold text-sm w-full mb-4">Flavor Map</h3>
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
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Strong</span>
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Weak</span>
            <span className="absolute top-1/2 -left-1 -translate-y-1/2 -rotate-90 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Under</span>
            <span className="absolute top-1/2 -right-1 -translate-y-1/2 rotate-90 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Over</span>

            {/* Plotted point */}
            <AnimatePresence>
              {analysis && (
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
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* Analysis / Advice */}
        <Card className="p-5 border-border/40">
          <AnimatePresence mode="wait">
            {analysis ? (
              <motion.div
                key={analysis.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className={`text-lg font-bold mb-3 flex items-center gap-2 ${analysis.statusColor}`}>
                  {analysis.isUneven && <Warning size={20} weight="fill" />}
                  {analysis.title}
                </h3>
                <div className="space-y-3">
                  {analysis.advice.map((item, idx) => (
                    <div
                      key={idx}
                      className={`text-sm leading-relaxed ${
                        item.isAction
                          ? 'bg-secondary/40 p-3 rounded-lg flex items-start gap-2'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {item.isAction && <ArrowRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                      <span>{item.text}</span>
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
                <p className="text-sm">Select flavors above to analyze your shot and get dialing-in advice.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      {/* General Tips */}
      <Card className="p-5 border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-muted-foreground" />
          <h3 className="font-semibold text-sm">Golden Rules for the Meticulous</h3>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc ml-5">
          <li>When adjusting yield (target volume in your profile), <strong className="text-foreground">don&apos;t change the dose</strong> in your portafilter — only change the profile.</li>
          <li>Changing yield will inherently change your shot time. Only adjust grind size if your shot time is completely out of expected range.</li>
          <li>A perfectly even extraction creates a larger &quot;sweet spot&quot; to work within — focus on puck prep first.</li>
          <li>The Meticulous gives you precise control over pressure and flow profiles. Use that power to extend or shorten specific stages rather than only adjusting grind.</li>
        </ul>
      </Card>

      {/* Attribution */}
      <p className="text-xs text-muted-foreground/60 text-center px-4">
        Conceptually inspired by the <span className="font-medium text-muted-foreground/80">Espresso Compass by Barista Hustle</span>. Adapted for the Meticulous espresso machine.
      </p>
    </motion.div>
  )
}
