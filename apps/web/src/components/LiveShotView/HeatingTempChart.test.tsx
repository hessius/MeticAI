import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { HeatingTempChart } from './HeatingTempChart'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))

const lines: { dataKey: unknown }[] = []
const refLines: { y: unknown }[] = []

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div data-chart-points={JSON.stringify(data)} data-testid="line-chart">{children}</div>
  ),
  Line: (p: { dataKey: unknown }) => { lines.push(p); return null },
  ReferenceLine: (p: { y: unknown }) => { refLines.push(p); return null },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}))

describe('HeatingTempChart', () => {
  it('plots head + chamber series and set + lance-ready target lines', () => {
    lines.length = 0
    refLines.length = 0

    render(
      <HeatingTempChart
        samples={[{ t: 0, temp: 20, chamber: 22 }, { t: 2, temp: 30, chamber: 33 }]}
        setTemp={93}
        lanceReadyCutoff={92}
      />
    )

    expect(lines.map(l => l.dataKey).sort()).toEqual(['chamber', 'temp'])
    expect(refLines.map(r => r.y).sort((a, b) => (a as number) - (b as number))).toEqual([92, 93])
  })
})
