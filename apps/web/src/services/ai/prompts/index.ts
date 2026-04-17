/**
 * TypeScript port of apps/server/prompt_builder.py
 *
 * Provides prompt construction for image generation, shot analysis,
 * profile generation, recommendations, and dial-in guidance.
 */

// ---------------------------------------------------------------------------
// Tag Influence System (condensed from Python 400+ lines)
// ---------------------------------------------------------------------------

interface TagInfluence {
  colors: string[]
  elements: string[]
  compositions: string[]
  moods: string[]
  textures: string[]
}

const ROAST_INFLUENCES: Record<string, TagInfluence> = {
  light: {
    colors: ['pale gold', 'honey amber', 'soft cream', 'light caramel', 'champagne'],
    elements: ['delicate wisps', 'ethereal light rays', 'morning dew', 'translucent layers'],
    compositions: ['airy open space', 'floating elements', 'ascending movement'],
    moods: ['bright', 'fresh', 'delicate', 'awakening'],
    textures: ['smooth gradients', 'soft edges', 'gossamer'],
  },
  medium: {
    colors: ['warm bronze', 'rich amber', 'toasted copper', 'chestnut brown', 'maple'],
    elements: ['balanced forms', 'interlocking shapes', 'flowing curves', 'harmonious patterns'],
    compositions: ['centered balance', 'symmetrical arrangement', 'golden ratio'],
    moods: ['balanced', 'comforting', 'approachable', 'harmonious'],
    textures: ['velvet', 'brushed metal', 'polished wood grain'],
  },
  dark: {
    colors: ['deep espresso', 'charcoal black', 'dark chocolate', 'midnight brown', 'obsidian'],
    elements: ['bold shadows', 'dramatic contrasts', 'dense forms', 'powerful shapes'],
    compositions: ['heavy bottom weight', 'grounded elements', 'strong verticals'],
    moods: ['intense', 'bold', 'mysterious', 'commanding'],
    textures: ['rough hewn', 'carbon fiber', 'volcanic rock'],
  },
}

const FLAVOR_INFLUENCES: Record<string, TagInfluence> = {
  fruity: {
    colors: ['berry purple', 'citrus orange', 'apple red', 'tropical yellow'],
    elements: ['organic spheres', 'juice droplets', 'curved petals'],
    compositions: ['scattered arrangement', 'bursting from center'],
    moods: ['vibrant', 'joyful', 'lively', 'refreshing'],
    textures: ['glossy', 'juicy sheen'],
  },
  chocolate: {
    colors: ['cocoa brown', 'dark truffle', 'milk chocolate', 'mocha cream'],
    elements: ['swirling ribbons', 'melting forms', 'layered depths'],
    compositions: ['flowing downward', 'cascading layers'],
    moods: ['indulgent', 'luxurious', 'comforting', 'rich'],
    textures: ['molten', 'silky smooth', 'velvety'],
  },
  nutty: {
    colors: ['hazelnut tan', 'almond beige', 'walnut brown', 'pecan amber'],
    elements: ['organic shapes', 'shell curves', 'natural fragments'],
    compositions: ['clustered groups', 'natural scatter'],
    moods: ['earthy', 'warm', 'rustic', 'wholesome'],
    textures: ['grainy', 'rough bark', 'cracked shell'],
  },
  floral: {
    colors: ['lavender purple', 'rose pink', 'jasmine white', 'violet blue'],
    elements: ['petal formations', 'blooming shapes', 'botanical patterns'],
    compositions: ['radial symmetry', 'garden-like arrangement'],
    moods: ['elegant', 'romantic', 'ethereal', 'graceful'],
    textures: ['silk', 'watercolor wash', 'pressed flower'],
  },
  spicy: {
    colors: ['cinnamon red', 'cardamom green', 'saffron gold', 'pepper black'],
    elements: ['sharp angles', 'radiating spikes', 'dynamic swirls'],
    compositions: ['explosive center', 'radiating outward'],
    moods: ['fiery', 'energetic', 'exotic', 'adventurous'],
    textures: ['crystalline', 'rough grind', 'volcanic'],
  },
  citrus: {
    colors: ['lemon yellow', 'lime green', 'orange zest', 'grapefruit pink'],
    elements: ['wedge shapes', 'droplets', 'zest curls', 'segment patterns'],
    compositions: ['bright focal point', 'radiating freshness'],
    moods: ['zesty', 'energizing', 'clean', 'sharp'],
    textures: ['peel texture', 'wet gloss', 'fizzy bubbles'],
  },
  caramel: {
    colors: ['golden caramel', 'butterscotch amber', 'toffee brown', 'dulce cream'],
    elements: ['flowing streams', 'pooling forms', 'glossy surfaces'],
    compositions: ['dripping downward', 'smooth flowing movement'],
    moods: ['sweet', 'warming', 'nostalgic', 'cozy'],
    textures: ['sticky gloss', 'smooth pour', 'crystallized sugar'],
  },
}

const ALL_INFLUENCES: Record<string, TagInfluence> = {
  ...ROAST_INFLUENCES,
  ...FLAVOR_INFLUENCES,
}

const STYLE_MODIFIERS: Record<string, Record<string, string[]>> = {
  abstract: {
    technique: ['bold geometric forms', 'fluid organic shapes', 'layered transparencies'],
    finish: ['gallery-quality presentation', 'museum-worthy composition'],
  },
  minimalist: {
    technique: ['clean precise lines', 'negative space mastery', 'essential forms only'],
    finish: ['zen-like simplicity', 'refined elegance'],
  },
  'pixel-art': {
    technique: ['carefully placed pixels', 'retro game aesthetic', 'dithered gradients'],
    finish: ['crisp pixel boundaries', 'nostalgic digital art'],
  },
  watercolor: {
    technique: ['wet-on-wet bleeding', 'controlled washes', 'luminous layering'],
    finish: ['paper texture visible', 'artistic imperfection'],
  },
  modern: {
    technique: ['clean vector shapes', 'bold flat colors', 'contemporary design'],
    finish: ['professional polish', 'design-forward aesthetic'],
  },
  vintage: {
    technique: ['aged patina effect', 'muted color palette', 'weathered textures'],
    finish: ['nostalgic warmth', 'timeless quality'],
  },
}

const CORE_SAFETY_CONSTRAINTS = [
  'No text, words, letters, or numbers.',
  'No realistic human faces.',
  'Abstract artistic interpretation.',
]

const CORE_COFFEE_THEMES = [
  'coffee and espresso essence',
  'brewing artistry',
  'coffee culture aesthetic',
  'espresso craft',
  'coffee bean origins',
  'the ritual of coffee',
  'coffee as art form',
]

const COMPOSITION_ENHANCERS = [
  'visually striking composition',
  'dynamic visual balance',
  'harmonious arrangement',
  'compelling focal point',
  'artistic visual flow',
]

const PROFILE_EMPHASIS_TECHNIQUES = [
  'as the conceptual heart of an artistic composition',
  'embodied through abstract visual storytelling',
  'as an artistic muse inspiring the entire piece',
  'translated into pure visual emotion and form',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomSelect<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function gatherFromInfluences(
  influences: TagInfluence[],
  field: keyof TagInfluence,
  count: number,
): string[] {
  const all = influences.flatMap(inf => inf[field])
  if (all.length === 0) return []
  return randomSelect([...new Set(all)], count)
}

// ---------------------------------------------------------------------------
// Exported prompt builders
// ---------------------------------------------------------------------------

export function buildImagePrompt(profileName: string, style: string, tags: string[]): string {
  const normalizedTags = tags.map(t => t.toLowerCase().trim())
  const influences = normalizedTags
    .map(t => ALL_INFLUENCES[t])
    .filter((inf): inf is TagInfluence => !!inf)

  const colors = gatherFromInfluences(influences, 'colors', 2)
  const elements = gatherFromInfluences(influences, 'elements', 2)
  const compositions = gatherFromInfluences(influences, 'compositions', 1)
  const moods = gatherFromInfluences(influences, 'moods', 2)
  const textures = gatherFromInfluences(influences, 'textures', 1)

  const styleData = STYLE_MODIFIERS[style.toLowerCase()] ?? STYLE_MODIFIERS.abstract
  const styleModifiers = Object.values(styleData).flatMap(opts => randomSelect(opts, 1))

  const coffeeTheme = randomSelect(CORE_COFFEE_THEMES, 1)[0]
  const compositionEnhancer = randomSelect(COMPOSITION_ENHANCERS, 1)[0]
  const profileEmphasis = randomSelect(PROFILE_EMPHASIS_TECHNIQUES, 1)[0]

  const parts: string[] = [
    'IMPORTANT: Generate an image with absolutely no text, words, letters, numbers, or typography of any kind',
    `"${profileName}" ${profileEmphasis}`,
    `${style} art style, ${styleModifiers.join(', ')}`,
  ]

  if (colors.length) parts.push(`color palette featuring ${colors.join(', ')}`)
  if (elements.length) parts.push(`incorporating ${elements.join(', ')}`)
  if (moods.length) parts.push(`${moods.join(', ')} atmosphere`)
  if (compositions.length) parts.push(compositions[0])
  parts.push(compositionEnhancer)
  if (textures.length) parts.push(`${textures[0]} textures`)
  parts.push(`evoking ${coffeeTheme}`)
  parts.push('square format')
  parts.push(...CORE_SAFETY_CONSTRAINTS)

  return parts.join('. ')
}

export function buildProfileSystemPrompt(
  preferences: string,
  tags: string[],
  advancedOptions?: Record<string, unknown>,
): string {
  const lines = [
    '# Coffee Profile Generation',
    '',
    'You are an expert barista and coffee scientist. Analyze the provided coffee bag image',
    'and generate a complete espresso profile in Meticulous OEPF JSON format.',
    '',
    '## Requirements',
    '- Extract: roast level, origin, flavor notes, processing method from the image',
    '- Generate a creative, punny profile name',
    '- Include a detailed description of the coffee and brewing approach',
    '- Create appropriate brewing stages (pre-infusion, extraction, etc.)',
    '- Set sensible temperature, pressure, flow rate values',
    '',
  ]

  if (preferences) {
    lines.push('## User Preferences', preferences, '')
  }

  if (tags.length) {
    lines.push(`## Tags: ${tags.join(', ')}`, '')
  }

  if (advancedOptions && Object.keys(advancedOptions).length) {
    lines.push('## Advanced Options')
    for (const [k, v] of Object.entries(advancedOptions)) {
      if (v !== undefined && v !== null) lines.push(`- ${k}: ${v}`)
    }
    lines.push('')
  }

  lines.push(
    '## Output Format',
    'Return a JSON object wrapped in ```json code fences with the complete OEPF profile.',
    'Include fields: name, author, temperature, final_weight, variables, stages.',
    'Each stage needs: name, type, dynamics (points array), exit triggers, limits.',
  )

  return lines.join('\n')
}

export function buildShotAnalysisPrompt(
  profileName: string,
  shotDate: string,
  shotFilename: string,
  profileDescription?: string,
): string {
  const lines = [
    '# Espresso Shot Analysis',
    '',
    `Profile: ${profileName}`,
    `Shot: ${shotDate}/${shotFilename}`,
  ]

  if (profileDescription) {
    lines.push(`Description: ${profileDescription}`)
  }

  lines.push(
    '',
    'Analyze this espresso shot and provide:',
    '1. **Overall Assessment** — quality rating and summary',
    '2. **Extraction Analysis** — pre-infusion, main extraction, decline phases',
    '3. **Temperature Performance** — stability and target adherence',
    '4. **Pressure & Flow** — consistency, channeling indicators',
    '5. **Recommendations** — specific, actionable improvements',
    '',
    'Format as clean Markdown with headers.',
  )

  return lines.join('\n')
}

export function buildRecommendationPrompt(
  profileName: string,
  shotFilename: string,
): string {
  return [
    '# Shot Recommendation Extraction',
    '',
    `Profile: ${profileName}`,
    `Shot: ${shotFilename}`,
    '',
    'Extract actionable recommendations from this shot analysis.',
    'Return a JSON array where each element has:',
    '- variable: the profile variable to change',
    '- current_value: current numeric value',
    '- recommended_value: suggested new value',
    '- stage: which brewing stage',
    '- confidence: "high" | "medium" | "low"',
    '- reason: brief explanation',
    '- is_patchable: true if the change can be applied automatically',
    '',
    'Wrap in ```json code fences.',
  ].join('\n')
}

function describeAxisValue(value: number, negLabel: string, posLabel: string): string {
  const abs = Math.abs(value)
  if (abs < 0.15) return 'Balanced'
  const intensity = abs < 0.4 ? 'Slightly' : abs < 0.7 ? 'Moderately' : 'Very'
  const direction = value > 0 ? posLabel : negLabel
  return `${intensity} ${direction}`
}

export function buildTasteContext(
  tasteX: number | null,
  tasteY: number | null,
  tasteDescriptors: string[] | null,
): string {
  const hasCoords = tasteX != null && tasteY != null
  const hasDesc = tasteDescriptors && tasteDescriptors.length > 0

  if (!hasCoords && !hasDesc) return ''

  const lines = [
    '',
    '## User Taste Feedback (Espresso Compass)',
    'The user reports this shot tasted:',
  ]

  if (hasCoords) {
    lines.push(`- Balance: ${describeAxisValue(tasteX!, 'Sour', 'Bitter')} (X: ${tasteX!.toFixed(2)})`)
    lines.push(`- Body: ${describeAxisValue(tasteY!, 'Weak/Thin', 'Strong/Heavy')} (Y: ${tasteY!.toFixed(2)})`)
  }

  if (hasDesc) {
    lines.push(`- Descriptors: ${tasteDescriptors!.join(', ')}`)
  }

  lines.push(
    '',
    '### Espresso Compass Domain Knowledge',
    '- Sour (negative X) typically indicates under-extraction → increase temperature, pressure, or contact time',
    '- Bitter (positive X) typically indicates over-extraction → decrease temperature, pressure, or contact time',
    '- Weak/Thin (negative Y) → increase dose or decrease water volume (lower ratio)',
    '- Strong/Heavy (positive Y) → decrease dose or increase water volume (higher ratio)',
  )

  return lines.join('\n')
}

interface DialInIteration {
  iteration_number: number
  taste: {
    x: number
    y: number
    descriptors?: string[]
    notes?: string
  }
  recommendations?: string[]
}

export function buildDialInPrompt(options?: {
  roastLevel?: string
  origin?: string
  process?: string
  roastDate?: string
  profileName?: string
  iterations?: DialInIteration[]
}): string {
  const lines = [
    '# Espresso Dial-In Recommendation',
    '',
    'You are an expert barista helping the user dial in a new bag of coffee.',
    'Analyse the coffee details and all taste-feedback iterations below,',
    'then provide **concrete, actionable** adjustment recommendations.',
    '',
    '## Coffee Details',
    `- Roast level: ${options?.roastLevel ?? 'Unknown'}`,
  ]

  if (options?.origin) lines.push(`- Origin: ${options.origin}`)
  if (options?.process) lines.push(`- Process: ${options.process}`)
  if (options?.roastDate) lines.push(`- Roast date: ${options.roastDate}`)
  if (options?.profileName) lines.push(`- Profile: ${options.profileName}`)

  if (options?.iterations?.length) {
    lines.push('', '## Taste Iteration History')
    for (const it of options.iterations) {
      const balanceDesc = describeAxisValue(it.taste.x, 'Sour', 'Bitter')
      const bodyDesc = describeAxisValue(it.taste.y, 'Weak/Thin', 'Strong/Heavy')
      lines.push(`### Iteration ${it.iteration_number}`)
      lines.push(`- Balance: ${balanceDesc} (X: ${it.taste.x.toFixed(2)})`)
      lines.push(`- Body: ${bodyDesc} (Y: ${it.taste.y.toFixed(2)})`)
      if (it.taste.descriptors?.length) {
        lines.push(`- Descriptors: ${it.taste.descriptors.join(', ')}`)
      }
      if (it.taste.notes) {
        lines.push(`- Notes: ${it.taste.notes}`)
      }
      if (it.recommendations?.length) {
        lines.push(`- Previous recommendations: ${it.recommendations.join('; ')}`)
      }
    }
  }

  lines.push(
    '',
    '## Instructions',
    'Return a JSON object with a single key `recommendations` whose value is',
    'an array of short, actionable recommendation strings (max 6).',
    'Each recommendation should be a single sentence describing one specific',
    "adjustment (e.g. 'Grind 2 steps finer', 'Reduce dose by 0.5 g').",
    'Consider the full iteration history to track progress and avoid repeating',
    'adjustments that did not help. Base your reasoning on extraction science:',
    '- Sour → under-extracted → finer grind, higher temp, longer pre-infusion',
    '- Bitter → over-extracted → coarser grind, lower temp, shorter contact',
    '- Weak → increase dose or decrease yield',
    '- Strong → decrease dose or increase yield',
  )

  return lines.join('\n')
}
