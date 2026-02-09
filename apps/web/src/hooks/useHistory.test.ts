import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useHistory, HistoryEntry } from './useHistory'

// Mock the config module
vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(() => Promise.resolve('http://localhost:8000'))
}))

// Sample history entries for testing
const mockHistoryEntry: HistoryEntry = {
  id: 'test-id-123',
  created_at: '2026-01-18T10:00:00Z',
  profile_name: 'Ethiopian Sunrise',
  coffee_analysis: 'Light roast with floral notes',
  user_preferences: 'Light Body with Florals',
  reply: 'Profile Created: Ethiopian Sunrise\n\nDescription: A bright and floral profile...',
  profile_json: {
    name: 'Ethiopian Sunrise',
    stages: []
  }
}

const mockHistoryEntry2: HistoryEntry = {
  id: 'test-id-456',
  created_at: '2026-01-17T10:00:00Z',
  profile_name: 'Colombian Classic',
  coffee_analysis: 'Medium roast with chocolate notes',
  user_preferences: 'Medium Body with Chocolate',
  reply: 'Profile Created: Colombian Classic\n\nDescription: A balanced profile...',
  profile_json: null
}

describe('useHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchHistory', () => {
    it('should fetch history successfully', async () => {
      const mockResponse = {
        entries: [mockHistoryEntry, mockHistoryEntry2],
        total: 2,
        limit: 50,
        offset: 0
      }

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse)
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.fetchHistory()
      })

      expect(result.current.entries).toHaveLength(2)
      expect(result.current.total).toBe(2)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('should handle fetch errors', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        try {
          await result.current.fetchHistory()
        } catch {
          // Expected error
        }
      })

      expect(result.current.error).toBe('Failed to fetch history: 500')
      expect(result.current.entries).toEqual([])
    })

    it('should pass limit and offset parameters', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries: [], total: 0, limit: 10, offset: 5 })
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.fetchHistory(10, 5)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10')
      )
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=5')
      )
    })

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void
      const promise = new Promise(resolve => {
        resolvePromise = resolve
      })

      global.fetch = vi.fn(() => promise as Promise<Response>)

      const { result } = renderHook(() => useHistory())

      act(() => {
        result.current.fetchHistory()
      })

      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ entries: [], total: 0, limit: 50, offset: 0 })
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('fetchEntry', () => {
    it('should fetch a single entry by ID', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHistoryEntry)
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      let entry: HistoryEntry | undefined
      await act(async () => {
        entry = await result.current.fetchEntry('test-id-123')
      })

      expect(entry).toEqual(mockHistoryEntry)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/history/test-id-123')
      )
    })

    it('should throw error for non-existent entry', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await expect(
        act(async () => {
          await result.current.fetchEntry('non-existent')
        })
      ).rejects.toThrow('Failed to fetch entry: 404')
    })
  })

  describe('deleteEntry', () => {
    it('should delete an entry and update local state', async () => {
      // First, set up initial state with entries
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            entries: [mockHistoryEntry, mockHistoryEntry2],
            total: 2,
            limit: 50,
            offset: 0
          })
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'success' })
        } as unknown as Response)

      const { result } = renderHook(() => useHistory())

      // Fetch initial entries
      await act(async () => {
        await result.current.fetchHistory()
      })

      expect(result.current.entries).toHaveLength(2)

      // Delete one entry
      await act(async () => {
        await result.current.deleteEntry('test-id-123')
      })

      expect(result.current.entries).toHaveLength(1)
      expect(result.current.entries[0].id).toBe('test-id-456')
      expect(result.current.total).toBe(1)
    })

    it('should call DELETE endpoint with correct ID', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'success' })
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.deleteEntry('test-id-123')
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/history/test-id-123'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should throw error on delete failure', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await expect(
        act(async () => {
          await result.current.deleteEntry('non-existent')
        })
      ).rejects.toThrow('Failed to delete entry: 404')
    })
  })

  describe('clearHistory', () => {
    it('should clear all history and update local state', async () => {
      // First, set up initial state with entries
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            entries: [mockHistoryEntry, mockHistoryEntry2],
            total: 2,
            limit: 50,
            offset: 0
          })
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'success' })
        } as unknown as Response)

      const { result } = renderHook(() => useHistory())

      // Fetch initial entries
      await act(async () => {
        await result.current.fetchHistory()
      })

      expect(result.current.entries).toHaveLength(2)

      // Clear all history
      await act(async () => {
        await result.current.clearHistory()
      })

      expect(result.current.entries).toEqual([])
      expect(result.current.total).toBe(0)
    })

    it('should call DELETE on history endpoint', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'success' })
        } as Response)
      )

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.clearHistory()
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/history'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('downloadJson', () => {
    it('should throw error when profile_json is null', async () => {
      const { result } = renderHook(() => useHistory())

      await expect(
        act(async () => {
          await result.current.downloadJson(mockHistoryEntry2)
        })
      ).rejects.toThrow('No profile JSON available for this entry')
    })

    it('should create blob with correct JSON content', async () => {
      // Store original values
      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      const originalCreateElement = document.createElement.bind(document)
      
      // Mock URL APIs
      const mockCreateObjectURL = vi.fn(() => 'blob:test-url')
      const mockRevokeObjectURL = vi.fn()
      URL.createObjectURL = mockCreateObjectURL
      URL.revokeObjectURL = mockRevokeObjectURL
      
      // Track the link properties
      let capturedDownload = ''
      let clickCalled = false
      
      // Create a real element but intercept the click
      const mockCreateElement = vi.fn((tagName: string) => {
        const el = originalCreateElement(tagName)
        if (tagName === 'a') {
          Object.defineProperty(el, 'click', {
            value: vi.fn(() => {
              capturedDownload = el.download
              clickCalled = true
            })
          })
        }
        return el
      })
      document.createElement = mockCreateElement as typeof document.createElement

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.downloadJson(mockHistoryEntry)
      })

      // Verify blob was created
      expect(mockCreateObjectURL).toHaveBeenCalled()
      
      // Verify click was called
      expect(clickCalled).toBe(true)
      
      // Verify the filename format
      expect(capturedDownload).toBe('ethiopian-sunrise.json')
      
      // Cleanup
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      document.createElement = originalCreateElement
    })

    it('should handle profile names with special characters', async () => {
      const entryWithSpecialName: HistoryEntry = {
        ...mockHistoryEntry,
        profile_name: 'Test Profile!!! @#$ 123'
      }

      // Store original values
      const originalCreateObjectURL = URL.createObjectURL
      const originalRevokeObjectURL = URL.revokeObjectURL
      const originalCreateElement = document.createElement.bind(document)
      
      URL.createObjectURL = vi.fn(() => 'blob:test-url')
      URL.revokeObjectURL = vi.fn()
      
      let capturedDownload = ''
      
      const mockCreateElement = vi.fn((tagName: string) => {
        const el = originalCreateElement(tagName)
        if (tagName === 'a') {
          Object.defineProperty(el, 'click', {
            value: vi.fn(() => {
              capturedDownload = el.download
            })
          })
        }
        return el
      })
      document.createElement = mockCreateElement as typeof document.createElement

      const { result } = renderHook(() => useHistory())

      await act(async () => {
        await result.current.downloadJson(entryWithSpecialName)
      })

      // Should be sanitized: lowercase, special chars replaced with dashes
      expect(capturedDownload).toBe('test-profile-123.json')
      
      // Cleanup
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      document.createElement = originalCreateElement
    })
  })
})
