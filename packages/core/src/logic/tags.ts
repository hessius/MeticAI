// Preset tags with categories for filtering and display
export const PRESET_TAGS = [
  { label: 'Light Body', category: 'body' },
  { label: 'Medium Body', category: 'body' },
  { label: 'Heavy Body', category: 'body' },
  { label: 'Florals', category: 'flavor' },
  { label: 'Acidity', category: 'flavor' },
  { label: 'Fruitiness', category: 'flavor' },
  { label: 'Chocolate', category: 'flavor' },
  { label: 'Nutty', category: 'flavor' },
  { label: 'Caramel', category: 'flavor' },
  { label: 'Berry', category: 'flavor' },
  { label: 'Citrus', category: 'flavor' },
  { label: 'Funky', category: 'flavor' },
  { label: 'Thin', category: 'mouthfeel' },
  { label: 'Mouthfeel', category: 'mouthfeel' },
  { label: 'Creamy', category: 'mouthfeel' },
  { label: 'Syrupy', category: 'mouthfeel' },
  { label: 'Italian', category: 'style' },
  { label: 'Modern', category: 'style' },
  { label: 'Lever', category: 'style' },
  { label: 'Long', category: 'extraction' },
  { label: 'Short', category: 'extraction' },
  { label: 'Turbo', category: 'extraction' },
  { label: 'Light Roast', category: 'roast' },
  { label: 'Medium Roast', category: 'roast' },
  { label: 'Dark Roast', category: 'roast' },
  { label: 'Sweet', category: 'characteristic' },
  { label: 'Balanced', category: 'characteristic' },
  { label: 'Bloom', category: 'process' },
  { label: 'Pre-infusion', category: 'process' },
  { label: 'Pulse', category: 'process' },
  // Technique tags (from structural analysis)
  { label: 'Pressure-controlled', category: 'technique' },
  { label: 'Flow-controlled', category: 'technique' },
  { label: 'Mixed-controlled', category: 'technique' },
  { label: 'Flat profile', category: 'technique' },
  { label: 'Ramp', category: 'technique' },
  { label: 'Decline', category: 'technique' },
  { label: 'Taper', category: 'technique' },
  // Temperature range tags
  { label: 'Very low temp (<82°C)', category: 'temperature' },
  { label: 'Low temp (82–84°C)', category: 'temperature' },
  { label: 'Warm (85–87°C)', category: 'temperature' },
  { label: 'Medium temp (88–90°C)', category: 'temperature' },
  { label: 'High temp (91–93°C)', category: 'temperature' },
  { label: 'Very high temp (94°C+)', category: 'temperature' },
  // Weight range tags
  { label: 'Ristretto (≤35g)', category: 'weight' },
  { label: 'Normale (36–44g)', category: 'weight' },
  { label: 'Lungo (45–54g)', category: 'weight' },
  { label: 'Allongé (55g+)', category: 'weight' },
  // Pressure range tags
  { label: 'Low pressure (≤4 bar)', category: 'pressure' },
  { label: 'Medium pressure (5–7 bar)', category: 'pressure' },
  { label: 'Standard pressure (8–9 bar)', category: 'pressure' },
  { label: 'High pressure (10+ bar)', category: 'pressure' },
  // Structural tags
  { label: 'Adaptive', category: 'technique' },
] as const

export type TagCategory = typeof PRESET_TAGS[number]['category']

// Refined color palette - high contrast for readability
// Uses custom CSS classes (defined in index.css) with .dark selector
// to bypass Tailwind v4 compat-mode media-query dark variant issue
export const CATEGORY_COLORS: Record<TagCategory, string> = {
  body: 'tag-body',
  flavor: 'tag-flavor',
  mouthfeel: 'tag-mouthfeel',
  style: 'tag-style',
  extraction: 'tag-extraction',
  roast: 'tag-roast',
  characteristic: 'tag-characteristic',
  process: 'tag-process',
  technique: 'tag-technique',
  temperature: 'tag-temperature',
  weight: 'tag-weight',
  pressure: 'tag-pressure',
}

export const CATEGORY_COLORS_SELECTED: Record<TagCategory, string> = {
  body: 'tag-body-selected text-white shadow-sm',
  flavor: 'tag-flavor-selected text-white shadow-sm',
  mouthfeel: 'tag-mouthfeel-selected text-white shadow-sm',
  style: 'tag-style-selected text-white shadow-sm',
  extraction: 'tag-extraction-selected text-white shadow-sm',
  roast: 'tag-roast-selected text-white shadow-sm',
  characteristic: 'tag-characteristic-selected text-white shadow-sm',
  process: 'tag-process-selected text-white shadow-sm',
  technique: 'tag-technique-selected text-white shadow-sm',
  temperature: 'tag-temperature-selected text-white shadow-sm',
  weight: 'tag-weight-selected text-white shadow-sm',
  pressure: 'tag-pressure-selected text-white shadow-sm',
}

// Get category for a tag label
export function getTagCategory(label: string): TagCategory | null {
  const tag = PRESET_TAGS.find(t => t.label.toLowerCase() === label.toLowerCase())
  return tag ? tag.category : null
}

// Get color classes for a tag
export function getTagColorClass(label: string, selected = false): string {
  const category = getTagCategory(label)
  if (!category) return 'tag-default'
  return selected ? CATEGORY_COLORS_SELECTED[category] : CATEGORY_COLORS[category]
}

// Extract known tags from a user preferences string
export function extractTagsFromPreferences(preferences: string | null): string[] {
  if (!preferences) return []
  
  const prefLower = preferences.toLowerCase()
  return PRESET_TAGS
    .filter(tag => prefLower.includes(tag.label.toLowerCase()))
    .map(tag => tag.label)
}

// Get all unique tags from history entries
export function getAllTagsFromEntries(entries: Array<{ user_preferences: string | null }>): string[] {
  const allTags = new Set<string>()

  entries.forEach(entry => {
    const tags = extractTagsFromPreferences(entry.user_preferences)
    tags.forEach(tag => allTags.add(tag))
  })

  return Array.from(allTags).sort()
}

// Sensory tag vocabulary the AI may infer during description generation (#400).
// Mirrors the flavor / mouthfeel / roast / body / characteristic categories;
// structural / temperature / weight / pressure tags are derived deterministically.
export const AI_TAG_LABELS: string[] = PRESET_TAGS.filter(t =>
  (['body', 'flavor', 'mouthfeel', 'roast', 'characteristic'] as TagCategory[]).includes(t.category)
).map(t => t.label)

const AI_TAG_LOOKUP = new Map(AI_TAG_LABELS.map(label => [label.toLowerCase(), label]))

// Instruction appended to AI description prompts to request sensory tags (#400).
export const AI_TAGS_PROMPT =
  '\n\nFinally, on a separate last line, output:\n' +
  'Tags: [comma-separated subset of EXACTLY these labels that match the ' +
  "coffee's likely sensory profile, or leave empty if unsure: " +
  AI_TAG_LABELS.join(', ') +
  ']\nOnly use labels from that list; do not invent new ones.'

// Extract and validate sensory tags from a generated description's `Tags:` line.
// Small on-device models often decorate the line with markdown (e.g. "**Tags:**"
// or "- Tags:"), so tolerate leading bullets/quotes and bold/italic markers.
// A single combined character class (whitespace + markdown markers) is used for
// each optional run so there is no ambiguous adjacency between two whitespace
// quantifiers (which would make the regex vulnerable to polynomial backtracking).
const TAGS_LINE_RE = /^[ \t>*+#_-]*Tags[ \t*_]*:(.*)$/im
const TAGS_LINE_STRIP_RE = /^[ \t>*+#_-]*Tags[ \t*_]*:.*$/gim

export function parseAiTags(text: string | null | undefined): string[] {
  if (!text) return []
  const match = text.match(TAGS_LINE_RE)
  if (!match) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of match[1].split(',')) {
    const stripped = raw.replace(/[[\]*_]/g, '').trim()
    // Strip trailing dots without regex backtracking (ReDoS-safe).
    let end = stripped.length
    while (end > 0 && stripped[end - 1] === '.') end--
    const candidate = stripped.slice(0, end).trim()
    const canonical = AI_TAG_LOOKUP.get(candidate.toLowerCase())
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical)
      result.push(canonical)
    }
  }
  return result
}

// Remove the trailing `Tags:` line from a generated description body.
export function stripTagsLine(text: string): string {
  if (!text) return text
  return text.replace(TAGS_LINE_STRIP_RE, '').replace(/\s+$/, '')
}

// Map a match reason string from the recommendation engine to a tag color class.
// Match reasons have patterns like "Pressure-controlled", "Techniques: bloom, preinfusion",
// "Flat profile", "Target weight: 36g", "Peak pressure: 9.0 bar", "High temp", "Matching: fruity, sweet"
export function getMatchReasonColorClass(reason: string): string {
  const lower = reason.toLowerCase()

  // Direct preset tag lookup first
  const directCategory = getTagCategory(reason)
  if (directCategory) return CATEGORY_COLORS[directCategory]

  // Control mode reasons
  if (lower.endsWith('-controlled')) return 'tag-technique'

  // Technique reasons (prefix or direct)
  if (lower.startsWith('techniques:') || lower === 'flat profile') return 'tag-technique'

  // Temperature range reasons
  if (lower.includes('temp')) return 'tag-temperature'

  // Weight reasons
  if (lower.startsWith('target weight') || lower.includes('ristretto') || lower.includes('normale') || lower.includes('lungo') || lower.includes('allongé')) return 'tag-weight'

  // Pressure reasons
  if (lower.startsWith('peak pressure') || lower.includes('pressure (')) return 'tag-pressure'

  // "Matching:" prefix — try to detect the category from the first matched tag
  if (lower.startsWith('matching:')) {
    const tags = reason.slice('matching:'.length).split(',').map(t => t.trim())
    for (const tag of tags) {
      const cat = getTagCategory(tag)
      if (cat) return CATEGORY_COLORS[cat]
    }
  }

  return 'tag-default'
}

// Get CSS class for a match score percentage badge
export function getScoreColorClass(score: number): string {
  if (score >= 75) return 'score-high'
  if (score >= 50) return 'score-good'
  if (score >= 25) return 'score-fair'
  return 'score-low'
}
