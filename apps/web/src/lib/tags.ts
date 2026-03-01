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
