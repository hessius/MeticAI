import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReplayChart, CompareChart } from './ShotCharts'
import type { ChartDataPoint, StageRange } from '@/components/charts/chartConstants'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

let tooltipRenders = 0

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => { tooltipRenders += 1; return null },
  Legend: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
  useXAxisScale: () => null,
  useYAxisScale: () => null,
}))

const displayData: ChartDataPoint[] = [
  { time: 0, pressure: 0, flow: 0, weight: 0, stage: 'Pre-infusion' },
  { time: 5, pressure: 6, flow: 2.5, weight: 18, stage: 'Extraction' },
]
const stageRanges: StageRange[] = []

const baseProps = {
  displayData,
  displayStageRanges: stageRanges,
  stageRanges,
  dataMaxTime: 30,
  maxLeftAxis: 12,
  maxRightAxis: 50,
  hasGravFlow: false,
  isPlaying: false,
  playbackSpeed: 1,
  isDark: false,
  variant: 'mobile' as const,
}

describe('ReplayChart values readout', () => {
  beforeEach(() => { tooltipRenders = 0 })

  it('shows a current-values readout outside the plot during replay', () => {
    render(<ReplayChart {...baseProps} isShowingReplay currentTime={5} />)
    const readout = screen.getByRole('status')
    expect(readout).toHaveAttribute('aria-label', 'shotCharts.currentValues')
    expect(readout).toHaveTextContent('shotCharts.pressure: 6.0')
    expect(readout).toHaveTextContent('shotCharts.flow: 2.5')
    expect(readout).toHaveTextContent('shotCharts.weight: 18.0')
    expect(readout).toHaveTextContent('Extraction')
  })

  it('suppresses the floating tooltip during replay so it cannot cover the curves', () => {
    render(<ReplayChart {...baseProps} isShowingReplay currentTime={5} />)
    expect(tooltipRenders).toBe(0)
    expect(screen.queryByRole('status')).toBeInTheDocument()
  })

  it('renders the tooltip and hides the readout when not replaying', () => {
    render(<ReplayChart {...baseProps} isShowingReplay={false} currentTime={0} />)
    expect(tooltipRenders).toBe(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

const compareData = [
  { time: 0, pressureA: 0, flowA: 0, weightA: 0, pressureB: 0, flowB: 0, weightB: 0 },
  { time: 5, pressureA: 8, flowA: 2.1, weightA: 20, pressureB: 6, flowB: 1.4, weightB: 15 },
]

const compareBaseProps = {
  combinedData: compareData,
  dataMaxTime: 30,
  leftDomain: 12,
  rightDomain: 50,
  comparisonIsPlaying: false,
  comparisonPlaybackSpeed: 1,
  isDark: false,
  variant: 'mobile' as const,
}

describe('CompareChart values readout', () => {
  beforeEach(() => { tooltipRenders = 0 })

  it('shows an A/B current-values readout outside the plot during replay', () => {
    render(<CompareChart {...compareBaseProps} isShowingReplay comparisonCurrentTime={5} />)
    const readout = screen.getByRole('status')
    expect(readout).toHaveAttribute('aria-label', 'shotCharts.currentValues')
    // Shot A values
    expect(readout).toHaveTextContent('shotCharts.shotASolid')
    expect(readout).toHaveTextContent('shotCharts.pressure: 8.0')
    expect(readout).toHaveTextContent('shotCharts.weight: 20.0')
    // Shot B values
    expect(readout).toHaveTextContent('shotCharts.shotBDashed')
    expect(readout).toHaveTextContent('shotCharts.pressure: 6.0')
    expect(readout).toHaveTextContent('shotCharts.weight: 15.0')
  })

  it('suppresses the floating tooltip during replay and shows it otherwise', () => {
    render(<CompareChart {...compareBaseProps} isShowingReplay comparisonCurrentTime={5} />)
    expect(tooltipRenders).toBe(0)
    expect(screen.queryByRole('status')).toBeInTheDocument()

    tooltipRenders = 0
    render(<CompareChart {...compareBaseProps} isShowingReplay={false} comparisonCurrentTime={0} />)
    expect(tooltipRenders).toBe(1)
  })
})
