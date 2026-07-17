import { getServerUrl } from '@/lib/config'

/**
 * Outcome of importing a profile from a shared/linked source. `exists` is a
 * distinct, non-error outcome: the profile was already in the library.
 */
export type ImportProfileResult =
  | { status: 'success'; profileName: string }
  | { status: 'exists'; profileName: string }
  | { status: 'error'; message: string | null }

interface ImportOptions {
  generateDescription?: boolean
}

/** Pull the most specific human-readable message out of a FastAPI error body. */
function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const d = detail as { error?: unknown; message?: unknown }
    if (typeof d.error === 'string') return d.error
    if (typeof d.message === 'string') return d.message
  }
  return null
}

/**
 * Import a profile from a single source string (a metprofiles link, a direct
 * profile URL, or raw profile JSON) via the shared `/api/import-from-url`
 * endpoint. This is the one code path used by both the Add Profile dialog and
 * the automatic share-sheet / `?import=` import, so their behavior stays in
 * lock-step. Never throws: failures come back as an `error` result.
 */
export async function importProfileFromSource(
  source: string,
  options: ImportOptions = {},
): Promise<ImportProfileResult> {
  let serverUrl: string
  try {
    serverUrl = await getServerUrl()
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : null }
  }

  let response: Response
  try {
    response = await fetch(`${serverUrl}/api/import-from-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: source,
        generate_description: options.generateDescription ?? false,
      }),
    })
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : null }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    return { status: 'error', message: extractErrorMessage(body) }
  }

  const result = await response.json().catch(() => null)
  if (!result || typeof result !== 'object') {
    return { status: 'error', message: null }
  }

  const name = (result as { profile_name?: string }).profile_name ?? ''
  if ((result as { status?: string }).status === 'exists') {
    return { status: 'exists', profileName: name }
  }
  return { status: 'success', profileName: name }
}
