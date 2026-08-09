/**
 * Finds the nearest scrollable ancestor of a node, walking up the DOM. Returns
 * `null` when none is found (the caller should then fall back to the document
 * scrolling element / window).
 */
export function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = node?.parentElement ?? null
  while (el) {
    const style = getComputedStyle(el)
    const overflowY = style.overflowY
    const scrollable =
      overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (scrollable && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
}

/**
 * Resolves the effective scrolling element for a node: its nearest scrollable
 * ancestor, or the document scrolling element as a fallback.
 */
export function resolveScroller(node: HTMLElement | null): HTMLElement | null {
  return getScrollParent(node) ?? (document.scrollingElement as HTMLElement | null)
}
