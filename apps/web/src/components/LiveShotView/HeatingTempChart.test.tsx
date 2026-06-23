import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { HeatingTempChart } from './HeatingTempChart'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))

const lines: { dataKey: unknown }[] = []
const refLines: { y: unknown }[] = []
const yAxes: { domain: unknown }[] = []
let tooltipRenders = 0

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div data-chart-points={JSON.stringify(data)} data-testid="line-chart">{children}</div>
  ),
  Line: (p: { dataKey: unknown }) => { lines.push(p); return null },
  ReferenceLine: (p: { y: unknown }) => { refLines.push(p); return null },
  XAxis: () => null,
  YAxis: (p: { domain: unknown }) => { yAxes.push(p); return null },
  CartesianGrid: () => null,
  Tooltip: () => { tooltipRenders += 1; return null },
  Legend: () => null,
}))

describe('HeatingTempChart', () => {
  it('plots head + chamber series and a single red target line at the set temp', () => {
    lines.length = 0
    refLines.length = 0

    render(
      <HeatingTempChart
        samples={[{ t: 0, temp: 20, chamber: 22 }, { t: 2, temp: 30, chamber: 33 }]}
        setTemp={93}
      />
    )

    expect(lines.map(l => l.dataKey).sort()).toEqual(['chamber', 'temp'])
    expect(refLines.map(r => r.y)).toEqual([93])
  })

  it('does not render a tooltip', () => {
    expect(tooltipRenders).toBe(0)
  })

  it('uses a rolling y-domain fitted to the data + target, not a fixed 0–100 range', () => {
    yAxes.length = 0
    render(
      <HeatingTempChart
        samples={[{ t: 0, temp: 85, chamber: 86 }, { t: 2, temp: 88, chamber: 89 }]}
        setTemp={93}
      />
    )
    const domain = yAxes[yAxes.length - 1].domain as [number, number]
    // Window hugs the data (lo well above 0) and includes the target (93).
    expect(domain[0]).toBeGreaterThan(0)
    expect(domain[1]).toBeGreaterThanOrEqual(93)
    expect(domain[1]).toBeLessThanOrEqual(120)
  })

  it('enforces a minimum y-span when readings are tightly clustered', () => {
    yAxes.length = 0
    render(
      <HeatingTempChart
        samples={[{ t: 0, temp: 92, chamber: 92.5 }]}
        setTemp={93}
      />
    )
    const domain = yAxes[yAxes.length - 1].domain as [number, number]
    expect(domain[1] - domain[0]).toBeGreaterThanOrEqual(20)
  })
})
