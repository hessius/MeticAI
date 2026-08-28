import { describe, it, expect, afterEach } from 'vitest'
import { getScrollParent, resolveScroller } from '@/lib/scrollAnchor'

function makeScrollable(overflowY: string, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div')
  // jsdom doesn't lay out, so stub the computed style + metrics.
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.style.overflowY = overflowY
  return el
}

describe('scrollAnchor', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the nearest overflow:auto ancestor that actually scrolls', () => {
    const scroller = makeScrollable('auto', 500, 200)
    const child = document.createElement('div')
    scroller.appendChild(child)
    document.body.appendChild(scroller)

    expect(getScrollParent(child)).toBe(scroller)
  })

  it('skips ancestors that are not overflow-scrollable', () => {
    const outer = makeScrollable('visible', 500, 200)
    const child = document.createElement('div')
    outer.appendChild(child)
    document.body.appendChild(outer)

    expect(getScrollParent(child)).toBeNull()
  })

  it('skips scrollable-styled ancestors whose content does not overflow', () => {
    const outer = makeScrollable('auto', 200, 200)
    const child = document.createElement('div')
    outer.appendChild(child)
    document.body.appendChild(outer)

    expect(getScrollParent(child)).toBeNull()
  })

  it('falls back to the document scrolling element', () => {
    const orphan = document.createElement('div')
    expect(resolveScroller(orphan)).toBe(document.scrollingElement)
  })
})
