import { useEffect, useRef } from 'react'

/**
 * Lightweight global registry of "unsaved changes" predicates.
 *
 * Views that hold edits which require an explicit save register a predicate
 * here. The Android hardware back handler (and any other global navigation
 * guard) can then ask whether leaving the current screen would discard work,
 * without every editable component having to thread its dirty state up to the
 * app root.
 */
const guards = new Set<() => boolean>()

export function registerUnsavedChangesGuard(predicate: () => boolean): () => void {
  guards.add(predicate)
  return () => {
    guards.delete(predicate)
  }
}

export function hasUnsavedChanges(): boolean {
  for (const predicate of guards) {
    if (predicate()) return true
  }
  return false
}

/**
 * Register the current component's unsaved-changes state for the lifetime of
 * the component. `hasChanges` is read live via a ref, so the predicate always
 * reflects the latest render without re-registering on every change.
 */
export function useUnsavedChangesGuard(hasChanges: boolean): void {
  const ref = useRef(hasChanges)
  useEffect(() => {
    ref.current = hasChanges
  }, [hasChanges])
  useEffect(() => registerUnsavedChangesGuard(() => ref.current), [])
}
