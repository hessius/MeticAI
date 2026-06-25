import { describe, it, expect } from 'vitest'
import { lintShotAnalysis, repairShotAnalysis } from './analysisLint'

const wellFormed = `## 1. Overall Assessment
**Summary:** A balanced, well-extracted shot with good temperature stability.
**Assessment:** [Good]

## 2. Extraction Analysis
- Pre-infusion ramped smoothly over 8 seconds.
- Main extraction held a steady 9 bar plateau.
- The decline phase tapered cleanly without spikes.

## 3. Temperature Performance
- Target adherence stayed within 0.5°C of the 93°C setpoint.

## 4. Pressure & Flow
- No channeling indicators; flow rose monotonically.

## 5. Recommendations
- Try a 0.5g dose increase to lift body slightly.`

describe('lintShotAnalysis', () => {
  it('accepts a well-formed multi-section analysis', () => {
    const result = lintShotAnalysis(wellFormed)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('flags empty or near-empty output', () => {
    expect(lintShotAnalysis('').valid).toBe(false)
    expect(lintShotAnalysis('   \n  ').issues).toContain('empty')
    expect(lintShotAnalysis('Good.').valid).toBe(false)
  })

  it('flags a substantive line repeated many times (runaway repetition)', () => {
    const looped = Array(12)
      .fill('The main extraction held a steady 9 bar plateau throughout.')
      .join('\n')
    const result = lintShotAnalysis(looped)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('repetition')
  })

  it('flags low line diversity even without a single dominant line', () => {
    const lines: string[] = []
    for (let i = 0; i < 6; i++) {
      lines.push('Temperature adherence stayed within half a degree of target.')
      lines.push('Pressure formed a clean nine bar plateau during extraction.')
    }
    const result = lintShotAnalysis(lines.join('\n'))
    expect(result.valid).toBe(false)
    expect(result.issues).toContain('low-diversity')
  })

  it('ignores short/structural lines (headers, bullets) when counting repetition', () => {
    const text = `## 1. Section
- ok
- ok
- ok
- ok
- ok
This is a single substantive sentence that only appears once here.`
    // Bullet "- ok" repeats but is too short to count; should stay valid.
    expect(lintShotAnalysis(text).valid).toBe(true)
  })
})

describe('repairShotAnalysis', () => {
  it('leaves a well-formed analysis essentially unchanged', () => {
    const repaired = repairShotAnalysis(wellFormed)
    expect(repaired).toContain('Overall Assessment')
    expect(repaired).toContain('Recommendations')
    expect(lintShotAnalysis(repaired).valid).toBe(true)
  })

  it('collapses runaway repetition into a single occurrence, preserving order', () => {
    const looped = [
      '## 1. Overall Assessment',
      'A balanced and well-extracted shot overall.',
      'A balanced and well-extracted shot overall.',
      'A balanced and well-extracted shot overall.',
      'A balanced and well-extracted shot overall.',
      '## 2. Recommendations',
      'Increase the dose by half a gram next time.',
    ].join('\n')
    const repaired = repairShotAnalysis(looped)
    const occurrences = repaired.split('A balanced and well-extracted shot overall.').length - 1
    expect(occurrences).toBe(1)
    expect(repaired.indexOf('Overall Assessment')).toBeLessThan(repaired.indexOf('Recommendations'))
    expect(repaired).toContain('Increase the dose by half a gram next time.')
  })

  it('collapses 3+ consecutive blank lines to a single blank', () => {
    const repaired = repairShotAnalysis('Line one.\n\n\n\n\nLine two is also substantive here.')
    expect(repaired).not.toMatch(/\n{3,}/)
  })
})
