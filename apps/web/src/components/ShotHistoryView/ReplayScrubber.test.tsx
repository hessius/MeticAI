import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReplayScrubber } from './ReplayScrubber'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ReplayScrubber', () => {
  it('renders an ARIA slider reflecting value and max', () => {
    render(<ReplayScrubber value={5} max={20} onChange={() => {}} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '5')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '20')
  })

  it('gives the slider an accessible name', () => {
    render(<ReplayScrubber value={5} max={20} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'shotHistory.scrubber' })).toBeInTheDocument()
  })

  it('shows the elapsed / total time readout', () => {
    render(<ReplayScrubber value={3.2} max={12.5} onChange={() => {}} />)
    expect(screen.getByText('3.2s')).toBeInTheDocument()
    expect(screen.getByText('12.5s')).toBeInTheDocument()
  })

  it('calls onChange with a clamped value when seeking via keyboard', () => {
    const onChange = vi.fn()
    render(<ReplayScrubber value={0} max={10} onChange={onChange} />)
    const slider = screen.getByRole('slider')
    slider.focus()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalled()
    const v = onChange.mock.calls[0][0]
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(10)
  })

  it('fires onScrubStart on pointer down and onScrubEnd on commit', () => {
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <ReplayScrubber
        value={2}
        max={10}
        onChange={() => {}}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    )
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onScrubEnd).toHaveBeenCalled()
  })

  it('does not start a scrub (pause playback) on non-scrubbing keys like Tab', () => {
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <ReplayScrubber
        value={2}
        max={10}
        onChange={() => {}}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    )
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'Tab' })
    fireEvent.keyDown(slider, { key: 'Shift' })
    expect(onScrubStart).not.toHaveBeenCalled()
    expect(onScrubEnd).not.toHaveBeenCalled()
  })

  it('fires onScrubStart once across a single pointer interaction', () => {
    const onScrubStart = vi.fn()
    const onChange = vi.fn()
    render(
      <ReplayScrubber value={2} max={10} onChange={onChange} onScrubStart={onScrubStart} />
    )
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('fires onScrubEnd once across a full pointer gesture', () => {
    const onScrubEnd = vi.fn()
    render(
      <ReplayScrubber value={2} max={10} onChange={() => {}} onScrubEnd={onScrubEnd} />
    )
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.pointerUp(slider)
    expect(onScrubEnd).toHaveBeenCalledTimes(1)
  })

  it('respects explicit disabled state when max is positive', () => {
    const onScrubStart = vi.fn()
    render(
      <ReplayScrubber
        value={2}
        max={10}
        onChange={() => {}}
        onScrubStart={onScrubStart}
        disabled
      />
    )
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('data-disabled')

    fireEvent.pointerDown(slider)
    expect(onScrubStart).not.toHaveBeenCalled()
  })

  it('renders nothing meaningful (disabled) when max is 0', () => {
    const onScrubStart = vi.fn()
    render(
      <ReplayScrubber value={0} max={0} onChange={() => {}} onScrubStart={onScrubStart} />
    )
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('data-disabled')

    fireEvent.pointerDown(slider)
    expect(onScrubStart).not.toHaveBeenCalled()
  })
})
