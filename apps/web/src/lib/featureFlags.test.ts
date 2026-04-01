import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock machineMode so we can toggle direct/proxy per test
vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => false),
}))

import { isDirectMode } from '@/lib/machineMode'
import { getFeatureFlags, hasFeature, resetFeatureFlags } from '@/lib/featureFlags'

const mockedIsDirectMode = vi.mocked(isDirectMode)

describe('featureFlags', () => {
  beforeEach(() => {
    resetFeatureFlags()
    mockedIsDirectMode.mockReturnValue(false)
  })

  // -------------------------------------------------------------------
  // Proxy mode
  // -------------------------------------------------------------------
  describe('proxy mode', () => {
    it('should enable all backend-dependent features', () => {
      const flags = getFeatureFlags()
      expect(flags.machineDiscovery).toBe(true)
      expect(flags.scheduledShots).toBe(true)
      expect(flags.systemManagement).toBe(true)
      expect(flags.tailscaleConfig).toBe(true)
      expect(flags.mcpServer).toBe(true)
      expect(flags.cloudSync).toBe(true)
      expect(flags.bridgeStatus).toBe(true)
      expect(flags.watchtowerUpdate).toBe(true)
    })

    it('should enable shared features', () => {
      const flags = getFeatureFlags()
      expect(flags.aiFeatures).toBe(true)
      expect(flags.liveTelemetry).toBe(true)
      expect(flags.shotHistory).toBe(true)
      expect(flags.profileManagement).toBe(true)
      expect(flags.pourOver).toBe(true)
      expect(flags.dialIn).toBe(true)
      expect(flags.recommendations).toBe(true)
    })

    it('should disable pwaInstall', () => {
      expect(getFeatureFlags().pwaInstall).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // Direct mode
  // -------------------------------------------------------------------
  describe('direct mode', () => {
    beforeEach(() => {
      mockedIsDirectMode.mockReturnValue(true)
    })

    it('should disable mDNS, scheduling, system management, tailscale, MCP, cloud sync, bridge, watchtower', () => {
      const flags = getFeatureFlags()
      expect(flags.machineDiscovery).toBe(false)
      expect(flags.scheduledShots).toBe(false)
      expect(flags.systemManagement).toBe(false)
      expect(flags.tailscaleConfig).toBe(false)
      expect(flags.mcpServer).toBe(false)
      expect(flags.cloudSync).toBe(false)
      expect(flags.bridgeStatus).toBe(false)
      expect(flags.watchtowerUpdate).toBe(false)
    })

    it('should enable browser-capable features', () => {
      const flags = getFeatureFlags()
      expect(flags.aiFeatures).toBe(true)
      expect(flags.liveTelemetry).toBe(true)
      expect(flags.shotHistory).toBe(true)
      expect(flags.profileManagement).toBe(true)
      expect(flags.pourOver).toBe(true)
      expect(flags.dialIn).toBe(true)
      expect(flags.recommendations).toBe(true)
    })

    it('should enable pwaInstall', () => {
      expect(getFeatureFlags().pwaInstall).toBe(true)
    })
  })

  // -------------------------------------------------------------------
  // hasFeature helper
  // -------------------------------------------------------------------
  describe('hasFeature', () => {
    it('should return true for enabled features in proxy mode', () => {
      expect(hasFeature('aiFeatures')).toBe(true)
      expect(hasFeature('machineDiscovery')).toBe(true)
    })

    it('should return false for disabled features in proxy mode', () => {
      expect(hasFeature('pwaInstall')).toBe(false)
    })

    it('should return correct values in direct mode', () => {
      mockedIsDirectMode.mockReturnValue(true)
      resetFeatureFlags()
      expect(hasFeature('pwaInstall')).toBe(true)
      expect(hasFeature('machineDiscovery')).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------
  describe('caching', () => {
    it('should return the same object reference on repeated calls', () => {
      const first = getFeatureFlags()
      const second = getFeatureFlags()
      expect(first).toBe(second)
    })

    it('should recalculate after resetFeatureFlags', () => {
      const proxyFlags = getFeatureFlags()
      expect(proxyFlags.pwaInstall).toBe(false)

      mockedIsDirectMode.mockReturnValue(true)
      resetFeatureFlags()

      const directFlags = getFeatureFlags()
      expect(directFlags.pwaInstall).toBe(true)
      expect(directFlags).not.toBe(proxyFlags)
    })
  })

  // -------------------------------------------------------------------
  // Exhaustive flag coverage
  // -------------------------------------------------------------------
  describe('exhaustive flag coverage', () => {
    it('proxy and direct flags should have the same keys', () => {
      // Proxy
      mockedIsDirectMode.mockReturnValue(false)
      resetFeatureFlags()
      const proxyKeys = Object.keys(getFeatureFlags()).sort()

      // Direct
      mockedIsDirectMode.mockReturnValue(true)
      resetFeatureFlags()
      const directKeys = Object.keys(getFeatureFlags()).sort()

      expect(proxyKeys).toEqual(directKeys)
    })

    it('every FeatureFlags key should be a boolean', () => {
      const flags = getFeatureFlags()
      for (const [, value] of Object.entries(flags)) {
        expect(typeof value).toBe('boolean')
      }
    })
  })

  // -------------------------------------------------------------------
  // Snapshot tests — detect accidental flag changes
  // -------------------------------------------------------------------
  describe('flag value snapshots', () => {
    it('PROXY_FLAGS should match snapshot', () => {
      mockedIsDirectMode.mockReturnValue(false)
      resetFeatureFlags()
      expect(getFeatureFlags()).toMatchInlineSnapshot(`
        {
          "aiFeatures": true,
          "bridgeStatus": true,
          "cloudSync": true,
          "dialIn": true,
          "liveTelemetry": true,
          "machineDiscovery": true,
          "mcpServer": true,
          "pourOver": true,
          "profileManagement": true,
          "pwaInstall": false,
          "recommendations": true,
          "scheduledShots": true,
          "shotHistory": true,
          "systemManagement": true,
          "tailscaleConfig": true,
          "watchtowerUpdate": true,
        }
      `)
    })

    it('DIRECT_FLAGS should match snapshot', () => {
      mockedIsDirectMode.mockReturnValue(true)
      resetFeatureFlags()
      expect(getFeatureFlags()).toMatchInlineSnapshot(`
        {
          "aiFeatures": true,
          "bridgeStatus": false,
          "cloudSync": false,
          "dialIn": true,
          "liveTelemetry": true,
          "machineDiscovery": false,
          "mcpServer": false,
          "pourOver": true,
          "profileManagement": true,
          "pwaInstall": true,
          "recommendations": true,
          "scheduledShots": false,
          "shotHistory": true,
          "systemManagement": false,
          "tailscaleConfig": false,
          "watchtowerUpdate": false,
        }
      `)
    })
  })

  // -------------------------------------------------------------------
  // hasFeature edge cases
  // -------------------------------------------------------------------
  describe('hasFeature edge cases', () => {
    it('unknown feature name returns false', () => {
      // Cast to bypass TypeScript — simulates runtime misuse
      expect(hasFeature('nonExistentFeature' as keyof import('@/lib/featureFlags').FeatureFlags)).toBe(undefined)
    })

    it('returns correct value for every flag in proxy mode', () => {
      mockedIsDirectMode.mockReturnValue(false)
      resetFeatureFlags()
      const flags = getFeatureFlags()
      for (const key of Object.keys(flags) as (keyof typeof flags)[]) {
        expect(hasFeature(key)).toBe(flags[key])
      }
    })

    it('returns correct value for every flag in direct mode', () => {
      mockedIsDirectMode.mockReturnValue(true)
      resetFeatureFlags()
      const flags = getFeatureFlags()
      for (const key of Object.keys(flags) as (keyof typeof flags)[]) {
        expect(hasFeature(key)).toBe(flags[key])
      }
    })
  })
})
