import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock machineMode
vi.mock('@/lib/machineMode', () => ({
  isNativePlatform: vi.fn(() => false),
}))

// Mock @capacitor/core — tests run as web (non-native) so CapacitorHttp isn't used
vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    get: vi.fn(),
  },
}))

// Mock capacitor-zeroconf — only used on native
vi.mock('capacitor-zeroconf', () => ({
  ZeroConf: {
    watch: vi.fn(),
    unwatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock machineUrl — persistMachineUrl writes to Capacitor storage / fires events
vi.mock('./machineUrl', () => ({
  persistMachineUrl: vi.fn().mockResolvedValue(undefined),
}))

import { isNativePlatform } from '@/lib/machineMode'
import {
  parseMachineInput,
  discoverMachines,
  scanMachineQR,
  testMachineConnection,
  machineUrlCandidates,
  resolveReachableMachineUrl,
  resolveAndHealMachineUrl,
  isPrivateIPv4,
  parseIPv4FromCandidate,
  getLocalIPv4ViaWebRTC,
  scanLocalSubnet,
} from './discovery'
import { CapacitorHttp } from '@capacitor/core'
import { persistMachineUrl } from './machineUrl'

const mockedPersist = vi.mocked(persistMachineUrl)

const mockedIsNative = vi.mocked(isNativePlatform)

describe('discovery', () => {
  beforeEach(() => {
    mockedIsNative.mockReturnValue(false)
  })

  // -------------------------------------------------------------------
  // parseMachineInput
  // -------------------------------------------------------------------
  describe('parseMachineInput', () => {
    it('should parse a plain IP address', () => {
      const result = parseMachineInput('192.168.1.42')
      expect(result).toEqual({
        name: '192.168.1.42',
        host: '192.168.1.42',
        port: 8080,
        url: 'http://192.168.1.42:8080',
      })
    })

    it('should parse an IP with port', () => {
      const result = parseMachineInput('192.168.1.42:9090')
      expect(result).toEqual({
        name: '192.168.1.42',
        host: '192.168.1.42',
        port: 9090,
        url: 'http://192.168.1.42:9090',
      })
    })

    it('should parse a .local hostname', () => {
      const result = parseMachineInput('meticulous-a3f7.local')
      expect(result).toEqual({
        name: 'meticulous-a3f7.local',
        host: 'meticulous-a3f7.local',
        port: 8080,
        url: 'http://meticulous-a3f7.local:8080',
      })
    })

    it('should parse a full http URL', () => {
      const result = parseMachineInput('http://192.168.1.42:8080')
      expect(result).toEqual({
        name: '192.168.1.42',
        host: '192.168.1.42',
        port: 8080,
        url: 'http://192.168.1.42:8080',
      })
    })

    it('should parse a https URL with explicit port', () => {
      const result = parseMachineInput('https://machine.local:8443')
      expect(result).toEqual({
        name: 'machine.local',
        host: 'machine.local',
        port: 8443,
        url: 'https://machine.local:8443',
      })
    })

    it('should default port to 8080 when URL has no port', () => {
      const result = parseMachineInput('http://machine.local')
      expect(result).toEqual({
        name: 'machine.local',
        host: 'machine.local',
        port: 8080,
        url: 'http://machine.local:8080',
      })
    })

    it('should trim whitespace', () => {
      const result = parseMachineInput('  192.168.1.42  ')
      expect(result).not.toBeNull()
      expect(result!.host).toBe('192.168.1.42')
    })

    it('should return null for empty input', () => {
      expect(parseMachineInput('')).toBeNull()
      expect(parseMachineInput('  ')).toBeNull()
    })
  })

  // -------------------------------------------------------------------
  // discoverMachines
  // -------------------------------------------------------------------
  describe('discoverMachines', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return empty array when probe fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
      expect(await discoverMachines()).toEqual([])
    })

    it('should return machine when probe gets 200 from machine API', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )
      const machines = await discoverMachines()
      expect(machines.length).toBeGreaterThanOrEqual(1)
      expect(machines[0].host).toBe('meticulous.local')
      expect(machines[0].port).toBe(8080)
    })

    it('should return machine when probe gets 404 (API responding, no shot data)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 404 }),
      )
      const machines = await discoverMachines()
      expect(machines.length).toBeGreaterThanOrEqual(1)
      expect(machines[0].host).toBe('meticulous.local')
    })

    it('should return empty array when probe gets 500', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 500 }),
      )
      expect(await discoverMachines()).toEqual([])
    })

    it('should not throw when ZeroConf emits an undefined/service-less watch result (Android)', async () => {
      // On Android the capacitor-zeroconf watch callback can fire with an
      // undefined or service-less result; reading result.service unguarded
      // threw "Cannot read properties of undefined (reading 'service')".
      vi.useFakeTimers()
      try {
        mockedIsNative.mockReturnValue(true)
        const { ZeroConf } = await import('capacitor-zeroconf')
        const callbacks: Array<(r: unknown) => void> = []
        vi.mocked(ZeroConf.watch).mockImplementation(((_opts: unknown, cb: (r: unknown) => void) => {
          callbacks.push(cb)
          return Promise.resolve(undefined)
        }) as unknown as typeof ZeroConf.watch)
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))

        const promise = discoverMachines()
        // The lazy plugin import resolves on the next microtask, after which the
        // single watch callback is registered before the discovery timeout.
        await vi.advanceTimersByTimeAsync(0)
        expect(callbacks.length).toBe(1)
        for (const cb of callbacks) {
          expect(() => cb(undefined)).not.toThrow()
          expect(() => cb({ action: 'added' })).not.toThrow()
          expect(() => cb({ action: 'resolved', service: undefined })).not.toThrow()
        }
        await vi.advanceTimersByTimeAsync(10000)
        await expect(promise).resolves.toEqual([])
      } finally {
        vi.useRealTimers()
        mockedIsNative.mockReturnValue(false)
      }
    })

    it('should watch ONLY _meticulous._tcp on native (Android single-browser constraint)', async () => {
      // The capacitor-zeroconf JmDNS backend on Android only registers a
      // browser on the FIRST watch() call; a second concurrent watch (e.g. a
      // diagnostic _http._tcp browse) is silently ignored, which previously
      // prevented the real _meticulous._tcp browse from ever starting and made
      // auto-detection always fail on Android.
      vi.useFakeTimers()
      try {
        mockedIsNative.mockReturnValue(true)
        const { ZeroConf } = await import('capacitor-zeroconf')
        const watchedTypes: string[] = []
        vi.mocked(ZeroConf.watch).mockImplementation(((opts: { type: string }) => {
          watchedTypes.push(opts.type)
          return Promise.resolve(undefined)
        }) as unknown as typeof ZeroConf.watch)
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))

        const promise = discoverMachines()
        await vi.advanceTimersByTimeAsync(0)
        expect(watchedTypes).toEqual(['_meticulous._tcp'])
        await vi.advanceTimersByTimeAsync(10000)
        await promise
      } finally {
        vi.useRealTimers()
        mockedIsNative.mockReturnValue(false)
      }
    })

    it('returns the resolved IPv4 (not the randomized .local host) on native', async () => {
      // The core Android fix: a machine resolved to a private IPv4 must be
      // returned by its IP, never the unreachable `.local` hostname.
      vi.useFakeTimers()
      try {
        mockedIsNative.mockReturnValue(true)
        const { ZeroConf } = await import('capacitor-zeroconf')
        let cb: ((r: unknown) => void) | null = null
        vi.mocked(ZeroConf.watch).mockImplementation(((_opts: unknown, c: (r: unknown) => void) => {
          cb = c
          return Promise.resolve(undefined)
        }) as unknown as typeof ZeroConf.watch)
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))

        const promise = discoverMachines()
        await vi.advanceTimersByTimeAsync(0)
        cb?.({
          action: 'resolved',
          service: {
            name: 'Meticulous-a3f7',
            hostname: 'Meticulous-a3f7.local',
            ipv4Addresses: ['192.168.50.168'],
            port: 8080,
          },
        })
        // Early-resolve fires 2s after a single IPv4 hit.
        await vi.advanceTimersByTimeAsync(2100)
        const machines = await promise
        expect(machines).toEqual([
          {
            name: 'Meticulous-a3f7',
            host: '192.168.50.168',
            port: 8080,
            url: 'http://192.168.50.168:8080',
          },
        ])
      } finally {
        vi.useRealTimers()
        mockedIsNative.mockReturnValue(false)
      }
    })
  })

  // -------------------------------------------------------------------
  // Subnet-scan fallback helpers (native)
  // -------------------------------------------------------------------
  describe('isPrivateIPv4', () => {
    it('accepts RFC 1918 ranges', () => {
      expect(isPrivateIPv4('192.168.50.168')).toBe(true)
      expect(isPrivateIPv4('10.0.0.5')).toBe(true)
      expect(isPrivateIPv4('172.16.0.1')).toBe(true)
      expect(isPrivateIPv4('172.31.255.254')).toBe(true)
    })
    it('rejects public / link-local / non-IPv4', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false)
      expect(isPrivateIPv4('169.254.1.1')).toBe(false)
      expect(isPrivateIPv4('172.32.0.1')).toBe(false)
      expect(isPrivateIPv4('meticulous.local')).toBe(false)
    })
  })

  describe('parseIPv4FromCandidate', () => {
    it('extracts the LAN IPv4 from a host candidate', () => {
      const cand = 'candidate:1 1 udp 2122260223 192.168.50.10 55328 typ host generation 0'
      expect(parseIPv4FromCandidate(cand)).toBe('192.168.50.10')
    })
    it('returns null for non-host (srflx) candidates', () => {
      const cand = 'candidate:2 1 udp 1686052607 203.0.113.5 55328 typ srflx raddr 0.0.0.0'
      expect(parseIPv4FromCandidate(cand)).toBeNull()
    })
    it('returns null for mDNS-obfuscated (.local) candidates', () => {
      const cand = 'candidate:3 1 udp 2122260223 abcd-1234.local 55328 typ host generation 0'
      expect(parseIPv4FromCandidate(cand)).toBeNull()
    })
  })

  describe('getLocalIPv4ViaWebRTC', () => {
    afterEach(() => {
      delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection
    })

    it('resolves the private IPv4 from the first host candidate', async () => {
      class FakePC {
        onicecandidate: ((e: unknown) => void) | null = null
        createDataChannel() {}
        async createOffer() { return {} }
        async setLocalDescription() {
          // Emit candidates asynchronously, as a real PC would.
          setTimeout(() => {
            this.onicecandidate?.({
              candidate: { candidate: 'candidate:1 1 udp 1 192.168.50.10 5 typ host' },
            })
          }, 0)
        }
        close() {}
      }
      ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePC
      expect(await getLocalIPv4ViaWebRTC(1000)).toBe('192.168.50.10')
    })

    it('resolves null when WebRTC is unavailable', async () => {
      expect(await getLocalIPv4ViaWebRTC(50)).toBeNull()
    })

    it('resolves null (timeout) when only obfuscated candidates arrive', async () => {
      class FakePC {
        onicecandidate: ((e: unknown) => void) | null = null
        createDataChannel() {}
        async createOffer() { return {} }
        async setLocalDescription() {
          setTimeout(() => {
            this.onicecandidate?.({
              candidate: { candidate: 'candidate:1 1 udp 1 abcd.local 5 typ host' },
            })
          }, 0)
        }
        close() {}
      }
      ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePC
      expect(await getLocalIPv4ViaWebRTC(30)).toBeNull()
    })
  })

  describe('scanLocalSubnet', () => {
    beforeEach(() => {
      mockedIsNative.mockReturnValue(true)
    })
    afterEach(() => {
      vi.restoreAllMocks()
      mockedIsNative.mockReturnValue(false)
    })

    it('returns the first host that answers on the /24 (via CapacitorHttp)', async () => {
      vi.mocked(CapacitorHttp.get).mockImplementation(async ({ url }: { url: string }) => {
        return { status: url.includes('192.168.50.42:') ? 200 : 0, data: '', headers: {}, url } as never
      })
      const machine = await scanLocalSubnet('192.168.50.10')
      expect(machine?.host).toBe('192.168.50.42')
      expect(machine?.url).toBe('http://192.168.50.42:8080')
    })

    it('returns null when no host answers', async () => {
      vi.mocked(CapacitorHttp.get).mockRejectedValue(new Error('unreachable'))
      expect(await scanLocalSubnet('192.168.50.10')).toBeNull()
    })

    it('refuses to scan a non-private base address', async () => {
      expect(await scanLocalSubnet('8.8.8.8')).toBeNull()
    })
  })

  // -------------------------------------------------------------------
  // scanMachineQR
  // -------------------------------------------------------------------
  describe('scanMachineQR', () => {
    it('should return null on web', async () => {
      expect(await scanMachineQR()).toBeNull()
    })

    it('should return null on native (placeholder)', async () => {
      mockedIsNative.mockReturnValue(true)
      expect(await scanMachineQR()).toBeNull()
    })
  })

  // -------------------------------------------------------------------
  // testMachineConnection
  // -------------------------------------------------------------------
  describe('testMachineConnection', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return true when machine responds with 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )
      expect(await testMachineConnection('http://192.168.1.42:8080')).toBe(true)
    })

    it('should return true when machine responds with 404 (API alive, no data)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 404 }),
      )
      expect(await testMachineConnection('http://192.168.1.42:8080')).toBe(true)
    })

    it('should return false when machine responds with error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 500 }),
      )
      expect(await testMachineConnection('http://192.168.1.42:8080')).toBe(false)
    })

    it('should return false when fetch throws (network error)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
      expect(await testMachineConnection('http://192.168.1.42:8080')).toBe(false)
    })

    it('should return true for demo mode without fetching', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(await testMachineConnection('demo')).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------
  // machineUrlCandidates
  // -------------------------------------------------------------------
  describe('machineUrlCandidates', () => {
    it('adds a port-80 fallback for an explicit non-default http port', () => {
      expect(machineUrlCandidates('http://192.168.1.42:8080')).toEqual([
        'http://192.168.1.42:8080',
        'http://192.168.1.42',
      ])
    })

    it('does not add a fallback for a bare host (already port 80)', () => {
      expect(machineUrlCandidates('http://192.168.1.42')).toEqual([
        'http://192.168.1.42',
      ])
    })

    it('does not add a fallback for an explicit port 80', () => {
      expect(machineUrlCandidates('http://192.168.1.42:80')).toEqual([
        'http://192.168.1.42:80',
      ])
    })

    it('does not add a fallback for https', () => {
      expect(machineUrlCandidates('https://machine.local:8443')).toEqual([
        'https://machine.local:8443',
      ])
    })
  })

  // -------------------------------------------------------------------
  // resolveReachableMachineUrl
  // -------------------------------------------------------------------
  describe('resolveReachableMachineUrl', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns the given url when the configured port answers', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )
      expect(await resolveReachableMachineUrl('http://192.168.1.42:8080')).toBe(
        'http://192.168.1.42:8080',
      )
    })

    it('falls back to port 80 when :8080 is unreachable (older firmware)', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (async (input: RequestInfo | URL) => {
          const u = String(input)
          if (u.includes(':8080')) throw new Error('unreachable')
          return new Response('{}', { status: 200 })
        }) as typeof fetch,
      )
      expect(await resolveReachableMachineUrl('http://192.168.1.42:8080')).toBe(
        'http://192.168.1.42',
      )
    })

    it('returns null when no candidate responds', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
      expect(await resolveReachableMachineUrl('http://192.168.1.42:8080')).toBeNull()
    })

    it('resolves demo without fetching', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(await resolveReachableMachineUrl('demo')).toBe('demo')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------
  // resolveAndHealMachineUrl
  // -------------------------------------------------------------------
  describe('resolveAndHealMachineUrl', () => {
    beforeEach(() => {
      mockedPersist.mockClear()
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns the stored url and does not persist when it is already reachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )
      expect(await resolveAndHealMachineUrl('http://192.168.1.42:8080')).toBe(
        'http://192.168.1.42:8080',
      )
      expect(mockedPersist).not.toHaveBeenCalled()
    })

    it('heals to port 80 and persists it when :8080 is refused', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (async (input: RequestInfo | URL) => {
          const u = String(input)
          if (u.includes(':8080')) throw new Error('ECONNREFUSED')
          return new Response('{}', { status: 200 })
        }) as typeof fetch,
      )
      expect(await resolveAndHealMachineUrl('http://192.168.1.42:8080')).toBe(
        'http://192.168.1.42',
      )
      expect(mockedPersist).toHaveBeenCalledWith('http://192.168.1.42')
    })

    it('keeps the stored url (no persist) when nothing is reachable and discovery finds nothing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unreachable'))
      expect(await resolveAndHealMachineUrl('http://192.168.1.42:8080')).toBe(
        'http://192.168.1.42:8080',
      )
      expect(mockedPersist).not.toHaveBeenCalled()
    })

    it('resolves demo without fetching or persisting', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      expect(await resolveAndHealMachineUrl('demo')).toBe('demo')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(mockedPersist).not.toHaveBeenCalled()
    })
  })
})
