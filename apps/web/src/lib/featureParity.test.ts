/**
 * Feature Parity Tests — ensure proxy and direct modes stay in sync.
 *
 * These tests prevent regression by explicitly documenting which features
 * are shared, which are proxy-only, and which are direct-only. If someone
 * adds a flag to one mode but forgets the other, these tests will catch it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => false),
}))

import { isDirectMode } from '@/lib/machineMode'
import { getFeatureFlags, resetFeatureFlags, type FeatureFlags } from '@/lib/featureFlags'

const mockedIsDirectMode = vi.mocked(isDirectMode)

function getProxyFlags(): FeatureFlags {
  mockedIsDirectMode.mockReturnValue(false)
  resetFeatureFlags()
  return getFeatureFlags()
}

function getDirectFlags(): FeatureFlags {
  mockedIsDirectMode.mockReturnValue(true)
  resetFeatureFlags()
  return getFeatureFlags()
}

describe('feature parity between proxy and direct modes', () => {
  beforeEach(() => {
    resetFeatureFlags()
    mockedIsDirectMode.mockReturnValue(false)
  })

  // -------------------------------------------------------------------
  // Structural parity — both flag sets must have identical keys
  // -------------------------------------------------------------------
  describe('structural parity', () => {
    it('PROXY_FLAGS and DIRECT_FLAGS have identical key sets', () => {
      const proxyKeys = Object.keys(getProxyFlags()).sort()
      const directKeys = Object.keys(getDirectFlags()).sort()
      expect(proxyKeys).toEqual(directKeys)
    })

    it('adding a flag to proxy without direct is caught', () => {
      // This is a structural check — if the key sets differ, the test above
      // fails. This test documents the intent: every FeatureFlags key must
      // appear in both PROXY_FLAGS and DIRECT_FLAGS.
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const proxyOnly = Object.keys(proxy).filter(k => !(k in direct))
      const directOnly = Object.keys(direct).filter(k => !(k in proxy))
      expect(proxyOnly).toEqual([])
      expect(directOnly).toEqual([])
    })

    it('both flag sets have the expected total number of flags', () => {
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      // Bump this number when adding new flags — forces conscious acknowledgment
      const EXPECTED_FLAG_COUNT = 16
      expect(Object.keys(proxy)).toHaveLength(EXPECTED_FLAG_COUNT)
      expect(Object.keys(direct)).toHaveLength(EXPECTED_FLAG_COUNT)
    })
  })

  // -------------------------------------------------------------------
  // Shared features — available in BOTH modes with the same value
  // -------------------------------------------------------------------
  describe('shared features (same value in both modes)', () => {
    /**
     * These features work in both proxy and direct modes because they
     * either use the espresso-api directly or run entirely in the browser.
     */
    const SHARED_FEATURES: (keyof FeatureFlags)[] = [
      'aiFeatures',         // Proxy: server-side Gemini; Direct: browser @google/genai
      'liveTelemetry',      // Proxy: WebSocket bridge; Direct: Socket.IO to machine
      'shotHistory',        // Proxy: backend /api/shots; Direct: espresso-api history
      'profileManagement',  // Proxy: backend /api/machine/profiles; Direct: espresso-api
      'pourOver',           // Timer + machine commands — works in both modes
      'dialIn',             // Client-side compass + AI — works in both modes
      'recommendations',    // Token-free engine + optional AI — works in both modes
    ]

    it.each(SHARED_FEATURES)(
      '%s has the same value in both modes',
      (feature) => {
        const proxy = getProxyFlags()
        const direct = getDirectFlags()
        expect(proxy[feature]).toBe(direct[feature])
        // Shared features should be enabled
        expect(proxy[feature]).toBe(true)
      },
    )
  })

  // -------------------------------------------------------------------
  // Proxy-only features — true in proxy, false in direct
  // -------------------------------------------------------------------
  describe('proxy-only features (true in proxy, false in direct)', () => {
    const PROXY_ONLY: { flag: keyof FeatureFlags; reason: string }[] = [
      {
        flag: 'machineDiscovery',
        reason: 'Browsers cannot perform mDNS discovery — requires backend',
      },
      {
        flag: 'scheduledShots',
        reason: 'No persistent scheduler in browser — requires backend cron/APScheduler',
      },
      {
        flag: 'systemManagement',
        reason: 'Requires OS-level access (restart, shutdown) via backend',
      },
      {
        flag: 'tailscaleConfig',
        reason: 'Tailscale CLI is a server-side tool, not accessible from browser',
      },
      {
        flag: 'mcpServer',
        reason: 'MCP server integration runs as a backend process',
      },
      {
        flag: 'cloudSync',
        reason: 'Profile cloud sync requires server-side storage and coordination',
      },
      {
        flag: 'bridgeStatus',
        reason: 'Backend health/bridge monitoring — no backend exists in direct mode',
      },
      {
        flag: 'watchtowerUpdate',
        reason: 'Watchtower is a Docker-side update mechanism, not relevant in PWA',
      },
    ]

    it.each(PROXY_ONLY)(
      '$flag is proxy-only ($reason)',
      ({ flag }) => {
        expect(getProxyFlags()[flag]).toBe(true)
        expect(getDirectFlags()[flag]).toBe(false)
      },
    )

    it('proxy-only list is exhaustive — no unlisted flags differ', () => {
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const proxyOnlyFlags = PROXY_ONLY.map(p => p.flag).sort()

      const actualDifferences = (Object.keys(proxy) as (keyof FeatureFlags)[])
        .filter(k => proxy[k] === true && direct[k] === false)
        .sort()

      expect(actualDifferences).toEqual(proxyOnlyFlags)
    })
  })

  // -------------------------------------------------------------------
  // Direct-only features — true in direct, false in proxy
  // -------------------------------------------------------------------
  describe('direct-only features (true in direct, false in proxy)', () => {
    const DIRECT_ONLY: { flag: keyof FeatureFlags; reason: string }[] = [
      {
        flag: 'pwaInstall',
        reason: 'PWA install prompt only makes sense when served from machine',
      },
    ]

    it.each(DIRECT_ONLY)(
      '$flag is direct-only ($reason)',
      ({ flag }) => {
        expect(getDirectFlags()[flag]).toBe(true)
        expect(getProxyFlags()[flag]).toBe(false)
      },
    )

    it('direct-only list is exhaustive — no unlisted flags differ', () => {
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const directOnlyFlags = DIRECT_ONLY.map(d => d.flag).sort()

      const actualDifferences = (Object.keys(proxy) as (keyof FeatureFlags)[])
        .filter(k => direct[k] === true && proxy[k] === false)
        .sort()

      expect(actualDifferences).toEqual(directOnlyFlags)
    })
  })

  // -------------------------------------------------------------------
  // Classification completeness — every flag is accounted for
  // -------------------------------------------------------------------
  describe('classification completeness', () => {
    const SHARED: (keyof FeatureFlags)[] = [
      'aiFeatures', 'liveTelemetry', 'shotHistory', 'profileManagement',
      'pourOver', 'dialIn', 'recommendations',
    ]
    const PROXY_ONLY: (keyof FeatureFlags)[] = [
      'machineDiscovery', 'scheduledShots', 'systemManagement',
      'tailscaleConfig', 'mcpServer', 'cloudSync', 'bridgeStatus', 'watchtowerUpdate',
    ]
    const DIRECT_ONLY: (keyof FeatureFlags)[] = [
      'pwaInstall',
    ]

    it('every feature flag is classified as shared, proxy-only, or direct-only', () => {
      const allClassified = [...SHARED, ...PROXY_ONLY, ...DIRECT_ONLY].sort()
      const allFlags = Object.keys(getProxyFlags()).sort()
      expect(allClassified).toEqual(allFlags)
    })

    it('no flag appears in multiple categories', () => {
      const all = [...SHARED, ...PROXY_ONLY, ...DIRECT_ONLY]
      const unique = new Set(all)
      expect(unique.size).toBe(all.length)
    })
  })
})
