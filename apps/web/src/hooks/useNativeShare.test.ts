import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock Capacitor modules
const mockShare = vi.fn()
vi.mock('@capacitor/share', () => ({
  Share: { share: (...args: unknown[]) => mockShare(...args) },
}))

let mockIsNative = false
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNative },
}))

import { useNativeShare, shareImageDataUri } from './useNativeShare'

describe('useNativeShare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('canShare', () => {
    it('returns true when native', () => {
      mockIsNative = true
      const { result } = renderHook(() => useNativeShare())
      expect(result.current.canShare).toBe(true)
    })

    it('returns true when navigator.share exists', () => {
      mockIsNative = false
      Object.defineProperty(navigator, 'share', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useNativeShare())
      expect(result.current.canShare).toBe(true)
    })

    it('returns false when no native and no navigator.share', () => {
      mockIsNative = false
      // Remove navigator.share if present
      const descriptor = Object.getOwnPropertyDescriptor(navigator, 'share')
      if (descriptor) {
        Object.defineProperty(navigator, 'share', {
          value: undefined,
          writable: true,
          configurable: true,
        })
      }
      // 'share' still exists as own property set to undefined — delete it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).share

      const { result } = renderHook(() => useNativeShare())
      expect(result.current.canShare).toBe(false)
    })
  })

  describe('share()', () => {
    const options = { title: 'Test', text: 'Hello', url: 'https://example.com' }

    it('calls Share.share() on native', async () => {
      mockIsNative = true
      mockShare.mockResolvedValue(undefined)

      const { result } = renderHook(() => useNativeShare())
      await act(() => result.current.share(options))

      expect(mockShare).toHaveBeenCalledWith(options)
    })

    it('calls navigator.share() on web', async () => {
      mockIsNative = false
      const navShare = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', {
        value: navShare,
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useNativeShare())
      await act(() => result.current.share(options))

      expect(navShare).toHaveBeenCalledWith(options)
      expect(mockShare).not.toHaveBeenCalled()
    })

    it('falls back to clipboard.writeText when no share API', async () => {
      mockIsNative = false
      // Remove navigator.share
      Object.defineProperty(navigator, 'share', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useNativeShare())
      await act(() => result.current.share(options))

      expect(writeText).toHaveBeenCalledWith('Test — Hello — https://example.com')
    })

    it('ignores AbortError (user cancelled)', async () => {
      mockIsNative = false
      const abortError = new DOMException('User cancelled', 'AbortError')
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockRejectedValue(abortError),
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useNativeShare())
      // Should not throw
      await act(() => result.current.share(options))
    })

    it('rethrows non-AbortError errors', async () => {
      mockIsNative = false
      const error = new Error('Network failure')
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockRejectedValue(error),
        writable: true,
        configurable: true,
      })

      const { result } = renderHook(() => useNativeShare())
      await expect(act(() => result.current.share(options))).rejects.toThrow('Network failure')
    })
  })
})

describe('shareImageDataUri', () => {
  const dataUri = 'data:image/png;base64,abc123'
  const filename = 'shot.png'
  const opts = { title: 'My Shot', text: 'Check this out' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls Share.share({ url: dataUri }) on native', async () => {
    mockIsNative = true
    mockShare.mockResolvedValue(undefined)

    await shareImageDataUri(dataUri, filename, opts)

    expect(mockShare).toHaveBeenCalledWith({
      title: opts.title,
      text: opts.text,
      url: dataUri,
    })
  })

  it('converts data URI to File and calls navigator.share({ files }) on web', async () => {
    mockIsNative = false
    const mockBlob = new Blob(['pixels'], { type: 'image/png' })
    global.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(mockBlob),
    })

    const navShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      value: navShare,
      writable: true,
      configurable: true,
    })

    await shareImageDataUri(dataUri, filename, opts)

    expect(global.fetch).toHaveBeenCalledWith(dataUri)
    expect(navShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: opts.title,
        text: opts.text,
        files: [expect.any(File)],
      }),
    )

    const file = navShare.mock.calls[0][0].files[0] as File
    expect(file.name).toBe(filename)
    expect(file.type).toBe('image/png')
  })

  it('falls back to download link when navigator.share throws', async () => {
    mockIsNative = false
    const mockBlob = new Blob(['pixels'], { type: 'image/png' })
    global.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(mockBlob),
    })

    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(new Error('Not supported')),
      writable: true,
      configurable: true,
    })

    const mockObjectUrl = 'blob:http://localhost/mock-id'
    global.URL.createObjectURL = vi.fn().mockReturnValue(mockObjectUrl)
    global.URL.revokeObjectURL = vi.fn()

    const mockLink = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement)

    await shareImageDataUri(dataUri, filename, opts)

    expect(mockLink.href).toBe(mockObjectUrl)
    expect(mockLink.download).toBe(filename)
    expect(mockLink.click).toHaveBeenCalled()
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectUrl)
  })

  it('handles AbortError silently without falling back to download', async () => {
    mockIsNative = false
    const mockBlob = new Blob(['pixels'], { type: 'image/png' })
    global.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(mockBlob),
    })

    const abortError = new DOMException('User cancelled', 'AbortError')
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(abortError),
      writable: true,
      configurable: true,
    })

    global.URL.createObjectURL = vi.fn()
    const clickSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValue({ click: clickSpy } as unknown as HTMLElement)

    await shareImageDataUri(dataUri, filename, opts)

    // Should return early — no download fallback triggered
    expect(global.URL.createObjectURL).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
