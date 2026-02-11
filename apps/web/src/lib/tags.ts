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

// Refined color palette - more subtle and professional
export const CATEGORY_COLORS: Record<TagCategory, string> = {
  body: 'bg-amber-500/15 border-amber-500/35 hover:bg-amber-500/25 hover:border-amber-500/50 text-amber-800 dark:text-amber-200',
  flavor: 'bg-rose-500/15 border-rose-500/35 hover:bg-rose-500/25 hover:border-rose-500/50 text-rose-800 dark:text-rose-200',
  mouthfeel: 'bg-sky-500/15 border-sky-500/35 hover:bg-sky-500/25 hover:border-sky-500/50 text-sky-800 dark:text-sky-200',
  style: 'bg-violet-500/15 border-violet-500/35 hover:bg-violet-500/25 hover:border-violet-500/50 text-violet-800 dark:text-violet-200',
  extraction: 'bg-emerald-500/15 border-emerald-500/35 hover:bg-emerald-500/25 hover:border-emerald-500/50 text-emerald-800 dark:text-emerald-200',
  roast: 'bg-orange-500/15 border-orange-500/35 hover:bg-orange-500/25 hover:border-orange-500/50 text-orange-800 dark:text-orange-200',
  characteristic: 'bg-teal-500/15 border-teal-500/35 hover:bg-teal-500/25 hover:border-teal-500/50 text-teal-800 dark:text-teal-200',
  process: 'bg-indigo-500/15 border-indigo-500/35 hover:bg-indigo-500/25 hover:border-indigo-500/50 text-indigo-800 dark:text-indigo-200',
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
