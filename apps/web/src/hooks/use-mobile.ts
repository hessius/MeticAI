import { useCallback, useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const subscribe = useCallback((cb: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", cb)
    return () => mql.removeEventListener("change", cb)
  }, [])

  const getSnapshot = useCallback(
    () => window.innerWidth < MOBILE_BREAKPOINT,
    [],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
