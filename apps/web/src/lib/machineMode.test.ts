import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('machineMode', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.resetModules()
    // Clear any lingering Capacitor stub
    delete (window as Record<string, unknown>).Capacitor
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    delete (window as Record<string, unknown>).Capacitor
    localStorage.clear()
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

  function stubCapacitor() {
    ;(window as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
    }
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

    it('should return "direct" when VITE_MACHINE_MODE=capacitor', async () => {
      vi.stubEnv('VITE_MACHINE_MODE', 'capacitor')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('direct')
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

    it('should return "direct" when Capacitor native is detected', async () => {
      stubCapacitor()
      clearMachineMode()
      stubLocation('3550')
      const { getMachineMode } = await import('@/lib/machineMode')
      expect(getMachineMode()).toBe('direct')
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

    it('should return true when Capacitor native is detected', async () => {
      stubCapacitor()
      clearMachineMode()
      stubLocation('3550')
      const { isDirectMode } = await import('@/lib/machineMode')
      expect(isDirectMode()).toBe(true)
    })
  })

  // -------------------------------------------------------------------
  // isNativePlatform
  // -------------------------------------------------------------------
  describe('isNativePlatform', () => {
    it('should return false when Capacitor is not present', async () => {
      const { isNativePlatform } = await import('@/lib/machineMode')
      expect(isNativePlatform()).toBe(false)
    })

    it('should return true when Capacitor.isNativePlatform() returns true', async () => {
      stubCapacitor()
      const { isNativePlatform } = await import('@/lib/machineMode')
      expect(isNativePlatform()).toBe(true)
    })

    it('should return false when Capacitor exists but isNativePlatform returns false', async () => {
      ;(window as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => false,
      }
      const { isNativePlatform } = await import('@/lib/machineMode')
      expect(isNativePlatform()).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // getRuntimePlatform
  // -------------------------------------------------------------------
  describe('getRuntimePlatform', () => {
    it('should return "native" when Capacitor is detected', async () => {
      stubCapacitor()
      const { getRuntimePlatform } = await import('@/lib/machineMode')
      expect(getRuntimePlatform()).toBe('native')
    })

    it('should return "machine-hosted" when on port 8080', async () => {
      stubLocation('8080')
      const { getRuntimePlatform } = await import('@/lib/machineMode')
      expect(getRuntimePlatform()).toBe('machine-hosted')
    })

    it('should return "web" for standard browser', async () => {
      stubLocation('3550')
      const { getRuntimePlatform } = await import('@/lib/machineMode')
      expect(getRuntimePlatform()).toBe('web')
    })

    it('should prioritise native over port detection', async () => {
      stubCapacitor()
      stubLocation('8080')
      const { getRuntimePlatform } = await import('@/lib/machineMode')
      expect(getRuntimePlatform()).toBe('native')
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

    it('should return stored machine URL when set', async () => {
      localStorage.setItem('meticai-machine-url', 'http://192.168.1.50:8080')
      stubLocation('3550')
      const { getDefaultMachineUrl } = await import('@/lib/machineMode')
      expect(getDefaultMachineUrl()).toBe('http://192.168.1.50:8080')
    })

    it('should prefer env var over stored URL', async () => {
      vi.stubEnv('VITE_DEFAULT_MACHINE_URL', 'http://env-machine:8080')
      localStorage.setItem('meticai-machine-url', 'http://stored:8080')
      const { getDefaultMachineUrl } = await import('@/lib/machineMode')
      expect(getDefaultMachineUrl()).toBe('http://env-machine:8080')
    })
  })

  // -------------------------------------------------------------------
  // setMachineUrl
  // -------------------------------------------------------------------
  describe('setMachineUrl', () => {
    it('should persist URL to localStorage', async () => {
      const { setMachineUrl } = await import('@/lib/machineMode')
      setMachineUrl('http://192.168.1.100:8080')
      expect(localStorage.getItem('meticai-machine-url')).toBe('http://192.168.1.100:8080')
    })
  })
})
