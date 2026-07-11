import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  registerUnsavedChangesGuard,
  hasUnsavedChanges,
  useUnsavedChangesGuard,
} from './unsavedChanges'

describe('unsavedChanges registry', () => {
  it('reports no unsaved changes when nothing is registered', () => {
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('reports unsaved changes while a truthy predicate is registered', () => {
    const unregister = registerUnsavedChangesGuard(() => true)
    expect(hasUnsavedChanges()).toBe(true)
    unregister()
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('ignores predicates that report no changes', () => {
    const unregister = registerUnsavedChangesGuard(() => false)
    expect(hasUnsavedChanges()).toBe(false)
    unregister()
  })

  it('returns true if any registered predicate reports changes', () => {
    const a = registerUnsavedChangesGuard(() => false)
    const b = registerUnsavedChangesGuard(() => true)
    expect(hasUnsavedChanges()).toBe(true)
    a()
    b()
    expect(hasUnsavedChanges()).toBe(false)
  })
})

describe('useUnsavedChangesGuard', () => {
  it('reflects the latest hasChanges value without re-registering', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    })
    expect(hasUnsavedChanges()).toBe(false)

    rerender({ dirty: true })
    expect(hasUnsavedChanges()).toBe(true)

    rerender({ dirty: false })
    expect(hasUnsavedChanges()).toBe(false)

    rerender({ dirty: true })
    expect(hasUnsavedChanges()).toBe(true)

    unmount()
    expect(hasUnsavedChanges()).toBe(false)
  })
})
