import { describe, it, expect } from 'vitest'
import { detectDecentFormat, convertDecentToMeticulous } from './decentConverter'

const VALID_DECENT = {
  title: 'Londinium',
  author: 'John Doe',
  notes: 'A classic lever profile',
  beverage_type: 'espresso',
  steps: [
    {
      name: 'preinfusion',
      temperature: 92.0,
      sensor: 'coffee',
      pump: 'flow',
      transition: 'fast',
      flow: 4.0,
      seconds: 8.0,
      exit: {
        type: 'pressure_over',
        condition: 4.0,
        or: { type: 'time_over', condition: 30.0 },
      },
    },
    {
      name: 'extraction',
      temperature: 93.0,
      pump: 'pressure',
      pressure: 9.0,
      seconds: 60.0,
      exit: { type: 'weight_over', condition: 36.0 },
    },
  ],
}

describe('detectDecentFormat', () => {
  it('detects valid Decent profiles', () => {
    expect(detectDecentFormat(VALID_DECENT)).toBe(true)
  })

  it('rejects Meticulous-format profiles', () => {
    expect(detectDecentFormat({ name: 'Test', stages: [{ type: 'flow' }] })).toBe(false)
  })

  it('rejects non-dict / empty inputs', () => {
    expect(detectDecentFormat(null)).toBe(false)
    expect(detectDecentFormat(undefined)).toBe(false)
    expect(detectDecentFormat([])).toBe(false)
    expect(detectDecentFormat({})).toBe(false)
    expect(detectDecentFormat('string')).toBe(false)
  })

  it('rejects profiles with empty steps', () => {
    expect(detectDecentFormat({ steps: [] })).toBe(false)
  })
})

describe('convertDecentToMeticulous', () => {
  it('converts a basic Decent profile correctly', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    expect(result.profile.name).toBe('Londinium')
    expect(result.profile.author).toBe('John Doe')
    expect(result.profile.stages).toHaveLength(2)
    expect(result.profile.temperature).toBe(92.0)
    expect(result.profile.final_weight).toBe(36.0)
    expect(result.warnings).toHaveLength(0)
  })

  it('maps flow stages correctly', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    const s0 = result.profile.stages[0]
    expect(s0.type).toBe('flow')
    expect(s0.name).toBe('preinfusion')
    expect(s0.dynamics.type).toBe('flow')
    expect(s0.dynamics.points).toEqual([[0.0, 4.0]])
  })

  it('maps pressure stages correctly', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    const s1 = result.profile.stages[1]
    expect(s1.type).toBe('pressure')
    expect(s1.dynamics.type).toBe('pressure')
    expect(s1.dynamics.points).toEqual([[0.0, 9.0]])
  })

  it('converts OR-chained exit conditions', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    const triggers = result.profile.stages[0].exit_triggers
    expect(triggers).toHaveLength(2)
    expect(triggers[0].type).toBe('pressure')
    expect(triggers[0].direction).toBe('above')
    expect(triggers[1].type).toBe('time')
  })

  it('creates ramp points for smooth transitions', () => {
    const data = {
      title: 'Ramp Test',
      steps: [
        {
          name: 'ramp',
          pump: 'pressure',
          pressure: 9.0,
          transition: 'smooth',
          seconds: 10.0,
          sensor: 'coffee',
        },
      ],
    }
    const result = convertDecentToMeticulous(data)
    const points = result.profile.stages[0].dynamics.points
    expect(points).toEqual([
      [0.0, 0.0],
      [10.0, 9.0],
    ])
  })

  it('warns on unknown pump type', () => {
    const data = {
      title: 'Unknown',
      steps: [{ name: 'test', pump: 'steam', sensor: 'coffee' }],
    }
    const result = convertDecentToMeticulous(data)
    expect(result.warnings.some((w) => w.includes('steam'))).toBe(true)
    expect(result.profile.stages[0].type).toBe('pressure')
  })

  it('warns on empty steps', () => {
    const result = convertDecentToMeticulous({ title: 'Empty', steps: [] })
    expect(result.warnings.some((w) => w.includes('No stages'))).toBe(true)
  })

  it('preserves notes as display.description', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    expect(result.profile.display?.description).toBe('A classic lever profile')
  })

  it('sets correct relative flags on exit triggers', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    const allTriggers = result.profile.stages.flatMap((s) => s.exit_triggers)
    for (const t of allTriggers) {
      if (t.type === 'time') {
        expect(t.relative).toBe(true)
      } else {
        expect(t.relative).toBe(false)
      }
      expect(t.comparison).toBe('>=')
    }
  })

  it('includes all required Meticulous fields on stages', () => {
    const result = convertDecentToMeticulous(VALID_DECENT)
    for (const stage of result.profile.stages) {
      expect(stage).toHaveProperty('key')
      expect(stage).toHaveProperty('type')
      expect(stage).toHaveProperty('name')
      expect(stage).toHaveProperty('dynamics')
      expect(stage).toHaveProperty('exit_triggers')
      expect(stage).toHaveProperty('limits')
      expect(stage.dynamics.interpolation).toBe('linear')
      expect(stage.dynamics.over).toBe('time')
    }
  })
})
