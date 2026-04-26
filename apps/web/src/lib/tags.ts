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
  if (lower.startsWith('target weight')) return 'tag-extraction'

  // Pressure reasons
  if (lower.startsWith('peak pressure')) return 'tag-process'

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
