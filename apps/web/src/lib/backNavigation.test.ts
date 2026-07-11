import { describe, it, expect, afterEach, vi } from 'vitest'
import { closeTopmostOverlay } from './backNavigation'

function addOverlay(role: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', role)
  el.setAttribute('data-state', 'open')
  document.body.appendChild(el)
  return el
}

describe('closeTopmostOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('returns false when no overlay is open', () => {
    expect(closeTopmostOverlay()).toBe(false)
  })

  it('ignores overlays that are not open', () => {
    const el = document.createElement('div')
    el.setAttribute('role', 'dialog')
    el.setAttribute('data-state', 'closed')
    document.body.appendChild(el)
    expect(closeTopmostOverlay()).toBe(false)
  })

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
    'detects an open %s and dispatches an Escape keydown',
    (role) => {
      addOverlay(role)
      const events: string[] = []
      const listener = (e: KeyboardEvent) => events.push(e.key)
      document.addEventListener('keydown', listener)

      expect(closeTopmostOverlay()).toBe(true)
      expect(events).toEqual(['Escape'])

      document.removeEventListener('keydown', listener)
    },
  )

  it('dispatches a cancelable, bubbling Escape event', () => {
    addOverlay('dialog')
    let captured: KeyboardEvent | undefined
    const listener = (e: KeyboardEvent) => { captured = e }
    document.addEventListener('keydown', listener)

    closeTopmostOverlay()

    expect(captured?.key).toBe('Escape')
    expect(captured?.bubbles).toBe(true)
    expect(captured?.cancelable).toBe(true)

    document.removeEventListener('keydown', listener)
  })
})
