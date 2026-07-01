import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnalysisTasteGate } from './AnalysisTasteGate'
import { DEFAULT_TASTE_DATA } from '../TasteCompassInput'

describe('AnalysisTasteGate (U1)', () => {
  it('calls onSkip when the user skips', () => {
    const onSkip = vi.fn()
    render(<AnalysisTasteGate onAnalyze={vi.fn()} onSkip={onSkip} />)
    fireEvent.click(screen.getByTestId('taste-gate-skip'))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
  it('calls onAnalyze with current taste data', () => {
    const onAnalyze = vi.fn()
    render(<AnalysisTasteGate onAnalyze={onAnalyze} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByTestId('taste-gate-analyze'))
    expect(onAnalyze).toHaveBeenCalledWith(DEFAULT_TASTE_DATA)
  })
})
