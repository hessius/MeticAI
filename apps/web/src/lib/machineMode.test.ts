import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('machineMode', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  function stubLocation(port: string, protocol = 'http:', host?: string) {
    const resolvedHost = host ?? `meticulous.local:${port}`
    const hostname = resolvedHost.split(':')[0]
    Object.defineProperty(window, 'location', {
      value: {
        port,
        protocol,
        host: resolvedHost,
        hostname,
      },
      writable: true,
      configurable: true,
    })
  }

  function clearMachineMode() {
    vi.stubEnv('VITE_MACHINE_MODE', '')
  }

  // -------------------------------------------------------------------
  // getMachineMode
  // -------------------------------------------------------------------
  describe('getMachineMode', () => {
    it('should return "direct" when VITE_MACHINE_MODE=direct', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'direct')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('direct')
    })

    it('should return "proxy" when VITE_MACHINE_MODE=proxy', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'proxy')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('proxy')
    })

    it('should detect direct mode from port 8080 at runtime', async () => {
      stubLocation('8080')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('direct')
    })

    it('should fall back to proxy when port is not 8080 and no env var', async () => {
      clearMachineMode()
      stubLocation('3550')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('proxy')
    })

    it('should ignore invalid VITE_MACHINE_MODE values', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'bogus')
      stubLocation('3550')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('proxy')
    })

    it('should detect direct mode from port 8080 without env var', async () => {
      clearMachineMode()
      stubLocation('8080')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('direct')
    })

    it('should prioritise env var over runtime port detection', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'proxy')
      stubLocation('8080')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('proxy')
    })
  })

  // -------------------------------------------------------------------
  // isDirectMode
  // -------------------------------------------------------------------
  describe('isDirectMode', () => {
    it('should return true when VITE_MACHINE_MODE=direct', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'direct')
      const { isDirectMode } = await import('@/lib/machineMode')
      expect(isDirectMode()).toBe(true)
    })

    it('should return false when VITE_MACHINE_MODE=proxy', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'proxy')
      const { isDirectMode } = await import('@/lib/machineMode')
      expect(isDirectMode()).toBe(false)
    })

    it('should return true when served from port 8080', async () => {
      stubLocation('8080')
      const { isDirectMode } = await import('@/lib/machineMode')
      expect(isDirectMode()).toBe(true)
    })

    it('should return false when served from any other port', async () => {
      clearMachineMode()
      stubLocation('5173')
      const { isDirectMode } = await import('@/lib/machineMode')
      expect(isDirectMode()).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // getDefaultMachineUrl
  // -------------------------------------------------------------------
  describe('getDefaultMachineUrl', () => {
    it('should return VITE_DEFAULT_MACHINE_URL when set', async () => {
      vi.stubEnv('VITE_DEFAULT_MACHINE_URL', 'http://custom:9999')
      const { getDefaultMachineUrl } = await import('@/lib/machineMode')
      expect(getDefaultMachineUrl()).toBe('http://custom:9999')
    })

    it('should return same-origin URL when on port 8080', async () => {
      stubLocation('8080', 'https:', 'machine.local:8080')
      const { getDefaultMachineUrl } = await import('@/lib/machineMode')
      expect(getDefaultMachineUrl()).toBe('https://machine.local:8080')
    })

    it('should default to http://meticulous.local:8080', async () => {
      stubLocation('3550')
      const { getDefaultMachineUrl } = await import('@/lib/machineMode')
      expect(getDefaultMachineUrl()).toBe('http://meticulous.local:8080')
    })
  })
})
