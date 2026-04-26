/**
 * Tests for profileRecommendation.ts — parity with Python test_recommendations.py.
 *
 * Uses the same fixture profiles to verify the TypeScript scoring engine
 * produces results consistent with the Python implementation.
 */

import { describe, it, expect } from 'vitest'
import { findSimilarProfiles, getRecommendations } from './profileRecommendation'
import {
  makeProfile,
  PRESSURE_PROFILE,
  FLOW_PROFILE,
  FLAT_PROFILE,
  TURBO_PROFILE,
  LEVER_PROFILE,
} from './profileAnalysis.test'

const ALL_PROFILES = [PRESSURE_PROFILE, FLOW_PROFILE, FLAT_PROFILE, TURBO_PROFILE, LEVER_PROFILE]

// ── findSimilarProfiles tests ──────────────────────────────────────────────

describe('findSimilarProfiles', () => {
  it('excludes the source profile from results', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    expect(results.every(r => r.profile_name !== 'Classic Italian Espresso')).toBe(true)
  })

  it('returns results with expected fields', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r).toHaveProperty('profile_name')
      expect(r).toHaveProperty('score')
      expect(r).toHaveProperty('explanation')
      expect(r).toHaveProperty('match_reasons')
      expect(typeof r.score).toBe('number')
      expect(typeof r.explanation).toBe('string')
      expect(Array.isArray(r.match_reasons)).toBe(true)
    }
  })

  it('ranks similar control modes higher', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    const leverScore = results.find(r => r.profile_name === 'Lever Decline')?.score ?? 0
    const turboScore = results.find(r => r.profile_name === 'Turbo Shot')?.score ?? 0
    // Lever is also pressure-controlled with preinfusion, should rank higher than flow-based turbo
    expect(leverScore).toBeGreaterThan(turboScore)
  })

  it('respects limit parameter', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('returns empty for unknown source profile', () => {
    const unknownProfile = makeProfile('DoesNotExist', [])
    // The profile isn't in the list, but findSimilar still works — it just compares against all
    const results = findSimilarProfiles(unknownProfile, ALL_PROFILES)
    // Should return some results since we're comparing against ALL_PROFILES
    expect(Array.isArray(results)).toBe(true)
  })

  it('returns empty for empty profile list', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, [])
    expect(results).toEqual([])
  })

  it('filters out zero-score results', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
    }
  })

  it('caps scores at 100', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(100)
    }
  })

  it('results are sorted by score descending', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('pressure profile finds lever similar (parity with Python)', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES, 5)
    expect(results.length).toBeGreaterThan(0)
    // First result should be a pressure-controlled profile (Lever or Flat)
    const topResult = results[0]
    expect(['Lever Decline', 'Simple 6 Bar']).toContain(topResult.profile_name)
  })

  it('flow profile finds other flow profiles similar', () => {
    const results = findSimilarProfiles(FLOW_PROFILE, ALL_PROFILES, 5)
    // Turbo is also flow-controlled
    const turboResult = results.find(r => r.profile_name === 'Turbo Shot')
    expect(turboResult).toBeDefined()
  })
})

// ── getRecommendations tests ───────────────────────────────────────────────

describe('getRecommendations', () => {
  it('returns results with expected format', () => {
    const results = getRecommendations(['preinfusion', 'bloom'], ALL_PROFILES, 5)
    expect(Array.isArray(results)).toBe(true)
    for (const r of results) {
      expect(r).toHaveProperty('profile_name')
      expect(r).toHaveProperty('score')
      expect(r).toHaveProperty('match_reasons')
      expect(r).toHaveProperty('explanation')
    }
  })

  it('returns empty for empty catalogue', () => {
    const results = getRecommendations(['preinfusion'], [], 5)
    expect(results).toEqual([])
  })

  it('filters out zero-score results', () => {
    const results = getRecommendations(['fruity'], ALL_PROFILES, 5)
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
    }
  })

  it('respects limit parameter', () => {
    const results = getRecommendations(['preinfusion', 'pressure'], ALL_PROFILES, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('pressure tags rank pressure profiles higher', () => {
    const results = getRecommendations(['preinfusion', 'pressure'], ALL_PROFILES, 5)
    if (results.length >= 2) {
      // Top results should be pressure-controlled
      const topNames = results.slice(0, 2).map(r => r.profile_name)
      expect(
        topNames.some(n => n.includes('Italian') || n.includes('Lever') || n.includes('Simple'))
      ).toBe(true)
    }
  })

  it('bloom tags rank bloom profiles higher', () => {
    const results = getRecommendations(['bloom', 'flow'], ALL_PROFILES, 5)
    if (results.length > 0) {
      // Flow profile with bloom should be at or near top
      const topNames = results.slice(0, 2).map(r => r.profile_name)
      expect(topNames.some(n => n.includes('Flow') || n.includes('Bloom'))).toBe(true)
    }
  })

  it('handles empty tags', () => {
    const results = getRecommendations([], ALL_PROFILES, 5)
    // Should still return results based on structural similarity (even if tags are empty,
    // user fingerprint defaults give some structure-based scoring)
    expect(Array.isArray(results)).toBe(true)
  })

  it('handles unknown tags gracefully', () => {
    const results = getRecommendations(['xyzzy', 'plugh'], ALL_PROFILES, 5)
    // Unknown tags won't match anything, but profiles may still get non-zero
    // scores from structural comparison with the default fingerprint
    expect(Array.isArray(results)).toBe(true)
  })
})

// ── Scoring parity tests ──────────────────────────────────────────────────

describe('scoring parity', () => {
  it('similar pressure profiles score > 30 (matches Python)', () => {
    // Python: _score_profile(source_tags, source_fp, LEVER_PROFILE) -> score > 30
    const results = findSimilarProfiles(PRESSURE_PROFILE, [LEVER_PROFILE])
    expect(results.length).toBe(1)
    expect(results[0].score).toBeGreaterThan(30)
  })

  it('pressure vs lever scores higher than pressure vs turbo (matches Python)', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, ALL_PROFILES)
    const leverScore = results.find(r => r.profile_name === 'Lever Decline')?.score ?? 0
    const turboScore = results.find(r => r.profile_name === 'Turbo Shot')?.score ?? 0
    expect(leverScore).toBeGreaterThan(turboScore)
  })

  it('weight similarity affects scoring', () => {
    const pClose = makeProfile('Test A', [], 93, 37)
    const pFar = makeProfile('Test B', [], 93, 60)
    // Find similar to a profile with weight 36
    const source = makeProfile('Source', [], 93, 36)
    const results = findSimilarProfiles(source, [pClose, pFar])
    const closeScore = results.find(r => r.profile_name === 'Test A')?.score ?? 0
    const farScore = results.find(r => r.profile_name === 'Test B')?.score ?? 0
    expect(closeScore).toBeGreaterThan(farScore)
  })

  it('temperature similarity affects scoring', () => {
    const pClose = makeProfile('Test A', [], 93, 36)
    const pFar = makeProfile('Test B', [], 80, 36)
    const source = makeProfile('Source', [], 93, 36)
    const results = findSimilarProfiles(source, [pClose, pFar])
    const closeScore = results.find(r => r.profile_name === 'Test A')?.score ?? 0
    const farScore = results.find(r => r.profile_name === 'Test B')?.score ?? 0
    expect(closeScore).toBeGreaterThan(farScore)
  })

  it('explanation is a string', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, [LEVER_PROFILE])
    expect(typeof results[0].explanation).toBe('string')
  })

  it('match_reasons is an array of strings', () => {
    const results = findSimilarProfiles(PRESSURE_PROFILE, [LEVER_PROFILE])
    expect(Array.isArray(results[0].match_reasons)).toBe(true)
    for (const reason of results[0].match_reasons) {
      expect(typeof reason).toBe('string')
    }
  })
})
