import { describe, it, expect } from 'vitest'
import { deriveLiveActivityCommand } from './deriveLiveActivityCommand'

describe('deriveLiveActivityCommand', () => {
  it('starts when heating begins and none is active', () => {
    const r = deriveLiveActivityCommand(
      { active: false },
      { stateLC: 'heating', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('start')
    expect(r.next.active).toBe(true)
  })

  it('does nothing while a shot is already tracked', () => {
    const r = deriveLiveActivityCommand(
      { active: true },
      { stateLC: 'brewing', brewing: true, hasChartData: true },
    )
    expect(r.command).toBe('none')
  })

  it('stops when the machine returns to idle after a shot', () => {
    const r = deriveLiveActivityCommand(
      { active: true },
      { stateLC: 'idle', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('stop')
    expect(r.next.active).toBe(false)
  })

  it('stays idle when nothing is happening', () => {
    const r = deriveLiveActivityCommand(
      { active: false },
      { stateLC: 'idle', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('none')
  })
})
