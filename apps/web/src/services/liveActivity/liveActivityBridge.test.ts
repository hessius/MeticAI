import { describe, it, expect } from 'vitest'
import type { GlanceableConfig, StartLiveActivityOptions } from './liveActivityBridge'

describe('liveActivityBridge types', () => {
  it('exports a usable start-options shape', () => {
    const opts: StartLiveActivityOptions = {
      profileName: 'Test',
      machineUrl: 'http://10.0.0.5',
      shotGlanceable: 'weight',
      heatingGlanceable: 'temp',
    }
    expect(opts.machineUrl).toBe('http://10.0.0.5')
  })

  it('constrains glanceable config values', () => {
    const cfg: GlanceableConfig = { shotGlanceable: 'pressure', heatingGlanceable: 'estimatedTime' }
    expect(cfg.shotGlanceable).toBe('pressure')
  })
})
