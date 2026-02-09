import { describe, it, expect } from 'vitest'
import { 
  PRESET_TAGS,
  CATEGORY_COLORS,
  CATEGORY_COLORS_SELECTED,
  getTagCategory,
  getTagColorClass,
  extractTagsFromPreferences,
  getAllTagsFromEntries
} from './tags'

describe('tags', () => {
  describe('PRESET_TAGS', () => {
    it('should have all expected categories', () => {
      const categories = new Set(PRESET_TAGS.map(t => t.category))
      expect(categories).toContain('body')
      expect(categories).toContain('flavor')
      expect(categories).toContain('mouthfeel')
      expect(categories).toContain('style')
      expect(categories).toContain('extraction')
      expect(categories).toContain('roast')
      expect(categories).toContain('characteristic')
      expect(categories).toContain('process')
    })

    it('should have unique labels', () => {
      const labels = PRESET_TAGS.map(t => t.label)
      const uniqueLabels = new Set(labels)
      expect(uniqueLabels.size).toBe(labels.length)
    })

    it('should contain expected tags', () => {
      const labels = PRESET_TAGS.map(t => t.label)
      expect(labels).toContain('Light Body')
      expect(labels).toContain('Florals')
      expect(labels).toContain('Creamy')
      expect(labels).toContain('Italian')
      expect(labels).toContain('Turbo')
      expect(labels).toContain('Light Roast')
      expect(labels).toContain('Balanced')
      expect(labels).toContain('Pre-infusion')
    })
  })

  describe('CATEGORY_COLORS', () => {
    it('should have colors for all categories', () => {
      const categories = new Set(PRESET_TAGS.map(t => t.category))
      categories.forEach(category => {
        expect(CATEGORY_COLORS[category]).toBeDefined()
        expect(typeof CATEGORY_COLORS[category]).toBe('string')
      })
    })

    it('should include background, border and text classes', () => {
      Object.values(CATEGORY_COLORS).forEach(colorClass => {
        expect(colorClass).toMatch(/bg-/)
        expect(colorClass).toMatch(/border-/)
        expect(colorClass).toMatch(/text-/)
      })
    })
  })

  describe('CATEGORY_COLORS_SELECTED', () => {
    it('should have colors for all categories', () => {
      const categories = new Set(PRESET_TAGS.map(t => t.category))
      categories.forEach(category => {
        expect(CATEGORY_COLORS_SELECTED[category]).toBeDefined()
        expect(typeof CATEGORY_COLORS_SELECTED[category]).toBe('string')
      })
    })

    it('should include solid background colors', () => {
      Object.values(CATEGORY_COLORS_SELECTED).forEach(colorClass => {
        expect(colorClass).toMatch(/bg-\w+-500/)
        expect(colorClass).toMatch(/text-white/)
      })
    })
  })

  describe('getTagCategory', () => {
    it('should return correct category for known tags', () => {
      expect(getTagCategory('Light Body')).toBe('body')
      expect(getTagCategory('Florals')).toBe('flavor')
      expect(getTagCategory('Creamy')).toBe('mouthfeel')
      expect(getTagCategory('Italian')).toBe('style')
      expect(getTagCategory('Turbo')).toBe('extraction')
      expect(getTagCategory('Light Roast')).toBe('roast')
      expect(getTagCategory('Sweet')).toBe('characteristic')
      expect(getTagCategory('Bloom')).toBe('process')
    })

    it('should be case-insensitive', () => {
      expect(getTagCategory('light body')).toBe('body')
      expect(getTagCategory('LIGHT BODY')).toBe('body')
      expect(getTagCategory('Light BODY')).toBe('body')
    })

    it('should return null for unknown tags', () => {
      expect(getTagCategory('Unknown Tag')).toBeNull()
      expect(getTagCategory('')).toBeNull()
      expect(getTagCategory('Random')).toBeNull()
    })
  })

  describe('getTagColorClass', () => {
    it('should return correct color class for known tags', () => {
      const colorClass = getTagColorClass('Light Body', false)
      expect(colorClass).toBe(CATEGORY_COLORS.body)
    })

    it('should return selected color class when selected is true', () => {
      const colorClass = getTagColorClass('Light Body', true)
      expect(colorClass).toBe(CATEGORY_COLORS_SELECTED.body)
    })

    it('should return gray fallback for unknown tags', () => {
      const colorClass = getTagColorClass('Unknown Tag', false)
      expect(colorClass).toMatch(/bg-gray/)
      expect(colorClass).toMatch(/border-gray/)
      expect(colorClass).toMatch(/text-gray/)
    })

    it('should be case-insensitive', () => {
      expect(getTagColorClass('florals', false)).toBe(CATEGORY_COLORS.flavor)
      expect(getTagColorClass('FLORALS', false)).toBe(CATEGORY_COLORS.flavor)
    })
  })

  describe('extractTagsFromPreferences', () => {
    it('should extract known tags from preferences string', () => {
      const prefs = 'I want a Light Body espresso with Florals and some Acidity'
      const tags = extractTagsFromPreferences(prefs)
      
      expect(tags).toContain('Light Body')
      expect(tags).toContain('Florals')
      expect(tags).toContain('Acidity')
    })

    it('should be case-insensitive', () => {
      const prefs = 'light body with florals'
      const tags = extractTagsFromPreferences(prefs)
      
      expect(tags).toContain('Light Body')
      expect(tags).toContain('Florals')
    })

    it('should return empty array for null preferences', () => {
      const tags = extractTagsFromPreferences(null)
      expect(tags).toEqual([])
    })

    it('should return empty array for empty preferences', () => {
      const tags = extractTagsFromPreferences('')
      expect(tags).toEqual([])
    })

    it('should return empty array if no known tags found', () => {
      const prefs = 'I want a nice coffee with some flavor'
      const tags = extractTagsFromPreferences(prefs)
      expect(tags).toEqual([])
    })

    it('should extract multiple tags from same category', () => {
      const prefs = 'Light Roast with Chocolate and Berry notes'
      const tags = extractTagsFromPreferences(prefs)
      
      expect(tags).toContain('Light Roast')
      expect(tags).toContain('Chocolate')
      expect(tags).toContain('Berry')
    })

    it('should extract roast levels correctly', () => {
      const prefs = 'Medium Roast beans'
      const tags = extractTagsFromPreferences(prefs)
      expect(tags).toContain('Medium Roast')
    })

    it('should extract extraction styles', () => {
      const prefs = 'Turbo shot with Pre-infusion'
      const tags = extractTagsFromPreferences(prefs)
      expect(tags).toContain('Turbo')
      expect(tags).toContain('Pre-infusion')
    })
  })

  describe('getAllTagsFromEntries', () => {
    it('should collect all unique tags from entries', () => {
      const entries = [
        { user_preferences: 'Light Body with Florals' },
        { user_preferences: 'Medium Body with Chocolate' },
        { user_preferences: 'Light Body with Acidity' }  // Light Body repeated
      ]
      
      const tags = getAllTagsFromEntries(entries)
      
      expect(tags).toContain('Light Body')
      expect(tags).toContain('Florals')
      expect(tags).toContain('Medium Body')
      expect(tags).toContain('Chocolate')
      expect(tags).toContain('Acidity')
      
      // Should not have duplicates
      const lightBodyCount = tags.filter(t => t === 'Light Body').length
      expect(lightBodyCount).toBe(1)
    })

    it('should return empty array for empty entries', () => {
      const tags = getAllTagsFromEntries([])
      expect(tags).toEqual([])
    })

    it('should handle entries with null preferences', () => {
      const entries = [
        { user_preferences: null },
        { user_preferences: 'Light Body' },
        { user_preferences: null }
      ]
      
      const tags = getAllTagsFromEntries(entries)
      expect(tags).toEqual(['Light Body'])
    })

    it('should return sorted tags', () => {
      const entries = [
        { user_preferences: 'Turbo with Acidity and Bloom' }
      ]
      
      const tags = getAllTagsFromEntries(entries)
      const sortedTags = [...tags].sort()
      expect(tags).toEqual(sortedTags)
    })
  })
})
