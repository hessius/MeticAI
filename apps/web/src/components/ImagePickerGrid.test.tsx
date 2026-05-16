import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagePickerGrid, type BatchImage } from './ImagePickerGrid'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'imageGeneration.selectImage': 'Select an image',
        'imageGeneration.generating': 'Generating...',
        'imageGeneration.regenerateSlot': 'Regenerate',
      }
      return translations[key] || key
    },
  }),
}))

vi.mock('@phosphor-icons/react', () => ({
  CheckCircle: ({ 'data-testid': testId, ...props }: Record<string, unknown>) => (
    <svg data-testid={testId || 'check-circle'} {...props} />
  ),
  SpinnerGap: ({ 'data-testid': testId, ...props }: Record<string, unknown>) => (
    <svg data-testid={testId || 'spinner'} {...props} />
  ),
  WarningCircle: (props: Record<string, unknown>) => (
    <svg data-testid="warning-circle" {...props} />
  ),
}))

function makeImages(count: number): BatchImage[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    image: `data:image/png;base64,fake${i}`,
  }))
}

describe('ImagePickerGrid', () => {
  it('renders correct number of image slots', () => {
    const images = makeImages(4)
    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={vi.fn()}
        loading={[false, false, false, false]}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
  })

  it('renders 2 slots when given 2 images', () => {
    const images = makeImages(2)
    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={vi.fn()}
        loading={[false, false]}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
  })

  it('calls onSelect when image clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const images = makeImages(4)

    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={onSelect}
        loading={[false, false, false, false]}
      />,
    )

    const buttons = screen.getAllByRole('button')
    await user.click(buttons[2])
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('shows loading spinner for loading slots', () => {
    const images: BatchImage[] = [
      { index: 0, image: null },
      { index: 1, image: 'data:image/png;base64,ok' },
    ]

    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={vi.fn()}
        loading={[true, false]}
      />,
    )

    expect(screen.getByTestId('spinner-0')).toBeInTheDocument()
    expect(screen.getByText('Generating...')).toBeInTheDocument()
  })

  it('shows checkmark on selected image', () => {
    const images = makeImages(4)

    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={1}
        onSelect={vi.fn()}
        loading={[false, false, false, false]}
      />,
    )

    expect(screen.getByTestId('checkmark')).toBeInTheDocument()
    const selectedButton = screen.getAllByRole('button')[1]
    expect(selectedButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows error state for failed images', () => {
    const images: BatchImage[] = [
      { index: 0, image: null, error: 'Generation failed' },
      { index: 1, image: 'data:image/png;base64,ok' },
    ]

    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={vi.fn()}
        loading={[false, false]}
        onRegenerate={vi.fn()}
      />,
    )

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('Regenerate')).toBeInTheDocument()
  })

  it('disables buttons for loading or errored slots', () => {
    const images: BatchImage[] = [
      { index: 0, image: null },
      { index: 1, image: null, error: 'fail' },
    ]

    render(
      <ImagePickerGrid
        images={images}
        selectedIndex={null}
        onSelect={vi.fn()}
        loading={[true, false]}
      />,
    )

    const buttons = screen.getAllByRole('button')
    // Loading slot should be disabled
    expect(buttons[0]).toBeDisabled()
    // Error slot (no image, has error) — the outer button is disabled
    expect(buttons[1]).toBeDisabled()
  })
})
