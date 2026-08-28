import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShareImportResultDialog } from './ShareImportResultDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ShareImportResultDialog', () => {
  it('renders nothing when there is no state', () => {
    const { container } = render(<ShareImportResultDialog state={null} onClose={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('shows the importing state without a dismiss button', () => {
    render(<ShareImportResultDialog state={{ status: 'importing' }} onClose={() => {}} />)
    expect(screen.getByText('profileImport.shareResult.importingTitle')).toBeTruthy()
    expect(screen.queryByText('common.done')).toBeNull()
  })

  it('shows a success message with a dismiss button', () => {
    render(
      <ShareImportResultDialog
        state={{ status: 'success', profileName: 'Slay-ish' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('profileImport.shareResult.successTitle')).toBeTruthy()
    expect(screen.getByText('profileImport.shareResult.successBody')).toBeTruthy()
    expect(screen.getByText('common.done')).toBeTruthy()
  })

  it('treats an already-imported profile as a distinct outcome', () => {
    render(
      <ShareImportResultDialog
        state={{ status: 'exists', profileName: 'Slay-ish' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('profileImport.shareResult.existsBody')).toBeTruthy()
  })

  it('shows the reason variant when the error carries a message', () => {
    render(
      <ShareImportResultDialog
        state={{ status: 'error', message: 'Not a valid profile' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('profileImport.shareResult.errorBodyWithReason')).toBeTruthy()
  })

  it('falls back to a generic error body when there is no reason', () => {
    render(<ShareImportResultDialog state={{ status: 'error', message: null }} onClose={() => {}} />)
    expect(screen.getByText('profileImport.shareResult.errorBody')).toBeTruthy()
    expect(screen.queryByText('profileImport.shareResult.errorBodyWithReason')).toBeNull()
  })

  it('calls onClose when the dismiss button is pressed', () => {
    const onClose = vi.fn()
    render(
      <ShareImportResultDialog
        state={{ status: 'success', profileName: 'X' }}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('common.done'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
