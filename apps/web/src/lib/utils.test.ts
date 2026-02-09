import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn utility function', () => {
  it('should merge class names correctly', () => {
    const result = cn('text-red-500', 'bg-blue-500')
    expect(result).toBe('text-red-500 bg-blue-500')
  })

  it('should handle conditional class names', () => {
    const isHidden = false
    const isVisible = true
    const result = cn('base-class', isHidden && 'hidden-class', isVisible && 'visible-class')
    expect(result).toBe('base-class visible-class')
  })

  it('should merge Tailwind classes correctly', () => {
    // When there are conflicting Tailwind classes, twMerge should keep the last one
    const result = cn('px-2', 'px-4')
    expect(result).toBe('px-4')
  })

  it('should handle undefined and null values', () => {
    const result = cn('text-sm', undefined, null, 'font-bold')
    expect(result).toBe('text-sm font-bold')
  })

  it('should handle arrays of class names', () => {
    const result = cn(['text-sm', 'font-bold'], 'text-red-500')
    expect(result).toBe('text-sm font-bold text-red-500')
  })

  it('should handle empty input', () => {
    const result = cn()
    expect(result).toBe('')
  })

  it('should handle object syntax', () => {
    const result = cn({
      'text-red-500': true,
      'bg-blue-500': false,
      'font-bold': true,
    })
    expect(result).toBe('text-red-500 font-bold')
  })

  it('should handle complex mixed inputs', () => {
    const isActive = true
    const isDisabled = false
    const result = cn(
      'base-class',
      isActive && 'active',
      isDisabled && 'disabled',
      { 'hover:bg-blue-500': true },
      ['text-sm', 'font-medium']
    )
    expect(result).toBe('base-class active hover:bg-blue-500 text-sm font-medium')
  })
})
