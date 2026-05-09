import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

type ServiceWorkerListener = (event: { waitUntil: (promise: Promise<unknown>) => void }) => void

async function runActivate(cacheKeys: string[]) {
  const listeners = new Map<string, ServiceWorkerListener>()
  const deletedKeys: string[] = []
  let activation: Promise<unknown> | undefined

  const selfStub = {
    registration: { scope: 'https://machine.local/meticai/' },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(() => undefined),
    addEventListener: vi.fn((eventName: string, listener: ServiceWorkerListener) => {
      listeners.set(eventName, listener)
    }),
  }

  const cachesStub = {
    keys: vi.fn(async () => cacheKeys),
    delete: vi.fn(async (key: string) => {
      deletedKeys.push(key)
      return true
    }),
    open: vi.fn(async () => ({
      addAll: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      match: vi.fn(async () => undefined),
    })),
  }

  const source = await readFile(resolve(process.cwd(), 'public/sw.js'), 'utf8')
  const evaluateServiceWorker = new Function('self', 'caches', 'console', 'URL', source)
  evaluateServiceWorker(selfStub, cachesStub, console, URL)

  listeners.get('activate')?.({
    waitUntil: (promise) => {
      activation = promise
    },
  })

  await activation
  return { deletedKeys }
}

describe('direct PWA service worker', () => {
  it('only deletes old MeticAI direct caches on activation', async () => {
    const { deletedKeys } = await runActivate([
      'meticai-direct-v0',
      'meticai-direct-v1',
      'meticai-proxy-v1',
      'unrelated-machine-ui-cache',
    ])

    expect(deletedKeys).toEqual(['meticai-direct-v0'])
  })
})
