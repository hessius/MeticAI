import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MachineStatusCenter } from './MachineStatusCenter'

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'machineStatus.title': 'Machine Status',
        'machineStatus.serviceHealth': 'Service Health',
        'machineStatus.systemMetrics': 'System Metrics',
        'machineStatus.diskUsage': 'Disk Usage',
        'machineStatus.memoryUsage': 'Memory Usage',
        'machineStatus.cpuTemperature': 'CPU Temperature',
        'machineStatus.uptime': 'Uptime',
        'machineStatus.lastUpdated': 'Last updated',
        'machineStatus.refreshing': 'Refreshing...',
        'machineStatus.unavailable': 'Machine status unavailable',
        'machineStatus.retry': 'Retry',
        'machineStatus.autoRefresh': 'Auto-refresh in',
        'machineStatus.networkStatus': 'Network',
        'machineStatus.justNow': 'just now',
        'machineStatus.secondsAgo': '{{count}}s ago',
        'machineStatus.hostname': 'Hostname',
        'machineStatus.firmware': 'Firmware',
        'machineStatus.wifi': 'WiFi',
        'machineStatus.statusRunning': 'Running',
        'machineStatus.statusDegraded': 'Degraded',
        'machineStatus.statusStopped': 'Stopped',
        'machineStatus.unitDay': 'd',
        'machineStatus.unitHour': 'h',
        'machineStatus.unitMinute': 'm',
        'common.back': 'Back',
      }
      let result = translations[key] ?? key
      if (typeof fallbackOrOpts === 'object' && fallbackOrOpts) {
        for (const [k, v] of Object.entries(fallbackOrOpts)) {
          result = result.replace(`{{${k}}}`, String(v))
        }
      }
      return result
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn().mockResolvedValue('http://localhost:3550'),
}))

const mockOnBack = vi.fn()

function createMockResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('MachineStatusCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockOnBack.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders service cards when data is available', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (urlStr.includes('/status/health')) {
        return Promise.resolve(createMockResponse({
          services: [
            { name: 'meticulous', status: 'running', uptime: 3600 },
            { name: 'watcher', status: 'running', uptime: 7200 },
          ],
          system: { cpu_temperature: 55, uptime: 86400 },
        }))
      }
      if (urlStr.includes('/system-info')) {
        return Promise.resolve(createMockResponse({ firmware: null, network: null, hostname: null }))
      }
      return Promise.resolve(createMockResponse({}))
    })

    await act(async () => {
      render(<MachineStatusCenter onBack={mockOnBack} />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('service-card-meticulous')).toBeTruthy()
      expect(screen.getByTestId('service-card-watcher')).toBeTruthy()
    })

    fetchSpy.mockRestore()
  })

  it('shows error state when watcher is unreachable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.reject(new Error('Network error'))
    })

    await act(async () => {
      render(<MachineStatusCenter onBack={mockOnBack} />)
    })

    await waitFor(() => {
      expect(screen.getByText('Machine status unavailable')).toBeTruthy()
    })

    // Retry button should be visible
    const retryButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.includes('Retry')
    )
    expect(retryButtons.length).toBeGreaterThan(0)

    fetchSpy.mockRestore()
  })

  it('auto-refresh countdown ticks down', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (urlStr.includes('/status/health')) {
        return Promise.resolve(createMockResponse({
          services: [{ name: 'test', status: 'running' }],
          system: null,
        }))
      }
      return Promise.resolve(createMockResponse({}))
    })

    await act(async () => {
      render(<MachineStatusCenter onBack={mockOnBack} />)
    })

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText(/Auto-refresh in/)).toBeTruthy()
    })

    // The countdown should show 30s initially, then tick down
    const autoRefreshText = screen.getByText(/Auto-refresh in/)
    expect(autoRefreshText.textContent).toContain('30s')

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(autoRefreshText.textContent).toContain('25s')
    })

    fetchSpy.mockRestore()
  })
})
