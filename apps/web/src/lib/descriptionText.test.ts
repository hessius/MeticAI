import { describe, it, expect } from 'vitest'
import { resolveDescriptionPlaceholders } from './descriptionText'

describe('resolveDescriptionPlaceholders', () => {
  const vars = [
    { key: 'pressure_Max Pressure', name: 'Max Pressure', value: 6 },
    { key: 'flow_PreBrew Flow Rate', name: 'PreBrew Flow Rate', value: 1.2 },
    { key: 'time_PreBrew Duration', name: 'PreBrew Duration', value: 30 },
  ]

  it('resolves $key references to values with units', () => {
    expect(resolveDescriptionPlaceholders('Peaks at $pressure_Max Pressure.', vars))
      .toBe('Peaks at 6 bar.')
    expect(resolveDescriptionPlaceholders('Flows at $flow_PreBrew Flow Rate$ initially.', vars))
      .toBe('Flows at 1.2 ml/s initially.')
  })

  it('unescapes markdown-escaped underscores before resolving', () => {
    expect(resolveDescriptionPlaceholders('Runs $time\\_PreBrew Duration$.', vars))
      .toBe('Runs 30 s.')
  })

  it('strips invented paired placeholder tokens', () => {
    expect(resolveDescriptionPlaceholders('Adjust $pressure_1$ upward.', vars))
      .toBe('Adjust upward.')
    expect(resolveDescriptionPlaceholders('See $pressure\\_1$ here.', vars))
      .toBe('See here.')
  })

  it('leaves normal prose untouched', () => {
    const text = 'A balanced, chocolatey shot with 9 bar peak pressure.'
    expect(resolveDescriptionPlaceholders(text, vars)).toBe(text)
  })

  it('handles empty input', () => {
    expect(resolveDescriptionPlaceholders('', vars)).toBe('')
    expect(resolveDescriptionPlaceholders(null)).toBe('')
  })

  it('collapses whitespace and trims space before punctuation without catastrophic backtracking', () => {
    expect(resolveDescriptionPlaceholders('word   .', vars)).toBe('word.')
    expect(resolveDescriptionPlaceholders('a\t\tb ,c', vars)).toBe('a b,c')
    // A long run of whitespace with no trailing punctuation must resolve
    // quickly (guards against the previously polynomial regex).
    const input = `x${' '.repeat(20000)}y`
    const start = Date.now()
    expect(resolveDescriptionPlaceholders(input, vars)).toBe('x y')
    expect(Date.now() - start).toBeLessThan(500)
  })
})
