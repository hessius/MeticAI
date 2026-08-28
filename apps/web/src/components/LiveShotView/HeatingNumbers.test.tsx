import type { HTMLAttributes, ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingNumbers } from './HeatingNumbers'
import { progressPercent } from './heatingProgress'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

describe('HeatingNumbers', () => {
  it('shows chamber and head temperatures', () => {
    render(<HeatingNumbers chamberTemp={91.2} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />)

    expect(screen.getByText('controlCenter.heating.brewChamber')).toBeInTheDocument()
    expect(screen.getByText('91.2°C')).toBeInTheDocument()
    expect(screen.getByText('controlCenter.heating.brewHead')).toBeInTheDocument()
    expect(screen.getByText('88.4°C')).toBeInTheDocument()
  })

  it('renders no target marker (plain progress bars)', () => {
    render(<HeatingNumbers chamberTemp={91.2} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />)

    expect(screen.queryAllByTestId('target-marker')).toHaveLength(0)
  })

  it('renders a per-sensor "to target" readout without inline 6-digit hex colors', () => {
    const { container } = render(
      <HeatingNumbers chamberTemp={92.5} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />
    )

    // Head is 4.6°C from the 93°C target; chamber is 0.5°C away.
    expect(screen.getByText(/4\.6°C/)).toBeInTheDocument()
    expect(screen.getByText(/0\.5°C/)).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]{6}/)
  })
})

describe('progressPercent', () => {
  it('maps the ambient baseline to 0% and the set temp to 100%', () => {
    expect(progressPercent(20, 93)).toBe(0)
    expect(progressPercent(93, 93)).toBe(100)
  })

  it('clamps sub-ambient and over-target readings to [0, 100]', () => {
    expect(progressPercent(10, 93)).toBe(0)
    expect(progressPercent(120, 93)).toBe(100)
  })

  it('returns 100 for a non-positive span instead of dividing by zero', () => {
    expect(progressPercent(20, 20)).toBe(100)
    expect(progressPercent(50, 10)).toBe(100)
  })
})
