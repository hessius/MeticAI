export interface DirectRequestContext {
  url: string
  method: string
  pathname: string
}

function currentOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function getDirectRequestContext(input: RequestInfo | URL, init?: RequestInit): DirectRequestContext {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input instanceof Request ? input.url : ''

  const method = init?.method?.toUpperCase() || (input instanceof Request ? input.method.toUpperCase() : 'GET')
  const pathname = new URL(url || '/', currentOrigin()).pathname
  return { url, method, pathname }
}

export function isMeticAIProxyApiPath(url: string): boolean {
  const parsed = new URL(url || '/', currentOrigin())
  if (parsed.pathname === '/api/getLastShotProfileJSON') return false
  return /^\/api\/(?!v\d+(?:\/|$))/.test(parsed.pathname)
}
