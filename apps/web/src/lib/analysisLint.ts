/**
 * Shot-analysis output linter.
 *
 * On-device models (e.g. Apple Intelligence) occasionally produce malformed
 * analysis text — looping the same sentence dozens of times while omitting other
 * sections. This module mirrors the validate-then-retry safety net used for
 * AI-generated profiles (see profilePromptFull.ts / profileValidator.ts): it
 * detects degenerate output so the caller can regenerate, and offers a
 * best-effort repair that collapses runaway repetition when a retry still fails.
 */

import type { ShotFacts } from './shotFacts'
import { REQUIRED_ANALYSIS_SECTIONS } from './analysisSchema'

export interface AnalysisLintResult {
  valid: boolean
  /** Machine-readable issue codes (e.g. 'empty', 'repetition', 'low-diversity'). */
  issues: string[]
}

/** Lines shorter than this are treated as structural (headers/bullets) and ignored. */
const SUBSTANTIVE_MIN_LEN = 12
/** A substantive line appearing this many times or more is runaway repetition. */
const REPEAT_LIMIT = 4
/** If unique substantive lines fall below this fraction, the output lacks diversity. */
const MIN_DIVERSITY_RATIO = 0.5
/** Minimum number of substantive lines before the diversity heuristic applies. */
const MIN_LINES_FOR_DIVERSITY = 6
/** Minimum trimmed length for any usable analysis. */
const MIN_LENGTH = 40

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isSubstantive(line: string): boolean {
  const stripped = line.trim().replace(/^[-•*#>\d.\s]+/, '')
  return stripped.length >= SUBSTANTIVE_MIN_LEN
}

/**
 * Inspect analysis text for the degenerate patterns produced by misbehaving
 * models. Returns `valid: false` with one or more issue codes when the output
 * should not be shown as-is.
 */
export function lintShotAnalysis(text: string): AnalysisLintResult {
  const issues: string[] = []
  const trimmed = (text ?? '').trim()

  if (trimmed.length < MIN_LENGTH) {
    issues.push('empty')
    return { valid: false, issues }
  }

  const substantive = trimmed.split('\n').filter(isSubstantive)

  const counts = new Map<string, number>()
  for (const line of substantive) {
    const key = normalize(line)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let maxRepeat = 0
  for (const count of counts.values()) {
    if (count > maxRepeat) maxRepeat = count
  }
  if (maxRepeat >= REPEAT_LIMIT) {
    issues.push('repetition')
  }

  if (substantive.length >= MIN_LINES_FOR_DIVERSITY) {
    const diversity = counts.size / substantive.length
    if (diversity < MIN_DIVERSITY_RATIO) {
      issues.push('low-diversity')
    }
  }

  return { valid: issues.length === 0, issues }
}

/**
 * Best-effort cleanup for malformed analysis text. Drops repeated substantive
 * lines (keeping the first occurrence, preserving order) and collapses runs of
 * blank lines. Structural lines (short headers/bullets) are always kept.
 */
export function repairShotAnalysis(text: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  let blankRun = 0

  for (const line of (text ?? '').split('\n')) {
    if (line.trim().length === 0) {
      blankRun++
      if (blankRun <= 1) out.push('')
      continue
    }
    blankRun = 0

    if (isSubstantive(line)) {
      const key = normalize(line)
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(line)
  }

  return out.join('\n').trim()
}

/** Phrases that frame a stage exit as a failure/early stop. */
const EARLY_EXIT_PATTERNS = [
  /terminat\w*\s+early/i,
  /\bearly\s+terminat/i,
  /ended?\s+(too\s+)?(early|prematurely)/i,
  /\bcut\s+short\b/i,
  /stopped?\s+before\s+reaching/i,
]
/** Phrases asserting channeling occurred. */
const CHANNELING_ASSERTION = /\bchannel(?:ing|ed|s)?\b/i
/** Phrases that negate channeling (so we don't flag "no channeling"). */
const CHANNELING_NEGATION = /\b(no|not|without|absence of|isn'?t|wasn'?t)\b[^.]{0,30}channel/i

/**
 * Reject analyses that contradict the deterministic ShotFacts. High precision:
 * only flags clear, well-supported contradictions.
 */
export function validateAgainstFacts(text: string, facts: ShotFacts): AnalysisLintResult {
  const issues: string[] = []
  const body = text ?? ''

  const hasTargetedWeightExit = facts.stages.some(
    s => s.reached && s.trigger_type === 'weight' && s.trigger_class?.kind === 'targeted',
  )
  if (hasTargetedWeightExit && EARLY_EXIT_PATTERNS.some(re => re.test(body))) {
    issues.push('mischaracterized-targeted-exit')
  }

  const anyChanneling = facts.stages.some(s => s.channeling?.channeling)
  if (!anyChanneling && CHANNELING_ASSERTION.test(body) && !CHANNELING_NEGATION.test(body)) {
    issues.push('unsupported-channeling')
  }

  return { valid: issues.length === 0, issues }
}

/**
 * Verify the analysis contains each required section title (L1). Matches on the title text so
 * it is robust to numbering/heading-level variations the model may introduce.
 */
export function checkStructure(text: string): AnalysisLintResult {
  const body = (text ?? '').toLowerCase()
  const missing = REQUIRED_ANALYSIS_SECTIONS.filter(s => !body.includes(s.toLowerCase()))
  return { valid: missing.length === 0, issues: missing.length ? ['missing-sections'] : [] }
}
