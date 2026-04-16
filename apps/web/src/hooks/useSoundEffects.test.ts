import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock tiks — avoid real AudioContext in tests
const mockTiks = {
  click: vi.fn(),
  toggle: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  hover: vi.fn(),
  pop: vi.fn(),
  swoosh: vi.fn(),
  notify: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
  setVolume: vi.fn(),
  setTheme: vi.fn(),
}

vi.mock('@rexa-developer/tiks/react', () => ({
  useTiks: () => mockTiks,
}))

// Mock reduced motion
let reducedMotionValue = false
vi.mock('@/hooks/a11y/useScreenReader', () => ({
  useReducedMotion: () => reducedMotionValue,
}))

// Mock sound preferences
let soundsEnabledValue = false
vi.mock('@/lib/soundPreferences', () => ({
  getSoundsEnabled: () => soundsEnabledValue,
  SOUND_PREFS_CHANGED_EVENT: 'meticai-sound-prefs-changed',
}))

import { useSoundEffects } from '@/hooks/useSoundEffects'

describe('useSoundEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    soundsEnabledValue = false
    reducedMotionValue = false
    // Ensure document is "visible"
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
  })

  it('does not play sounds when disabled', () => {
    soundsEnabledValue = false
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.shotComplete())
    act(() => result.current.machineReady())

    expect(mockTiks.success).not.toHaveBeenCalled()
    expect(mockTiks.notify).not.toHaveBeenCalled()
  })

  it('plays sounds when enabled', () => {
    soundsEnabledValue = true
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.shotComplete())
    expect(mockTiks.success).toHaveBeenCalledTimes(1)

    act(() => result.current.machineReady())
    expect(mockTiks.notify).toHaveBeenCalledTimes(1)

    act(() => result.current.brewingStarted())
    expect(mockTiks.click).toHaveBeenCalledTimes(1)
  })

  it('does not play sounds when reduced motion is preferred', () => {
    soundsEnabledValue = true
    reducedMotionValue = true
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.shotComplete())
    expect(mockTiks.success).not.toHaveBeenCalled()
  })

  it('does not play sounds when document is hidden', () => {
    soundsEnabledValue = true
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.shotComplete())
    expect(mockTiks.success).not.toHaveBeenCalled()
  })

  it('maps event methods to correct tiks sounds', () => {
    soundsEnabledValue = true
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.shotComplete())
    expect(mockTiks.success).toHaveBeenCalled()

    act(() => result.current.machineReady())
    expect(mockTiks.notify).toHaveBeenCalled()

    act(() => result.current.pourOverTarget())
    expect(mockTiks.success).toHaveBeenCalledTimes(2) // shotComplete + pourOverTarget

    act(() => result.current.pourOverDone())
    expect(mockTiks.pop).toHaveBeenCalled()

    act(() => result.current.machineError())
    expect(mockTiks.error).toHaveBeenCalled()

    act(() => result.current.brewingStarted())
    expect(mockTiks.click).toHaveBeenCalled()

    act(() => result.current.generationComplete())
    expect(mockTiks.success).toHaveBeenCalledTimes(3)

    act(() => result.current.warningSound())
    expect(mockTiks.warning).toHaveBeenCalled()
  })

  it('maps interaction sounds to correct tiks methods', () => {
    soundsEnabledValue = true
    const { result } = renderHook(() => useSoundEffects())

    act(() => result.current.buttonClick())
    expect(mockTiks.click).toHaveBeenCalled()

    act(() => result.current.toggleOn())
    expect(mockTiks.toggle).toHaveBeenCalledWith(true)

    act(() => result.current.toggleOff())
    expect(mockTiks.toggle).toHaveBeenCalledWith(false)

    act(() => result.current.islandExpand())
    expect(mockTiks.swoosh).toHaveBeenCalled()

    act(() => result.current.islandContract())
    expect(mockTiks.pop).toHaveBeenCalledTimes(1)
  })

  it('reflects enabled state from preferences', () => {
    soundsEnabledValue = false
    const { result } = renderHook(() => useSoundEffects())
    expect(result.current.enabled).toBe(false)
  })

  it('reacts to preference change events', () => {
    soundsEnabledValue = false
    const { result } = renderHook(() => useSoundEffects())
    expect(result.current.enabled).toBe(false)

    // Simulate enabling sounds via preference change
    soundsEnabledValue = true
    act(() => {
      window.dispatchEvent(new CustomEvent('meticai-sound-prefs-changed', { detail: { enabled: true } }))
    })
    expect(result.current.enabled).toBe(true)
  })
})
