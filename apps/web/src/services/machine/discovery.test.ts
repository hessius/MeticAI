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
  registerPlugin: vi.fn(() => ({
    browse: vi.fn().mockResolvedValue({ machines: [] }),
  })),
}))

import { isNativePlatform } from '@/lib/machineMode'
import {
  parseMachineInput,
  discoverMachines,
  scanMachineQR,
  testMachineConnection,
} from './discovery'

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
      expect(machines).toHaveLength(1)
      expect(machines[0].host).toBe('meticulous.local')
      expect(machines[0].port).toBe(8080)
    })

    it('should return machine when probe gets 404 (API responding, no shot data)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 404 }),
      )
      const machines = await discoverMachines()
      expect(machines).toHaveLength(1)
      expect(machines[0].host).toBe('meticulous.local')
    })

    it('should return empty array when probe gets 500', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('', { status: 500 }),
      )
      expect(await discoverMachines()).toEqual([])
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
})
