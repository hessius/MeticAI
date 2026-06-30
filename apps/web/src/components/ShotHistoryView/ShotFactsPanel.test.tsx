import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShotFactsPanel } from './ShotFactsPanel'
import type { ShotFacts } from '../../lib/shotFacts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const facts: ShotFacts = {
  stages: [
    { stage_name: 'Infusion', reached: true, control_mode: 'pressure', trigger_type: 'weight',
      trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
      stall: { stalled: false, weight_gain: 30 },
      channeling: { channeling: false, pressure_drop: 0.1, flow_rise: 0.1 },
      curve_adherence: { target: 9, measured: 8.5, delta: -0.5 } },
    { stage_name: 'Decline', reached: true, control_mode: 'pressure', trigger_type: 'time',
      trigger_class: { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: '' },
      stall: { stalled: true, weight_gain: 0.2 },
      channeling: { channeling: true, pressure_drop: 3, flow_rise: 2 },
      curve_adherence: null },
  ],
  phases: [],
  weight: { actual: 36, target: 36, deviation_pct: 0 },
  total_time_s: 30,
}

describe('ShotFactsPanel', () => {
  it('renders a row per stage with its trigger label', () => {
    render(<ShotFactsPanel facts={facts} />)
    expect(screen.getByText('Infusion')).toBeInTheDocument()
    expect(screen.getByText('Decline')).toBeInTheDocument()
    expect(screen.getByText('Targeted (yield reached)')).toBeInTheDocument()
    expect(screen.getByText('Failsafe (timeout limit)')).toBeInTheDocument()
  })
  it('shows stall and channeling flags when present', () => {
    render(<ShotFactsPanel facts={facts} />)
    expect(screen.getByText('analysis.facts.stalled')).toBeInTheDocument()
    expect(screen.getByText('analysis.facts.channeling')).toBeInTheDocument()
  })
  it('renders nothing when facts has no reached stages', () => {
    const { container } = render(<ShotFactsPanel facts={{ ...facts, stages: [] }} />)
    expect(container.firstChild).toBeNull()
  })
  it('renders compass adjustments when taste is provided', () => {
    render(<ShotFactsPanel facts={facts} taste={{ x: -0.8, y: -0.6, descriptors: [] }} />)
    expect(screen.getByText('analysis.facts.adjustmentsTitle')).toBeInTheDocument()
    expect(screen.getByText(/grind_finer/i)).toBeInTheDocument()
  })
})
