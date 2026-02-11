/**
 * AmbientBackground — animated blurred orbs behind all content.
 * Gives the "Golden Extraction" design its organic, living feel.
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Warm amber — top-left */}
      <div className="ambient-blob ambient-blob--amber" />

      {/* Deep brown — bottom-right */}
      <div className="ambient-blob ambient-blob--brown" />

      {/* Bright gold — centre */}
      <div className="ambient-blob ambient-blob--gold" />
    </div>
  );
}
