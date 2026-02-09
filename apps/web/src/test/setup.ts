import '@testing-library/jest-dom'
import { afterEach, vi, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'

// Setup before all tests
beforeAll(() => {
  // Mock import.meta.env.DEV to false for all tests
  Object.defineProperty(import.meta, 'env', {
    value: { DEV: false },
    writable: true,
    configurable: true
  })
})

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock FileReader
global.FileReader = class FileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  readyState: number = 0
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onprogress: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
  onloadstart: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null

  static readonly EMPTY = 0 as const
  static readonly LOADING = 1 as const
  static readonly DONE = 2 as const
  readonly EMPTY = 0 as const
  readonly LOADING = 1 as const
  readonly DONE = 2 as const

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readAsDataURL(_blob: Blob): void {
    this.readyState = 2
    setTimeout(() => {
      this.result = 'data:image/png;base64,mockBase64Data'
      if (this.onloadend) {
        this.onloadend({} as ProgressEvent<FileReader>)
      }
    }, 0)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readAsText(_blob: Blob): void {
    this.readyState = 2
    setTimeout(() => {
      this.result = 'mock text data'
      if (this.onloadend) {
        this.onloadend({} as ProgressEvent<FileReader>)
      }
    }, 0)
  }

  abort(): void {
    this.readyState = 2
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true }
} as unknown as typeof FileReader
