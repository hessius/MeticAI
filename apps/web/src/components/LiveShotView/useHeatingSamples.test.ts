import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHeatingSamples } from './useHeatingSamples'

describe('useHeatingSamples', () => {
  it('accumulates samples while active and exposes elapsed-time points', () => {
    let now = 1000
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ temp, active }) => useHeatingSamples({ temp, active, maxWindow: 10, nowFn }),
      { initialProps: { temp: 20, active: true } }
    )
    expect(result.current.length).toBe(1)
    act(() => { now = 3000 })
    rerender({ temp: 30, active: true })
    expect(result.current.length).toBe(2)
    expect(result.current[1].t).toBeCloseTo(2, 1)
    expect(result.current[1].temp).toBe(30)
  })

  it('clears samples when inactive', () => {
    const { result, rerender } = renderHook(
      ({ temp, active }) => useHeatingSamples({ temp, active }),
      { initialProps: { temp: 20, active: true } }
    )
    expect(result.current.length).toBe(1)
    rerender({ temp: 20, active: false })
    expect(result.current.length).toBe(0)
  })

  it('drops samples older than the window', () => {
    let now = 0
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ temp }) => useHeatingSamples({ temp, active: true, maxWindow: 5, nowFn }),
      { initialProps: { temp: 20 } }
    )
    for (let i = 1; i <= 8; i++) {
      act(() => { now = i * 1000 })
      rerender({ temp: 20 + i })
    }
    expect(result.current.length).toBe(6)
    expect(result.current[result.current.length - 1].temp).toBe(28)
  })

  it('records plateau samples and trims the rolling window when tick advances', () => {
    let now = 0
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ tick }) => useHeatingSamples({ temp: 90, active: true, maxWindow: 5, nowFn, tick }),
      { initialProps: { tick: 0 } }
    )
    expect(result.current.length).toBe(1)
    for (let tick = 1; tick <= 8; tick++) {
      act(() => { now = tick * 1000 })
      rerender({ tick })
    }
    expect(result.current.length).toBe(6)
    expect(result.current[result.current.length - 1].temp).toBe(90)
  })

  it('restarts elapsed time from zero after becoming inactive', () => {
    let now = 1000
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ active, tick }) => useHeatingSamples({ temp: 20, active, nowFn, tick }),
      { initialProps: { active: true, tick: 0 } }
    )
    expect(result.current.length).toBe(1)
    rerender({ active: false, tick: 1 })
    expect(result.current.length).toBe(0)
    act(() => { now = 10000 })
    rerender({ active: true, tick: 2 })
    expect(result.current.length).toBe(1)
    expect(result.current[0].t).toBeCloseTo(0, 1)
  })

})
