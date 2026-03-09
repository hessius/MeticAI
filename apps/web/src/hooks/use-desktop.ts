import { useCallback, useSyncExternalStore } from "react"

const DESKTOP_BREAKPOINT = 1024

/**
 * Hook to detect if the current device is a desktop
 * Returns true if the viewport width is >= 1024px (Tailwind `lg:` breakpoint)
 * @returns boolean True if on desktop, false if on mobile/tablet, undefined during SSR
 */
export function useIsDesktop(): boolean | undefined {
  const subscribe = useCallback((cb: () => void) => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)
    mql.addEventListener("change", cb)
    return () => mql.removeEventListener("change", cb)
  }, [])

  const getSnapshot = useCallback(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches,
    [],
  )

  const getServerSnapshot = useCallback(() => undefined as boolean | undefined, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
