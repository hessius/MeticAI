import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  TasteCompassInput,
  DEFAULT_TASTE_DATA,
  POSITIVE_DESCRIPTOR_KEYS,
  NEGATIVE_DESCRIPTOR_KEYS,
} from './TasteCompassInput'
import type { TasteData } from './TasteCompassInput'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'taste.compass.title': 'Espresso Compass',
        'taste.compass.sour': 'Sour',
        'taste.compass.bitter': 'Bitter',
        'taste.compass.strong': 'Strong',
        'taste.compass.weak': 'Weak',
        'taste.compass.balanced': 'Balanced',
        'taste.compass.descriptors': 'Taste Descriptors',
        'taste.compass.positive': 'Positive',
        'taste.compass.negative': 'Negative',
        'taste.compass.reset': 'Reset',
        'taste.section.title': 'Taste-Based Recommendations',
        'taste.section.description': 'Recommendations based on your taste feedback',
      }
      return translations[key] || key
    },
  }),
}))

describe('TasteCompassInput', () => {
  let onChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onChange = vi.fn()
  })

  it('renders the compass title', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    expect(screen.getByText('Espresso Compass')).toBeInTheDocument()
  })

  it('renders axis labels', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    expect(screen.getByText('Sour')).toBeInTheDocument()
    expect(screen.getByText('Bitter')).toBeInTheDocument()
    expect(screen.getByText('Strong')).toBeInTheDocument()
    expect(screen.getByText('Weak')).toBeInTheDocument()
  })

  it('renders descriptor section title', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    expect(screen.getByText('Taste Descriptors')).toBeInTheDocument()
  })

  it('renders positive and negative descriptor labels', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    expect(screen.getByText('Positive')).toBeInTheDocument()
    expect(screen.getByText('Negative')).toBeInTheDocument()
  })

  it('renders all positive descriptor badges', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    for (const desc of POSITIVE_DESCRIPTOR_KEYS) {
      expect(screen.getByText(`taste.positiveDescriptors.${desc}`)).toBeInTheDocument()
    }
  })

  it('renders all negative descriptor badges', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    for (const desc of NEGATIVE_DESCRIPTOR_KEYS) {
      expect(screen.getByText(`taste.negativeDescriptors.${desc}`)).toBeInTheDocument()
    }
  })

  it('renders reset button when hasInput is true', () => {
    const activeData: TasteData = { x: 0.2, y: 0.1, descriptors: [], hasInput: true }
    render(<TasteCompassInput value={activeData} onChange={onChange} />)
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })

  it('hides reset button when hasInput is false', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    expect(screen.queryByText('Reset')).not.toBeInTheDocument()
  })

  it('calls onChange when a descriptor is clicked', async () => {
    const user = userEvent.setup()
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)

    await user.click(screen.getByText('taste.positiveDescriptors.sweet'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const call = onChange.mock.calls[0][0] as TasteData
    expect(call.descriptors).toContain('sweet')
    expect(call.hasInput).toBe(true)
  })

  it('removes descriptor when clicking an already selected one', async () => {
    const user = userEvent.setup()
    const dataWithDescriptor: TasteData = {
      x: 0,
      y: 0,
      descriptors: ['sweet'],
      hasInput: true,
    }
    render(<TasteCompassInput value={dataWithDescriptor} onChange={onChange} />)

    await user.click(screen.getByText('taste.positiveDescriptors.sweet'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const call = onChange.mock.calls[0][0] as TasteData
    expect(call.descriptors).not.toContain('sweet')
  })

  it('calls onChange with reset data when reset button is clicked', async () => {
    const user = userEvent.setup()
    const dataWithInput: TasteData = {
      x: 0.5,
      y: -0.3,
      descriptors: ['sweet', 'bitter'],
      hasInput: true,
    }
    render(<TasteCompassInput value={dataWithInput} onChange={onChange} />)

    await user.click(screen.getByText('Reset'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const call = onChange.mock.calls[0][0] as TasteData
    expect(call.x).toBe(0)
    expect(call.y).toBe(0)
    expect(call.descriptors).toEqual([])
    expect(call.hasInput).toBe(false)
  })

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup()
    render(
      <TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} disabled />
    )

    await user.click(screen.getByText('taste.positiveDescriptors.sweet'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders in compact mode without crashing', () => {
    render(
      <TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} compact />
    )
    expect(screen.getByText('Espresso Compass')).toBeInTheDocument()
  })

  it('renders the SVG compass element', () => {
    render(<TasteCompassInput value={DEFAULT_TASTE_DATA} onChange={onChange} />)
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('exports DEFAULT_TASTE_DATA with correct defaults', () => {
    expect(DEFAULT_TASTE_DATA).toEqual({
      x: 0,
      y: 0,
      descriptors: [],
      hasInput: false,
    })
  })

  it('exports expected descriptor arrays', () => {
    expect(POSITIVE_DESCRIPTOR_KEYS).toHaveLength(8)
    expect(NEGATIVE_DESCRIPTOR_KEYS).toHaveLength(8)
    expect(POSITIVE_DESCRIPTOR_KEYS).toContain('sweet')
    expect(NEGATIVE_DESCRIPTOR_KEYS).toContain('harsh')
  })

  it('reflects the current value coordinates visually', () => {
    const movedData: TasteData = {
      x: 0.5,
      y: -0.5,
      descriptors: [],
      hasInput: true,
    }
    render(<TasteCompassInput value={movedData} onChange={onChange} />)
    // The compass circle (pointer) should be rendered somewhere in the SVG
    const circles = document.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThan(0)
  })
})
