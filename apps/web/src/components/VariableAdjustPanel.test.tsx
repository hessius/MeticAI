import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VariableAdjustPanel, type ProfileVariable } from './VariableAdjustPanel'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'variables.adjust': 'Adjust Variables',
        'variables.resetAll': 'Reset All',
        'variables.reset': 'Reset',
        'variables.overridesApplied': `${opts?.count ?? 0} adjusted`,
        'variables.noAdjustable': 'No adjustable variables in this profile',
        'variables.original': `Original: ${opts?.value ?? ''}`,
      }
      return translations[key] || key
    },
    i18n: { language: 'en' },
  }),
}))

const mockVariables: ProfileVariable[] = [
  { key: 'pressure_main', name: 'Main Pressure', type: 'pressure', value: 9.0 },
  { key: 'flow_rate', name: 'Flow Rate', type: 'flow', value: 4.0 },
  { key: 'dose_weight', name: 'Dose Weight', type: 'weight', value: 18.0 },
]

describe('VariableAdjustPanel', () => {
  let onOverridesChange: ReturnType<typeof vi.fn>
  let onReset: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onOverridesChange = vi.fn()
    onReset = vi.fn()
  })

  it('should render panel toggle with adjust label', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{}}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    expect(screen.getByText('Adjust Variables')).toBeDefined()
  })

  it('should show Reset All button when expanded and overrides exist', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{ pressure_main: 7.5 }}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    // Expand the panel
    fireEvent.click(screen.getByText('Adjust Variables'))
    expect(screen.getByText('Reset All')).toBeDefined()
  })

  it('should call onReset when Reset All is clicked', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{ pressure_main: 7.5 }}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('Adjust Variables'))
    fireEvent.click(screen.getByText('Reset All'))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('should render variable names when expanded', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{}}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('Adjust Variables'))
    expect(screen.getByText('Main Pressure')).toBeDefined()
    expect(screen.getByText('Flow Rate')).toBeDefined()
    expect(screen.getByText('Dose Weight')).toBeDefined()
  })

  it('should call onOverridesChange removing key when individual reset is clicked', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{ pressure_main: 7.5, flow_rate: 3.0 }}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('Adjust Variables'))
    const resetButtons = screen.getAllByTitle('Reset')
    expect(resetButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(resetButtons[0])
    expect(onOverridesChange).toHaveBeenCalledWith({ flow_rate: 3.0 })
  })

  it('should filter out info_ prefixed variables', () => {
    const varsWithInfo: ProfileVariable[] = [
      ...mockVariables,
      { key: 'info_beans', name: '☕ Beans', type: 'pressure', value: 0 },
    ]
    render(
      <VariableAdjustPanel
        profileVariables={varsWithInfo}
        overrides={{}}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('Adjust Variables'))
    expect(screen.queryByText('☕ Beans')).toBeNull()
  })

  it('should show adjusted count badge in collapsed header', () => {
    render(
      <VariableAdjustPanel
        profileVariables={mockVariables}
        overrides={{ pressure_main: 7.5, flow_rate: 3.0 }}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    expect(screen.getByText('2 adjusted')).toBeDefined()
  })

  it('should return null for empty adjustable variables', () => {
    const { container } = render(
      <VariableAdjustPanel
        profileVariables={[]}
        overrides={{}}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('should return null when all variables are info_ prefixed', () => {
    const infoOnly: ProfileVariable[] = [
      { key: 'info_beans', name: '☕ Beans', type: 'pressure', value: 0 },
      { key: 'info_roast', name: '🔥 Roast', type: 'pressure', value: 0 },
    ]
    const { container } = render(
      <VariableAdjustPanel
        profileVariables={infoOnly}
        overrides={{}}
        onOverridesChange={onOverridesChange}
        onReset={onReset}
      />
    )
    expect(container.innerHTML).toBe('')
  })
})
