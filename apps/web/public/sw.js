const CACHE_PREFIX = 'meticai-direct-'
const CACHE_NAME = `${CACHE_PREFIX}v1`

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString()
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([scopedUrl('./'), scopedUrl('./manifest.json')]))
      .catch((err) => {
        console.warn('[PWA] Initial cache failed:', err)
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const scope = new URL(self.registration.scope)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  if (url.pathname.includes('/api/') || url.pathname.includes('/socket.io/')) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      const response = await fetch(request)
      if (response.ok) {
        await cache.put(request, response.clone())
      }
      return response
    } catch (err) {
      const cached = await cache.match(request)
      if (cached) return cached
      if (request.mode === 'navigate') {
        const appShell = await cache.match(scopedUrl('./'))
        if (appShell) return appShell
      }
      throw err
    }
  })())
})
