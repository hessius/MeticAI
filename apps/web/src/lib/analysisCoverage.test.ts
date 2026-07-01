import { describe, it, expect } from 'vitest'
import * as lint from './analysisLint'

describe('analysis coverage matrix (L5, native)', () => {
  it('exposes degeneracy, structural, and fact-aware checks', () => {
    expect(typeof lint.lintShotAnalysis).toBe('function')
    expect(typeof lint.checkStructure).toBe('function')
    expect(typeof lint.validateAgainstFacts).toBe('function')
    expect(typeof lint.repairShotAnalysis).toBe('function')
  })
})
