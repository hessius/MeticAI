export type MeticDeepLink =
  | { action: 'start'; profileId: string }
  | { action: 'open' }

/**
 * Parse a `metic://` deep link. Returns null for anything that is not a
 * recognised, well-formed Metic link.
 *
 * Supported:
 *   metic://start?profileId=<id>
 *   metic://open
 */
export function parseMeticDeepLink(url: string): MeticDeepLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'metic:') return null

  // For custom schemes, the "host" is the first path segment (e.g. metic://start).
  const host = parsed.host || parsed.pathname.replace(/^\/+/, '').split('/')[0]

  switch (host) {
    case 'start': {
      const profileId = parsed.searchParams.get('profileId')
      return profileId ? { action: 'start', profileId } : null
    }
    case 'open':
      return { action: 'open' }
    default:
      return null
  }
}
