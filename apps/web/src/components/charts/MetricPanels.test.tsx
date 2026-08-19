import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MetricPanels, type MetricPanelDef } from './MetricPanels'
import type { ChartDataPoint } from './chartConstants'

const data: ChartDataPoint[] = [
  { time: 0, pressure: 1, flow: 0, weight: 0, temperature: 90 },
  { time: 1, pressure: 8, flow: 2, weight: 5, temperature: 93 },
]

const panels: MetricPanelDef[] = [
  { key: 'pressure', labelKey: 'charts.metric.pressure', color: '#4ade80' },
  { key: 'flow', labelKey: 'charts.metric.flow', color: '#67e8f9' },
  { key: 'weight', labelKey: 'charts.metric.weight', color: '#fbbf24' },
  { key: 'temperature', labelKey: 'charts.metric.temperature', color: '#34d399' },
]

describe('MetricPanels', () => {
  it('renders one panel per descriptor', () => {
    const { container } = render(
      <MetricPanels data={data} panels={panels} layout="stack" heightClass="h-96" />,
    )
    expect(container.querySelectorAll('[data-metric-panel]')).toHaveLength(4)
  })

  it('omits a panel whose series is entirely absent', () => {
    const noTemp = data.map(({ temperature: _t, ...rest }) => rest)
    const { container } = render(
      <MetricPanels data={noTemp} panels={panels} layout="stack" heightClass="h-96" />,
    )
    expect(container.querySelectorAll('[data-metric-panel]')).toHaveLength(3)
  })

  it('applies grid layout class when layout=grid', () => {
    const { container } = render(
      <MetricPanels data={data} panels={panels} layout="grid" heightClass="h-96" />,
    )
    expect(container.firstElementChild?.className).toContain('grid')
  })
})
