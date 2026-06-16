/**
 * Dynamic Gemini model discovery & ranking for the native/browser runtime.
 * Mirrors the server-side heuristic in services/gemini_service.py (#485).
 */

export interface DiscoveredModel {
  name: string
  supportedActions?: string[]
  // Optional display metadata from the SDK, surfaced by listAvailableModels (Task 7B).
  displayName?: string
  description?: string
}

const NON_TEXT_FRAGMENTS = ['embedding', 'aqa', 'imagen', 'image', 'tts']
const UNSTABLE_RE = /(preview|experimental|-exp\b|exp$|-\d{2}-\d{2}|-\d{3,4}$)/

function shortName(name: string): string {
  return (name.split('/').pop() ?? '').trim().toLowerCase()
}

/**
 * Pick the best generateContent-capable model from a discovered list.
 * Returns the model id (without the 'models/' prefix) or null.
 */
export function rankModels(models: DiscoveredModel[]): string | null {
  const candidates = models
    .filter(m => (m.supportedActions ?? ['generateContent']).includes('generateContent'))
    .map(m => shortName(m.name))
    .filter(s => s && !NON_TEXT_FRAGMENTS.some(f => s.includes(f)))

  if (candidates.length === 0) return null

  const score = (s: string): [number, number, number, number, string] => {
    const unstable = UNSTABLE_RE.test(s) ? 1 : 0
    const cls = s.includes('flash-lite') ? 1 : s.includes('flash') ? 0 : s.includes('pro') ? 2 : 3
    const vm = s.match(/gemini-(\d+)\.(\d+)/)
    const major = vm ? parseInt(vm[1], 10) : 0
    const minor = vm ? parseInt(vm[2], 10) : 0
    return [unstable, cls, -major, -minor, s]
  }

  return candidates.slice().sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < 4; i++) {
      if ((sa[i] as number) !== (sb[i] as number)) return (sa[i] as number) - (sb[i] as number)
    }
    return (sa[4] as string).localeCompare(sb[4] as string)
  })[0]
}
