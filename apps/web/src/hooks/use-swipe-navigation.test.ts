import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSwipeNavigation } from './use-swipe-navigation'

describe('useSwipeNavigation', () => {
  let onSwipeRight: ReturnType<typeof vi.fn>
  let onSwipeLeft: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSwipeRight = vi.fn()
    onSwipeLeft = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const simulateSwipe = (startX: number, startY: number, endX: number, endY: number, duration = 200) => {
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: startX, clientY: startY } as Touch],
    })
    document.dispatchEvent(touchStart)

    vi.advanceTimersByTime(duration)

    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: endX, clientY: endY } as Touch],
    })
    document.dispatchEvent(touchEnd)
  }

  it('should call onSwipeRight when swiping right with sufficient distance and velocity', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Swipe right: 150px in 200ms = 0.75 px/ms velocity
    simulateSwipe(50, 100, 200, 100, 200)

    expect(onSwipeRight).toHaveBeenCalledTimes(1)
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('should call onSwipeLeft when swiping left with sufficient distance and velocity', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Swipe left: 150px in 200ms = 0.75 px/ms velocity
    simulateSwipe(200, 100, 50, 100, 200)

    expect(onSwipeLeft).toHaveBeenCalledTimes(1)
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('should not trigger callback if swipe distance is below threshold', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 100,
        velocityThreshold: 0.3,
      })
    )

    // Swipe right but only 40px (below threshold of 100)
    simulateSwipe(50, 100, 90, 100, 100)

    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('should not trigger callback if swipe velocity is below threshold', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.5,
      })
    )

    // Swipe right 100px in 500ms = 0.2 px/ms velocity (below 0.5 threshold)
    simulateSwipe(50, 100, 150, 100, 500)

    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('should not trigger callback if swipe is primarily vertical', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Swipe diagonally but more vertical than horizontal
    simulateSwipe(50, 50, 100, 200, 200)

    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('should not trigger callbacks when disabled', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        enabled: false,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    simulateSwipe(50, 100, 200, 100, 200)

    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('should handle touchcancel event', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
      })
    )

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 50, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchStart)

    const touchCancel = new TouchEvent('touchcancel')
    document.dispatchEvent(touchCancel)

    // Now try to end the touch - should not trigger callback
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchEnd)

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('should ignore multi-finger touches', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Two-finger touch start
    const touchStart = new TouchEvent('touchstart', {
      touches: [
        { clientX: 50, clientY: 100 } as Touch,
        { clientX: 100, clientY: 100 } as Touch,
      ],
    })
    document.dispatchEvent(touchStart)

    vi.advanceTimersByTime(200)

    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchEnd)

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('should not trigger callback when deltaTime is zero', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Start a swipe
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 50, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchStart)

    // Don't advance time - deltaTime will be 0
    vi.advanceTimersByTime(0)

    // End the swipe immediately
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchEnd)

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('should clear touch data when multi-finger gesture is detected mid-swipe', () => {
    renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
        threshold: 50,
        velocityThreshold: 0.3,
      })
    )

    // Start with single finger
    const touchStart1 = new TouchEvent('touchstart', {
      touches: [{ clientX: 50, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchStart1)

    // Add second finger mid-swipe
    const touchStart2 = new TouchEvent('touchstart', {
      touches: [
        { clientX: 60, clientY: 100 } as Touch,
        { clientX: 100, clientY: 100 } as Touch,
      ],
    })
    document.dispatchEvent(touchStart2)

    vi.advanceTimersByTime(200)

    // End the touch
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
    })
    document.dispatchEvent(touchEnd)

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('should clean up event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() =>
      useSwipeNavigation({
        onSwipeRight,
        onSwipeLeft,
      })
    )

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function))

    removeEventListenerSpy.mockRestore()
  })
})
