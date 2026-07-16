import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileImportDialog } from './ProfileImportDialog'

const translate = (key: string) => key

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: translate }),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

function lastImportBody(): Record<string, unknown> | null {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
  const call = calls.find(([url]) => String(url).endsWith('/api/import-from-url'))
  if (!call) return null
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe('ProfileImportDialog: link or JSON import', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'success', profile_name: 'Slay-ish' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function openLinkStep() {
    render(
      <ProfileImportDialog
        isOpen
        onClose={() => {}}
        onImported={() => {}}
        onGenerateNew={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('profileImport.fromLink'))
  }

  it('posts a metprofiles link to the import endpoint', async () => {
    openLinkStep()
    const box = screen.getByPlaceholderText('profileImport.sourcePlaceholder')
    fireEvent.change(box, {
      target: {
        value: 'https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd',
      },
    })
    fireEvent.click(screen.getByText('profileImport.importButton'))
    await waitFor(() => {
      expect(lastImportBody()).toMatchObject({
        url: 'https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd',
      })
    })
  })

  it('accepts pasted raw JSON as a source', async () => {
    openLinkStep()
    const box = screen.getByPlaceholderText('profileImport.sourcePlaceholder')
    fireEvent.change(box, { target: { value: '{"name":"Pasted","stages":[]}' } })
    fireEvent.click(screen.getByText('profileImport.importButton'))
    await waitFor(() => {
      expect(lastImportBody()).toMatchObject({ url: '{"name":"Pasted","stages":[]}' })
    })
  })

  it('rejects non-link, non-JSON text without calling the endpoint', async () => {
    openLinkStep()
    const box = screen.getByPlaceholderText('profileImport.sourcePlaceholder')
    fireEvent.change(box, { target: { value: 'just some words' } })
    await act(async () => {
      fireEvent.click(screen.getByText('profileImport.importButton'))
    })
    expect(screen.getByText('profileImport.invalidSource')).toBeTruthy()
    expect(lastImportBody()).toBeNull()
  })
})
