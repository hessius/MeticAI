import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingDashboard } from './HeatingDashboard'
import type { ProfileData } from '@/components/ProfileBreakdown'
import type { TempSample } from './estimateTimeToReady'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: React.PropsWithChildren) => <div {...p}>{children}</div> }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@/components/ProfileBreakdown', () => ({
  ProfileBreakdown: () => <div data-testid="profile-breakdown" />,
}))

vi.mock('./HeatingTempChart', () => ({
  HeatingTempChart: () => <div data-testid="heating-temp-chart" />,
}))

vi.mock('./HeatingNumbers', () => ({
  HeatingNumbers: () => <div data-testid="heating-numbers" />,
}))

const baseProps = {
  isReady: false,
  isHeating: true,
  profileName: 'Slow-Mo Blossom',
  setTemp: 93,
  chamberTemp: 70,
  headTemp: 68,
  lanceReadyCutoff: 92,
  preheatCountdown: null as number | null,
  samples: [] as TempSample[],
  profile: { temperature: 93 } as ProfileData,
  description: 'A gentle blooming profile.',
  startDisabled: false,
  onStart: vi.fn(),
  onAbort: vi.fn(),
}

describe('HeatingDashboard', () => {
  it('renders the heating status header with the set temp', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByText('controlCenter.heating.statusHeating')).toBeInTheDocument()
    expect(screen.getByText(/93/)).toBeInTheDocument()
  })

  it('enables the Start button during heating', () => {
    render(<HeatingDashboard {...baseProps} />)
    const start = screen.getByText('controlCenter.actions.start').closest('button')
    expect(start).toBeEnabled()
  })

  it('always shows an Abort control', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByText('controlCenter.actions.abort').closest('button')).toBeInTheDocument()
  })

  it('renders the profile breakdown by default', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByTestId('profile-breakdown')).toBeInTheDocument()
  })

  it('shows "ready" status when isReady', () => {
    render(<HeatingDashboard {...baseProps} isReady isHeating={false} />)
    expect(screen.getByText('controlCenter.heating.statusReady')).toBeInTheDocument()
  })

  it('shows a 0:00 hero (not "estimating") when ready', () => {
    render(<HeatingDashboard {...baseProps} isReady isHeating={false} />)
    expect(screen.getByText(/0:00/)).toBeInTheDocument()
    expect(screen.queryByText('controlCenter.heating.estimating')).not.toBeInTheDocument()
  })

  it('shows an idle status and hides the time-to-ready hero when neither heating nor ready', () => {
    render(<HeatingDashboard {...baseProps} isHeating={false} />)
    expect(screen.getByText('controlCenter.states.idle')).toBeInTheDocument()
    expect(screen.queryByText('controlCenter.heating.timeToReady')).not.toBeInTheDocument()
  })

  it('offers the description disclosure when a description is provided', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByText('controlCenter.heating.showDescription')).toBeInTheDocument()
  })

  it('omits the description disclosure when no description is provided', () => {
    render(<HeatingDashboard {...baseProps} description={undefined} />)
    expect(screen.queryByText('controlCenter.heating.showDescription')).not.toBeInTheDocument()
  })
})
