import { useEffect, useRef } from 'react'

/**
 * Scrolls the window to the top whenever any dependency changes.
 * Skips the initial mount to avoid double-scrolling with App.tsx's
 * global viewState scroll reset.
 */
export function useScrollToTop(deps: unknown[]) {
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    window.scrollTo(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
