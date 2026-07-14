/**
 * Detects and dismisses the topmost open Radix overlay (dialog, alert dialog,
 * sheet, dropdown/select/context menu, or listbox popover).
 *
 * Radix closes the topmost dismissable layer in response to an Escape keydown
 * on `document`. Android's hardware back button does not emit a keyboard event,
 * so we synthesise one. This lets a single back press close whatever modal is
 * currently open, mirroring the platform's expected behaviour, without wiring
 * every component's open state up to the app root.
 *
 * @returns true if an open overlay was found and an Escape was dispatched to
 *   close it (i.e. the back press was consumed), false otherwise.
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-radix-popper-content-wrapper] [data-state="open"]',
].join(',')

export function closeTopmostOverlay(): boolean {
  if (typeof document === 'undefined') return false
  const openOverlay = document.querySelector(OPEN_OVERLAY_SELECTOR)
  if (!openOverlay) return false

  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  )
  return true
}
