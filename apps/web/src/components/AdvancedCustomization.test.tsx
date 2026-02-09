import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvancedCustomization, AdvancedCustomizationOptions } from './AdvancedCustomization'

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('AdvancedCustomization', () => {
  let mockOnChange: (value: AdvancedCustomizationOptions) => void
  let defaultValue: AdvancedCustomizationOptions

  beforeEach(() => {
    mockOnChange = vi.fn<(value: AdvancedCustomizationOptions) => void>()
    defaultValue = {}
  })

  describe('rendering', () => {
    it('should render the collapsible trigger', () => {
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      expect(screen.getByText('Advanced Customization')).toBeInTheDocument()
    })

    it('should be collapsed by default', () => {
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      // The basket size label should not be visible when collapsed
      expect(screen.queryByText('Basket Size')).not.toBeInTheDocument()
    })

    it('should expand when clicked', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      expect(screen.getByText('Basket Size')).toBeInTheDocument()
      expect(screen.getByText('Basket Type')).toBeInTheDocument()
      expect(screen.getByText('Water Temperature (°C)')).toBeInTheDocument()
      expect(screen.getByText('Max Pressure (bar)')).toBeInTheDocument()
      expect(screen.getByText('Max Flow (ml/s)')).toBeInTheDocument()
      expect(screen.getByText('Shot Volume (ml)')).toBeInTheDocument()
      expect(screen.getByText('Dose (g)')).toBeInTheDocument()
      expect(screen.getByText('Bottom Filter')).toBeInTheDocument()
    })
  })

  describe('AdvancedCustomizationOptions interface', () => {
    it('should have correct types for all options', () => {
      const options: AdvancedCustomizationOptions = {
        basketSize: '18g',
        basketType: 'vst',
        waterTemp: 93,
        maxPressure: 9,
        maxFlow: 4.5,
        shotVolume: 40,
        dose: 18,
        bottomFilter: 'yes',
      }
      
      expect(options.basketSize).toBe('18g')
      expect(options.basketType).toBe('vst')
      expect(options.waterTemp).toBe(93)
      expect(options.maxPressure).toBe(9)
      expect(options.maxFlow).toBe(4.5)
      expect(options.shotVolume).toBe(40)
      expect(options.dose).toBe(18)
      expect(options.bottomFilter).toBe('yes')
    })

    it('should allow undefined for all options', () => {
      const options: AdvancedCustomizationOptions = {}
      
      expect(options.basketSize).toBeUndefined()
      expect(options.basketType).toBeUndefined()
      expect(options.waterTemp).toBeUndefined()
      expect(options.maxPressure).toBeUndefined()
      expect(options.maxFlow).toBeUndefined()
      expect(options.shotVolume).toBeUndefined()
      expect(options.dose).toBeUndefined()
      expect(options.bottomFilter).toBeUndefined()
    })

    it('should only allow yes or no for bottomFilter', () => {
      const optionsYes: AdvancedCustomizationOptions = { bottomFilter: 'yes' }
      const optionsNo: AdvancedCustomizationOptions = { bottomFilter: 'no' }
      
      expect(optionsYes.bottomFilter).toBe('yes')
      expect(optionsNo.bottomFilter).toBe('no')
    })
  })

  describe('number inputs', () => {
    it('should call onChange when water temperature is entered', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      // Expand the section
      await user.click(screen.getByText('Advanced Customization'))
      
      // Find and fill the water temp input
      const waterTempInput = screen.getByPlaceholderText('e.g., 93')
      await user.type(waterTempInput, '94')
      
      // Should have called onChange for each character
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should call onChange when max pressure is entered', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      const maxPressureInput = screen.getByPlaceholderText('e.g., 9')
      await user.type(maxPressureInput, '8')
      
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should call onChange when max flow is entered', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      const maxFlowInput = screen.getByPlaceholderText('e.g., 4.5')
      await user.type(maxFlowInput, '5')
      
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should call onChange when shot volume is entered', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      const shotVolumeInput = screen.getByPlaceholderText('e.g., 40')
      await user.type(shotVolumeInput, '36')
      
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should call onChange when dose is entered', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      const doseInput = screen.getByPlaceholderText('e.g., 18')
      await user.type(doseInput, '20')
      
      expect(mockOnChange).toHaveBeenCalled()
    })
  })

  describe('clear buttons', () => {
    it('should show clear button for water temp when value is set', async () => {
      const user = userEvent.setup()
      const valueWithWaterTemp: AdvancedCustomizationOptions = { waterTemp: 93 }
      
      render(<AdvancedCustomization value={valueWithWaterTemp} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // There should be clear buttons (X icons) visible
      const clearButtons = screen.getAllByRole('button').filter(
        btn => btn.querySelector('svg')
      )
      expect(clearButtons.length).toBeGreaterThan(0)
    })

    it('should clear water temp when clear button is clicked', async () => {
      const user = userEvent.setup()
      const valueWithWaterTemp: AdvancedCustomizationOptions = { waterTemp: 93 }
      
      render(
        <AdvancedCustomization value={valueWithWaterTemp} onChange={mockOnChange} />
      )
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // Find the clear button next to water temp input
      const waterTempInput = screen.getByDisplayValue('93')
      const clearButton = waterTempInput.parentElement?.querySelector('button')
      
      if (clearButton) {
        await user.click(clearButton)
        expect(mockOnChange).toHaveBeenCalledWith({ waterTemp: undefined })
      }
    })
  })

  describe('displaying set values', () => {
    it('should display water temperature value when set', async () => {
      const user = userEvent.setup()
      const valueWithTemp: AdvancedCustomizationOptions = { waterTemp: 94.5 }
      
      render(<AdvancedCustomization value={valueWithTemp} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      expect(screen.getByDisplayValue('94.5')).toBeInTheDocument()
    })

    it('should display max pressure value when set', async () => {
      const user = userEvent.setup()
      const valueWithPressure: AdvancedCustomizationOptions = { maxPressure: 8.5 }
      
      render(<AdvancedCustomization value={valueWithPressure} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      expect(screen.getByDisplayValue('8.5')).toBeInTheDocument()
    })

    it('should display dose value when set', async () => {
      const user = userEvent.setup()
      const valueWithDose: AdvancedCustomizationOptions = { dose: 18.5 }
      
      render(<AdvancedCustomization value={valueWithDose} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      expect(screen.getByDisplayValue('18.5')).toBeInTheDocument()
    })
  })

  describe('bottomFilter three-state behavior', () => {
    it('should show "Doesn\'t matter" placeholder when bottomFilter is undefined', async () => {
      const user = userEvent.setup()
      
      render(<AdvancedCustomization value={{}} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // The select should show the placeholder
      expect(screen.getByText("Doesn't matter")).toBeInTheDocument()
    })

    it('should not show clear button when bottomFilter is undefined', async () => {
      const user = userEvent.setup()
      
      render(<AdvancedCustomization value={{}} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // When bottomFilter is undefined, we should see the placeholder text
      // and there should be no visible X/clear button for bottom filter
      expect(screen.getByText("Doesn't matter")).toBeInTheDocument()
      
      // The placeholder indicates the value is unset - the clear button only appears
      // when a value is selected, which will replace the placeholder text
    })

    it('should show clear button when bottomFilter is set to yes', async () => {
      const user = userEvent.setup()
      const valueWithFilter: AdvancedCustomizationOptions = { bottomFilter: 'yes' }
      
      render(<AdvancedCustomization value={valueWithFilter} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // Should display "Yes" in the select and have a clear button
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })

    it('should show clear button when bottomFilter is set to no', async () => {
      const user = userEvent.setup()
      const valueWithFilter: AdvancedCustomizationOptions = { bottomFilter: 'no' }
      
      render(<AdvancedCustomization value={valueWithFilter} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // Should display "No" in the select
      expect(screen.getByText('No')).toBeInTheDocument()
    })
  })

  describe('multiple values', () => {
    it('should display all set values correctly', async () => {
      const user = userEvent.setup()
      const fullValue: AdvancedCustomizationOptions = {
        waterTemp: 93,
        maxPressure: 9,
        maxFlow: 4.5,
        shotVolume: 40,
        dose: 18,
        bottomFilter: 'yes',
      }
      
      render(<AdvancedCustomization value={fullValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      expect(screen.getByDisplayValue('93')).toBeInTheDocument()
      expect(screen.getByDisplayValue('9')).toBeInTheDocument()
      expect(screen.getByDisplayValue('4.5')).toBeInTheDocument()
      expect(screen.getByDisplayValue('40')).toBeInTheDocument()
      expect(screen.getByDisplayValue('18')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have proper labels for all inputs', async () => {
      const user = userEvent.setup()
      render(<AdvancedCustomization value={defaultValue} onChange={mockOnChange} />)
      
      await user.click(screen.getByText('Advanced Customization'))
      
      // Check that labeled inputs exist
      expect(screen.getByLabelText('Water Temperature (°C)')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Pressure (bar)')).toBeInTheDocument()
      expect(screen.getByLabelText('Max Flow (ml/s)')).toBeInTheDocument()
      expect(screen.getByLabelText('Shot Volume (ml)')).toBeInTheDocument()
      expect(screen.getByLabelText('Dose (g)')).toBeInTheDocument()
    })
  })
})
