import { getServerUrl } from '@/lib/config'

/**
 * Fetches whether the Gemini API key is configured in proxy/server mode by
 * querying the MeticAI backend's `/api/settings` endpoint. The backend persists
 * the key synchronously on POST, so this reflects the latest saved value.
 *
 * Returns `true`/`false` for a successful check, or `null` if the backend is
 * unreachable (callers should leave the existing state untouched on `null`).
 */
export async function fetchProxyAiConfigured(): Promise<boolean | null> {
  try {
    const serverUrl = await getServerUrl()
    const res = await fetch(`${serverUrl}/api/settings`)
    if (!res.ok) return null
    const data = await res.json()
    const hasGeminiKey = Boolean((data.geminiApiKey || '').trim())
    return data.geminiApiKeyConfigured === true || hasGeminiKey
  } catch {
    return null
  }
}
