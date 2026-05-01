import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFlags } from '@/lib/featureFlags'

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
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
  useTransform: () => 0,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn((feature: keyof FeatureFlags) => feature !== 'cloudSync'),
}))

vi.mock('@/hooks/useProfileImageCache', () => ({
  useProfileImageCache: () => ({
    getImageUrl: vi.fn(() => null),
    fetchImagesForProfiles: vi.fn(async () => ({})),
  }),
}))

vi.mock('@/components/DeleteProfileDialog', () => ({
  DeleteProfileDialog: () => null,
}))

vi.mock('@/components/BulkDeleteDialog', () => ({
  BulkDeleteDialog: () => null,
}))

vi.mock('@/components/OrphanResolutionDialog', () => ({
  OrphanResolutionDialog: () => null,
}))

vi.mock('@/components/ProfileImportDialog', () => ({
  ProfileImportDialog: () => null,
}))

vi.mock('@/components/SyncReport', () => ({
  SyncReport: () => null,
}))

vi.mock('@/components/MarkdownText', () => ({
  MarkdownText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  cleanProfileName: (value: string) => value,
}))

vi.mock('@/components/ShotHistoryView', () => ({
  ShotHistoryView: () => null,
}))

vi.mock('@/components/ImageCropDialog', () => ({
  ImageCropDialog: () => null,
}))

vi.mock('@/components/ProfileBreakdown', () => ({
  ProfileBreakdown: () => null,
}))

vi.mock('@/components/MarkdownEditor', () => ({
  MarkdownEditor: () => null,
}))

vi.mock('@/components/FindSimilarOverlay', () => ({
  FindSimilarOverlay: () => null,
}))

vi.mock('@/services/profileService', () => ({
  profileService: {},
}))

vi.mock('@/hooks/useHistory', () => ({
  useHistory: () => ({
    entries: [],
    total: 0,
    isLoading: false,
    error: null,
    fetchHistory: vi.fn(async () => ({ entries: [], total: 0, limit: 50, offset: 0 })),
    deleteEntry: vi.fn(),
    downloadJson: vi.fn(),
  }),
}))

import { ProfileCatalogueView } from './ProfileCatalogueView'
import { HistoryView } from './HistoryView'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function syncCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(args => String(args[0]))
    .filter(url => /\/api\/(?:settings|profiles\/sync|profiles\/auto-sync)/.test(url))
}

describe('profile sync guards when cloudSync is disabled', () => {
  beforeEach(() => {
    localStorage.setItem('meticai-auto-sync', 'true')
    localStorage.setItem('meticai-auto-sync-ai-description', 'true')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('hides catalogue sync controls and skips sync backend calls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/machine/profiles/orphaned')) return jsonResponse({ orphaned: [] })
      if (url.includes('/api/machine/profiles')) return jsonResponse({ profiles: [] })
      if (url.includes('/api/history')) return jsonResponse({ entries: [], total: 0, limit: 500, offset: 0 })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<ProfileCatalogueView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole('button', { name: 'profileCatalogue.sync.button' })).not.toBeInTheDocument()
    expect(screen.queryByText('profileCatalogue.sync.autoSync')).not.toBeInTheDocument()
    expect(screen.queryByText('profileCatalogue.sync.autoSyncAiDescription')).not.toBeInTheDocument()
    expect(syncCalls(fetchMock)).toEqual([])
  })

  it('skips history sync badge calls when manage-machine button is available', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(
        <HistoryView
          onBack={() => {}}
          onViewProfile={() => {}}
          onGenerateNew={() => {}}
          onManageMachine={() => {}}
        />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(syncCalls(fetchMock)).toEqual([])
  })
})
