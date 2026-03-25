import { describe, it, expect } from 'vitest'
import {
  buildImagePrompt,
  buildProfileSystemPrompt,
  buildShotAnalysisPrompt,
  buildRecommendationPrompt,
  buildTasteContext,
  buildDialInPrompt,
} from '@/services/ai/prompts/index'

describe('prompt builders', () => {
  // -------------------------------------------------------------------
  // buildImagePrompt
  // -------------------------------------------------------------------
  describe('buildImagePrompt', () => {
    it('should include the no-text safety constraint', () => {
      const prompt = buildImagePrompt('Berry Blast', 'abstract', ['fruity'])
      expect(prompt).toContain('no text')
      expect(prompt).toContain('No text, words, letters, or numbers')
    })

    it('should include the profile name', () => {
      const prompt = buildImagePrompt('Morning Glory', 'minimalist', [])
      expect(prompt).toContain('Morning Glory')
    })

    it('should include the requested art style', () => {
      const prompt = buildImagePrompt('Test', 'watercolor', [])
      expect(prompt.toLowerCase()).toContain('watercolor')
    })

    it('should request square format', () => {
      const prompt = buildImagePrompt('Test', 'modern', [])
      expect(prompt.toLowerCase()).toContain('square format')
    })

    it('should include roast-derived colours for "dark" tag', () => {
      // Run multiple times to account for randomness; at least one colour should match
      const prompts = Array.from({ length: 10 }, () =>
        buildImagePrompt('Bold Shot', 'abstract', ['dark']),
      )
      const darkColors = ['espresso', 'charcoal', 'chocolate', 'midnight', 'obsidian']
      const found = prompts.some(p => darkColors.some(c => p.toLowerCase().includes(c)))
      expect(found).toBe(true)
    })

    it('should include flavor-derived elements for "fruity" tag', () => {
      const prompts = Array.from({ length: 10 }, () =>
        buildImagePrompt('Fruity Fun', 'abstract', ['fruity']),
      )
      const fruityKeywords = ['berry', 'citrus', 'apple', 'tropical', 'spheres', 'droplets', 'petals']
      const found = prompts.some(p => fruityKeywords.some(k => p.toLowerCase().includes(k)))
      expect(found).toBe(true)
    })

    it('should handle multiple tags', () => {
      const prompt = buildImagePrompt('Complex', 'abstract', ['dark', 'chocolate', 'spicy'])
      // Should be a non-empty string with the profile name
      expect(prompt).toContain('Complex')
      expect(prompt.length).toBeGreaterThan(100)
    })

    it('should handle unknown tags gracefully', () => {
      const prompt = buildImagePrompt('Mystery', 'abstract', ['unicorn', 'rainbow'])
      // No influence match → still produces a valid prompt
      expect(prompt).toContain('Mystery')
      expect(prompt).toContain('no text')
    })

    it('should fall back to abstract style for unknown style', () => {
      const prompt = buildImagePrompt('Test', 'nonexistent-style', [])
      // Should still produce output (falls back to abstract modifiers)
      expect(prompt.length).toBeGreaterThan(50)
    })

    it('should include coffee themes', () => {
      const coffeeKeywords = ['coffee', 'espresso', 'brewing', 'bean', 'ritual']
      const prompts = Array.from({ length: 10 }, () =>
        buildImagePrompt('Test', 'abstract', []),
      )
      const found = prompts.some(p => coffeeKeywords.some(k => p.toLowerCase().includes(k)))
      expect(found).toBe(true)
    })
  })

  // -------------------------------------------------------------------
  // buildProfileSystemPrompt
  // -------------------------------------------------------------------
  describe('buildProfileSystemPrompt', () => {
    it('should include coffee profile generation header', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).toContain('# Coffee Profile Generation')
    })

    it('should describe the barista role', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).toContain('expert barista')
    })

    it('should include OEPF JSON format requirement', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).toContain('OEPF JSON')
    })

    it('should include output format section with key fields', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).toContain('## Output Format')
      expect(prompt).toContain('name')
      expect(prompt).toContain('stages')
      expect(prompt).toContain('temperature')
    })

    it('should include user preferences when provided', () => {
      const prompt = buildProfileSystemPrompt('I like bright acidic coffees', [])
      expect(prompt).toContain('## User Preferences')
      expect(prompt).toContain('bright acidic coffees')
    })

    it('should omit preferences section when empty', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).not.toContain('## User Preferences')
    })

    it('should include tags when provided', () => {
      const prompt = buildProfileSystemPrompt('', ['fruity', 'light'])
      expect(prompt).toContain('## Tags')
      expect(prompt).toContain('fruity, light')
    })

    it('should omit tags section when empty', () => {
      const prompt = buildProfileSystemPrompt('', [])
      expect(prompt).not.toContain('## Tags')
    })

    it('should include advanced options when provided', () => {
      const prompt = buildProfileSystemPrompt('', [], { temperature: 93, ratio: 2.5 })
      expect(prompt).toContain('## Advanced Options')
      expect(prompt).toContain('temperature: 93')
      expect(prompt).toContain('ratio: 2.5')
    })

    it('should omit advanced options when empty object', () => {
      const prompt = buildProfileSystemPrompt('', [], {})
      expect(prompt).not.toContain('## Advanced Options')
    })

    it('should skip null/undefined advanced option values', () => {
      const prompt = buildProfileSystemPrompt('', [], { temp: 93, empty: null, missing: undefined })
      expect(prompt).toContain('temp: 93')
      expect(prompt).not.toContain('empty')
      expect(prompt).not.toContain('missing')
    })
  })

  // -------------------------------------------------------------------
  // buildShotAnalysisPrompt
  // -------------------------------------------------------------------
  describe('buildShotAnalysisPrompt', () => {
    it('should include profile name and shot info', () => {
      const prompt = buildShotAnalysisPrompt('Turbo Bloom', '2024-06-01', 'shot_001.json')
      expect(prompt).toContain('Turbo Bloom')
      expect(prompt).toContain('2024-06-01/shot_001.json')
    })

    it('should include analysis sections', () => {
      const prompt = buildShotAnalysisPrompt('P', 'd', 'f')
      expect(prompt).toContain('Extraction Analysis')
      expect(prompt).toContain('Temperature Performance')
      expect(prompt).toContain('Pressure & Flow')
      expect(prompt).toContain('Recommendations')
    })

    it('should include profile description when provided', () => {
      const prompt = buildShotAnalysisPrompt('P', 'd', 'f', 'Light Ethiopian natural')
      expect(prompt).toContain('Description: Light Ethiopian natural')
    })

    it('should omit description when not provided', () => {
      const prompt = buildShotAnalysisPrompt('P', 'd', 'f')
      expect(prompt).not.toContain('Description:')
    })
  })

  // -------------------------------------------------------------------
  // buildRecommendationPrompt
  // -------------------------------------------------------------------
  describe('buildRecommendationPrompt', () => {
    it('should include profile name and shot filename', () => {
      const prompt = buildRecommendationPrompt('Daily Driver', 'shot_042.json')
      expect(prompt).toContain('Daily Driver')
      expect(prompt).toContain('shot_042.json')
    })

    it('should request JSON array output', () => {
      const prompt = buildRecommendationPrompt('P', 'f')
      expect(prompt).toContain('JSON array')
      expect(prompt).toContain('```json')
    })

    it('should specify expected fields', () => {
      const prompt = buildRecommendationPrompt('P', 'f')
      expect(prompt).toContain('variable')
      expect(prompt).toContain('recommended_value')
      expect(prompt).toContain('confidence')
      expect(prompt).toContain('is_patchable')
    })
  })

  // -------------------------------------------------------------------
  // buildTasteContext
  // -------------------------------------------------------------------
  describe('buildTasteContext', () => {
    it('should return empty string when no data provided', () => {
      expect(buildTasteContext(null, null, null)).toBe('')
      expect(buildTasteContext(null, null, [])).toBe('')
    })

    it('should include compass header when coordinates provided', () => {
      const ctx = buildTasteContext(0.5, -0.3, null)
      expect(ctx).toContain('Espresso Compass')
      expect(ctx).toContain('Balance:')
      expect(ctx).toContain('Body:')
    })

    it('should describe sour for negative X', () => {
      const ctx = buildTasteContext(-0.6, 0, null)
      expect(ctx).toContain('Sour')
    })

    it('should describe bitter for positive X', () => {
      const ctx = buildTasteContext(0.6, 0, null)
      expect(ctx).toContain('Bitter')
    })

    it('should describe weak/thin for negative Y', () => {
      const ctx = buildTasteContext(0, -0.6, null)
      expect(ctx).toContain('Weak/Thin')
    })

    it('should describe strong/heavy for positive Y', () => {
      const ctx = buildTasteContext(0, 0.6, null)
      expect(ctx).toContain('Strong/Heavy')
    })

    it('should describe balanced for near-zero values', () => {
      const ctx = buildTasteContext(0.1, -0.05, null)
      expect(ctx).toContain('Balanced')
    })

    it('should use intensity modifiers (slightly, moderately, very)', () => {
      const slight = buildTasteContext(0.25, 0, null)
      expect(slight).toContain('Slightly')

      const moderate = buildTasteContext(0.5, 0, null)
      expect(moderate).toContain('Moderately')

      const very = buildTasteContext(0.8, 0, null)
      expect(very).toContain('Very')
    })

    it('should include descriptors when provided', () => {
      const ctx = buildTasteContext(null, null, ['ashy', 'flat'])
      expect(ctx).toContain('Descriptors: ashy, flat')
    })

    it('should include domain knowledge for extraction guidance', () => {
      const ctx = buildTasteContext(0.5, 0.5, ['smoky'])
      expect(ctx).toContain('under-extraction')
      expect(ctx).toContain('over-extraction')
    })

    it('should format coordinate values with two decimal places', () => {
      const ctx = buildTasteContext(0.333, -0.777, null)
      expect(ctx).toContain('0.33')
      expect(ctx).toContain('-0.78')
    })
  })

  // -------------------------------------------------------------------
  // buildDialInPrompt
  // -------------------------------------------------------------------
  describe('buildDialInPrompt', () => {
    it('should include dial-in header', () => {
      const prompt = buildDialInPrompt()
      expect(prompt).toContain('# Espresso Dial-In Recommendation')
    })

    it('should describe the barista role', () => {
      const prompt = buildDialInPrompt()
      expect(prompt).toContain('expert barista')
    })

    it('should request JSON output with recommendations key', () => {
      const prompt = buildDialInPrompt()
      expect(prompt).toContain('JSON object')
      expect(prompt).toContain('recommendations')
    })
  })
})
