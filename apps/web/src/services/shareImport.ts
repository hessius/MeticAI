/**
 * Native share-sheet ingestion.
 *
 * When the user shares a profile *to* Metic (an iOS/Android share sheet), the
 * @capgo/capacitor-share-target plugin hands us a title, an array of shared
 * texts, and an array of shared files. We distil that into a single "source"
 * string (a metprofiles link, a direct URL, or raw profile JSON) and feed it
 * into the very same import flow the web `?import=` parameter uses, so link,
 * file and text sharing all resolve through the shared @metic/core resolver.
 */

import { Capacitor } from '@capacitor/core'

/** A file shared to the app, as delivered by the share-target plugin. */
export interface SharedFile {
  uri: string
  name?: string
  mimeType?: string
}

/** The payload of a `shareReceived` event. */
export interface SharedContent {
  title?: string
  texts?: string[]
  files?: SharedFile[]
}

/** Reads a shared file's text content from its URI. Injected for testability. */
export type SharedFileReader = (uri: string) => Promise<string>

function looksLikeProfileFile(file: SharedFile): boolean {
  const name = file.name?.toLowerCase() ?? ''
  const mime = file.mimeType?.toLowerCase() ?? ''
  return (
    mime.includes('json') ||
    mime === 'text/plain' ||
    name.endsWith('.json') ||
    name.endsWith('.met')
  )
}

/**
 * Read a shared file's text via the Capacitor filesystem (native) or `fetch`
 * (web cache URLs / data URLs). Kept separate so {@link extractShareSource} can
 * be unit-tested without native modules.
 */
export async function readSharedFile(uri: string): Promise<string> {
  if (/^(https?:|blob:|data:)/i.test(uri)) {
    const res = await fetch(uri)
    return await res.text()
  }
  const { Filesystem } = await import('@capacitor/filesystem')
  const result = await Filesystem.readFile({ path: uri, encoding: 'utf8' as never })
  return typeof result.data === 'string' ? result.data : await (result.data as Blob).text()
}

/**
 * Distil a share event into a single importable source string, or `null` if it
 * contains nothing importable. Prefers shared text (a link or pasted JSON),
 * then falls back to reading the first profile-like file.
 */
export async function extractShareSource(
  event: SharedContent,
  readFile: SharedFileReader = readSharedFile,
): Promise<string | null> {
  const text = event.texts?.map((t) => (t ?? '').trim()).find((t) => t.length > 0)
  if (text) return text

  const files = event.files ?? []
  const file = files.find(looksLikeProfileFile) ?? files[0]
  if (file?.uri) {
    try {
      const content = (await readFile(file.uri)).trim()
      return content.length > 0 ? content : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Register a listener for shared content on native platforms. `onSource` is
 * invoked with the distilled source string, ready to hand to the import flow.
 * Returns a cleanup function. A no-op (returning a no-op cleanup) on web.
 */
export async function registerShareTargetListener(
  onSource: (source: string) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}
  const { CapacitorShareTarget } = await import('@capgo/capacitor-share-target')
  const handle = await CapacitorShareTarget.addListener('shareReceived', (event) => {
    extractShareSource(event as SharedContent)
      .then((source) => {
        if (source) onSource(source)
      })
      .catch(() => {
        /* ignore malformed / unparseable share payloads */
      })
  })
  return () => {
    void handle.remove()
  }
}
