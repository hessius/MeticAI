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
  { label: 'Pulse', category: 'process' }
] as const

export type TagCategory = typeof PRESET_TAGS[number]['category']

// Refined color palette - high contrast for readability
export const CATEGORY_COLORS: Record<TagCategory, string> = {
  body: 'bg-amber-100 border-amber-400/60 hover:bg-amber-200 hover:border-amber-500/70 text-amber-900 dark:bg-amber-500/20 dark:border-amber-500/40 dark:hover:bg-amber-500/30 dark:hover:border-amber-500/55 dark:text-amber-200',
  flavor: 'bg-rose-100 border-rose-400/60 hover:bg-rose-200 hover:border-rose-500/70 text-rose-900 dark:bg-rose-500/20 dark:border-rose-500/40 dark:hover:bg-rose-500/30 dark:hover:border-rose-500/55 dark:text-rose-200',
  mouthfeel: 'bg-sky-100 border-sky-400/60 hover:bg-sky-200 hover:border-sky-500/70 text-sky-900 dark:bg-sky-500/20 dark:border-sky-500/40 dark:hover:bg-sky-500/30 dark:hover:border-sky-500/55 dark:text-sky-200',
  style: 'bg-violet-100 border-violet-400/60 hover:bg-violet-200 hover:border-violet-500/70 text-violet-900 dark:bg-violet-500/20 dark:border-violet-500/40 dark:hover:bg-violet-500/30 dark:hover:border-violet-500/55 dark:text-violet-200',
  extraction: 'bg-emerald-100 border-emerald-400/60 hover:bg-emerald-200 hover:border-emerald-500/70 text-emerald-900 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:hover:bg-emerald-500/30 dark:hover:border-emerald-500/55 dark:text-emerald-200',
  roast: 'bg-orange-100 border-orange-400/60 hover:bg-orange-200 hover:border-orange-500/70 text-orange-900 dark:bg-orange-500/20 dark:border-orange-500/40 dark:hover:bg-orange-500/30 dark:hover:border-orange-500/55 dark:text-orange-200',
  characteristic: 'bg-teal-100 border-teal-400/60 hover:bg-teal-200 hover:border-teal-500/70 text-teal-900 dark:bg-teal-500/20 dark:border-teal-500/40 dark:hover:bg-teal-500/30 dark:hover:border-teal-500/55 dark:text-teal-200',
  process: 'bg-indigo-100 border-indigo-400/60 hover:bg-indigo-200 hover:border-indigo-500/70 text-indigo-900 dark:bg-indigo-500/20 dark:border-indigo-500/40 dark:hover:bg-indigo-500/30 dark:hover:border-indigo-500/55 dark:text-indigo-200',
}

export const CATEGORY_COLORS_SELECTED: Record<TagCategory, string> = {
  body: 'bg-amber-500/90 border-amber-400 text-white shadow-sm shadow-amber-500/25',
  flavor: 'bg-rose-500/90 border-rose-400 text-white shadow-sm shadow-rose-500/25',
  mouthfeel: 'bg-sky-500/90 border-sky-400 text-white shadow-sm shadow-sky-500/25',
  style: 'bg-violet-500/90 border-violet-400 text-white shadow-sm shadow-violet-500/25',
  extraction: 'bg-emerald-500/90 border-emerald-400 text-white shadow-sm shadow-emerald-500/25',
  roast: 'bg-orange-500/90 border-orange-400 text-white shadow-sm shadow-orange-500/25',
  characteristic: 'bg-teal-500/90 border-teal-400 text-white shadow-sm shadow-teal-500/25',
  process: 'bg-indigo-500/90 border-indigo-400 text-white shadow-sm shadow-indigo-500/25',
}

// Get category for a tag label
export function getTagCategory(label: string): TagCategory | null {
  const tag = PRESET_TAGS.find(t => t.label.toLowerCase() === label.toLowerCase())
  return tag ? tag.category : null
}

// Get color classes for a tag
export function getTagColorClass(label: string, selected = false): string {
  const category = getTagCategory(label)
  if (!category) return 'bg-gray-500/15 border-gray-500/35 text-gray-800 dark:text-gray-200'
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
