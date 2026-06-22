import type { HTMLAttributes, ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingNumbers } from './HeatingNumbers'

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

  it('renders a ready marker', () => {
    render(<HeatingNumbers chamberTemp={91.2} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />)

    expect(screen.getAllByTestId('ready-marker')).toHaveLength(2)
  })

  it('renders head-based delta readout without inline 6-digit hex colors', () => {
    const { container } = render(
      <HeatingNumbers chamberTemp={92.5} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />
    )

    expect(screen.getByTestId('delta-readout')).toHaveTextContent('4.6°C')
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]{6}/)
  })
})
