/**
 * Generate a RFC-4122 v4 UUID that works in insecure contexts.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * localhost). Metic is frequently self-hosted and reached over plain
 * `http://<lan-ip>:<port>`, where `crypto.randomUUID` is `undefined` and a
 * bare call throws. This helper falls back to `crypto.getRandomValues` and,
 * as a last resort, `Math.random`, so callers always get a usable id.
 */
export function safeRandomUUID(): string {
  const native = globalThis.crypto?.randomUUID?.()
  if (native) return native

  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  // Set version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  )
}
