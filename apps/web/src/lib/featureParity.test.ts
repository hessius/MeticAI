/**
 * Feature Parity Tests — ensure proxy, direct PWA, and Capacitor mode
 * capabilities stay intentional and documented.
 *
 * These tests prevent regression by explicitly documenting which features
 * are shared, which are backend-only, and which differ for Direct PWA or
 * Capacitor. If someone adds a flag to one mode but forgets the others,
 * these tests will catch it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => false),
  isNativePlatform: vi.fn(() => false),
  isDemoMode: vi.fn(() => false),
}))

import { isDirectMode, isNativePlatform } from '@/lib/machineMode'
import {
  MODE_CAPABILITY_MATRIX,
  getFeatureFlags,
  resetFeatureFlags,
  type FeatureFlags,
} from '@/lib/featureFlags'

const mockedIsDirectMode = vi.mocked(isDirectMode)
const mockedIsNativePlatform = vi.mocked(isNativePlatform)

function getProxyFlags(): FeatureFlags {
  mockedIsDirectMode.mockReturnValue(false)
  mockedIsNativePlatform.mockReturnValue(false)
  resetFeatureFlags()
  return getFeatureFlags()
}

function getDirectFlags(): FeatureFlags {
  mockedIsDirectMode.mockReturnValue(true)
  mockedIsNativePlatform.mockReturnValue(false)
  resetFeatureFlags()
  return getFeatureFlags()
}

function getCapacitorFlags(): FeatureFlags {
  mockedIsDirectMode.mockReturnValue(true)
  mockedIsNativePlatform.mockReturnValue(true)
  resetFeatureFlags()
  return getFeatureFlags()
}

type ModeValues = {
  proxy: boolean
  directPwa: boolean
  capacitor: boolean
}

const EXPECTED_MODE_CAPABILITIES: Record<keyof FeatureFlags, ModeValues> = {
  machineDiscovery: { proxy: true, directPwa: false, capacitor: true },
  scheduledShots: { proxy: true, directPwa: false, capacitor: false },
  systemManagement: { proxy: true, directPwa: false, capacitor: false },
  tailscaleConfig: { proxy: true, directPwa: false, capacitor: false },
  mcpServer: { proxy: true, directPwa: false, capacitor: false },
  cloudSync: { proxy: true, directPwa: false, capacitor: false },
  aiFeatures: { proxy: true, directPwa: true, capacitor: true },
  liveTelemetry: { proxy: true, directPwa: true, capacitor: true },
  shotHistory: { proxy: true, directPwa: true, capacitor: true },
  profileManagement: { proxy: true, directPwa: true, capacitor: true },
  pourOver: { proxy: true, directPwa: true, capacitor: true },
  dialIn: { proxy: true, directPwa: true, capacitor: true },
  recommendations: { proxy: true, directPwa: true, capacitor: true },
  pwaInstall: { proxy: false, directPwa: true, capacitor: false },
  bridgeStatus: { proxy: true, directPwa: false, capacitor: false },
  watchtowerUpdate: { proxy: true, directPwa: false, capacitor: false },
}

describe('feature parity between proxy, direct PWA, and Capacitor modes', () => {
  beforeEach(() => {
    resetFeatureFlags()
    mockedIsDirectMode.mockReturnValue(false)
    mockedIsNativePlatform.mockReturnValue(false)
  })

  // -------------------------------------------------------------------
  // Structural parity — all mode flag sets must have identical keys
  // -------------------------------------------------------------------
  describe('structural parity', () => {
    it('PROXY, DIRECT_PWA, and CAPACITOR modes have identical key sets', () => {
      const proxyKeys = Object.keys(getProxyFlags()).sort()
      const directKeys = Object.keys(getDirectFlags()).sort()
      const capacitorKeys = Object.keys(getCapacitorFlags()).sort()
      expect(proxyKeys).toEqual(directKeys)
      expect(proxyKeys).toEqual(capacitorKeys)
    })

    it('adding a flag to one mode without the others is caught', () => {
      // This is a structural check — if the key sets differ, the test above
      // fails. This test documents the intent: every FeatureFlags key appears
      // in proxy, direct PWA, and Capacitor.
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const capacitor = getCapacitorFlags()
      const proxyOnly = Object.keys(proxy).filter(k => !(k in direct))
      const directOnly = Object.keys(direct).filter(k => !(k in proxy))
      const missingFromCapacitor = Object.keys(proxy).filter(k => !(k in capacitor))
      expect(proxyOnly).toEqual([])
      expect(directOnly).toEqual([])
      expect(missingFromCapacitor).toEqual([])
    })

    it('all flag sets have the expected total number of flags', () => {
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const capacitor = getCapacitorFlags()
      // Bump this number when adding new flags — forces conscious acknowledgment
      const EXPECTED_FLAG_COUNT = 16
      expect(Object.keys(proxy)).toHaveLength(EXPECTED_FLAG_COUNT)
      expect(Object.keys(direct)).toHaveLength(EXPECTED_FLAG_COUNT)
      expect(Object.keys(capacitor)).toHaveLength(EXPECTED_FLAG_COUNT)
    })
  })

  // -------------------------------------------------------------------
  // Shared features — available in all modes with the same value
  // -------------------------------------------------------------------
  describe('shared features (same value in all modes)', () => {
    /**
      * These features work across proxy, direct PWA, and Capacitor because
      * they use direct machine APIs or run entirely in the client.
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
      '%s has the same value in all modes',
      (feature) => {
        const proxy = getProxyFlags()
        const direct = getDirectFlags()
        const capacitor = getCapacitorFlags()
        expect(proxy[feature]).toBe(direct[feature])
        expect(proxy[feature]).toBe(capacitor[feature])
        // Shared features should be enabled
        expect(proxy[feature]).toBe(true)
      },
    )
  })

  // -------------------------------------------------------------------
  // Explicit mode matrix — every flag has intentional values per mode
  // -------------------------------------------------------------------
  describe('explicit mode capability matrix', () => {
    it('featureFlags exports the approved three-mode capability matrix', () => {
      expect(MODE_CAPABILITY_MATRIX).toEqual({
        proxy: expect.any(Object),
        directPwa: expect.any(Object),
        capacitor: expect.any(Object),
      })
    })

    it.each(Object.entries(EXPECTED_MODE_CAPABILITIES) as [keyof FeatureFlags, ModeValues][])(
      '%s matches the approved proxy/direct PWA/Capacitor values',
      (feature, expected) => {
        expect(getProxyFlags()[feature]).toBe(expected.proxy)
        expect(getDirectFlags()[feature]).toBe(expected.directPwa)
        expect(getCapacitorFlags()[feature]).toBe(expected.capacitor)
        expect(MODE_CAPABILITY_MATRIX.proxy[feature]).toBe(expected.proxy)
        expect(MODE_CAPABILITY_MATRIX.directPwa[feature]).toBe(expected.directPwa)
        expect(MODE_CAPABILITY_MATRIX.capacitor[feature]).toBe(expected.capacitor)
      },
    )
  })

  // -------------------------------------------------------------------
  // Backend-only features — true in proxy, false in direct/capacitor
  // -------------------------------------------------------------------
  describe('backend-only features (true in proxy, false in direct/capacitor)', () => {
    const BACKEND_ONLY: { flag: keyof FeatureFlags; reason: string }[] = [
      {
        flag: 'scheduledShots',
        reason: 'No persistent browser/native scheduler is available and tested yet',
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
        reason: 'Machine/profile sync controls depend on the backend profile database',
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

    it.each(BACKEND_ONLY)(
      '$flag is backend-only ($reason)',
      ({ flag }) => {
        expect(getProxyFlags()[flag]).toBe(true)
        expect(getDirectFlags()[flag]).toBe(false)
        expect(getCapacitorFlags()[flag]).toBe(false)
      },
    )

    it('backend-only list is exhaustive — no unlisted flags are true only in proxy', () => {
      const proxy = getProxyFlags()
      const direct = getDirectFlags()
      const capacitor = getCapacitorFlags()
      const backendOnlyFlags = BACKEND_ONLY.map(p => p.flag).sort()

      const actualDifferences = (Object.keys(proxy) as (keyof FeatureFlags)[])
        .filter(k => proxy[k] === true && direct[k] === false && capacitor[k] === false)
        .sort()

      expect(actualDifferences).toEqual(backendOnlyFlags)
    })
  })

  // -------------------------------------------------------------------
  // Discovery and install mode differences
  // -------------------------------------------------------------------
  describe('mode-specific discovery and install differences', () => {
    it('machine discovery is available in proxy and Capacitor, but not browser direct PWA', () => {
      expect(getProxyFlags().machineDiscovery).toBe(true)
      expect(getDirectFlags().machineDiscovery).toBe(false)
      expect(getCapacitorFlags().machineDiscovery).toBe(true)
    })

    it('PWA install is available only in direct PWA mode', () => {
      expect(getProxyFlags().pwaInstall).toBe(false)
      expect(getDirectFlags().pwaInstall).toBe(true)
      expect(getCapacitorFlags().pwaInstall).toBe(false)
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
    const BACKEND_ONLY: (keyof FeatureFlags)[] = [
      'scheduledShots', 'systemManagement',
      'tailscaleConfig', 'mcpServer', 'cloudSync', 'bridgeStatus', 'watchtowerUpdate',
    ]
    const PROXY_AND_CAPACITOR: (keyof FeatureFlags)[] = ['machineDiscovery']
    const DIRECT_PWA_ONLY: (keyof FeatureFlags)[] = [
      'pwaInstall',
    ]

    it('every feature flag is classified by its three-mode availability pattern', () => {
      const allClassified = [...SHARED, ...BACKEND_ONLY, ...PROXY_AND_CAPACITOR, ...DIRECT_PWA_ONLY].sort()
      const allFlags = Object.keys(getProxyFlags()).sort()
      expect(allClassified).toEqual(allFlags)
    })

    it('no flag appears in multiple categories', () => {
      const all = [...SHARED, ...BACKEND_ONLY, ...PROXY_AND_CAPACITOR, ...DIRECT_PWA_ONLY]
      const unique = new Set(all)
      expect(unique.size).toBe(all.length)
    })
  })
})
