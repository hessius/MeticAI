import { describe, it, expect } from 'vitest'
import { resolveChartLayout } from './useChartLayout'

describe('resolveChartLayout', () => {
  it('forces combined below lg regardless of preference', () => {
    expect(resolveChartLayout('separated', { lg: false, xl: false })).toBe('combined')
    expect(resolveChartLayout('combined', { lg: false, xl: false })).toBe('combined')
  })

  it('honors combined preference at lg+', () => {
    expect(resolveChartLayout('combined', { lg: true, xl: true })).toBe('combined')
  })

  it('separated -> stack between lg and xl', () => {
    expect(resolveChartLayout('separated', { lg: true, xl: false })).toBe('stack')
  })

  it('separated -> grid at xl+', () => {
    expect(resolveChartLayout('separated', { lg: true, xl: true })).toBe('grid')
  })
})
