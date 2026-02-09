import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfileBreakdown, ProfileData } from './ProfileBreakdown'

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

describe('ProfileBreakdown', () => {
  describe('rendering', () => {
    it('should return null when profile is null', () => {
      const { container } = render(<ProfileBreakdown profile={null} />)
      expect(container.firstChild).toBeNull()
    })

    it('should return null when profile has no data', () => {
      const emptyProfile: ProfileData = {}
      const { container } = render(<ProfileBreakdown profile={emptyProfile} />)
      expect(container.firstChild).toBeNull()
    })

    it('should render temperature when provided', () => {
      const profile: ProfileData = { temperature: 93 }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('Temperature')).toBeInTheDocument()
      expect(screen.getByText('93°C')).toBeInTheDocument()
    })

    it('should render target weight when provided', () => {
      const profile: ProfileData = { final_weight: 40 }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('Target Weight')).toBeInTheDocument()
      expect(screen.getByText('40g')).toBeInTheDocument()
    })

    it('should render both temperature and weight', () => {
      const profile: ProfileData = { temperature: 94, final_weight: 50 }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('Temperature')).toBeInTheDocument()
      expect(screen.getByText('94°C')).toBeInTheDocument()
      expect(screen.getByText('Target Weight')).toBeInTheDocument()
      expect(screen.getByText('50g')).toBeInTheDocument()
    })
  })

  describe('variables display', () => {
    it('should render variables when provided', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: 'Main Pressure', key: 'pressure_1', type: 'pressure', value: 8.5 },
          { name: 'Flow Rate', key: 'flow_1', type: 'flow', value: 2.0 }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Adjustable Variables/)).toBeInTheDocument()
      expect(screen.getByText('Main Pressure')).toBeInTheDocument()
      expect(screen.getByText('Flow Rate')).toBeInTheDocument()
      // Values are displayed next to units in the same element
      expect(screen.getByText(/bar/)).toBeInTheDocument()
      expect(screen.getByText(/ml\/s/)).toBeInTheDocument()
    })

    it('should separate info variables from adjustable variables', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: '☕ Dose', key: 'info_dose', type: 'weight', value: 18 },
          { name: '💧 Add water', key: 'info_dilute', type: 'weight', value: 50 },
          { name: 'Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 9.0 }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      // Info variables should be in "Preparation" section
      expect(screen.getByText(/Preparation/)).toBeInTheDocument()
      expect(screen.getByText('☕ Dose')).toBeInTheDocument()
      expect(screen.getByText('18g')).toBeInTheDocument() // Dose shows as grams (weight type)
      expect(screen.getByText('💧 Add water')).toBeInTheDocument()
      expect(screen.getByText('50g')).toBeInTheDocument() // Weight type shows as grams
      
      // Adjustable variables should be in separate section
      expect(screen.getByText(/Adjustable Variables/)).toBeInTheDocument()
      expect(screen.getByText('Peak Pressure')).toBeInTheDocument()
      
      // Should show the Meticulous app tip
      expect(screen.getByText(/Meticulous app/)).toBeInTheDocument()
    })

    it('should render info-only profiles without adjustable section', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: '☕ Dose', key: 'info_dose', type: 'weight', value: 18 },
          { name: '🔧 Use bottom filter', key: 'info_filter', type: 'power', value: 0 }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Preparation/)).toBeInTheDocument()
      expect(screen.getByText('☕ Dose')).toBeInTheDocument()
      expect(screen.getByText('🔧 Use bottom filter')).toBeInTheDocument()
      // Power type with value 0 should not show a value (label-only)
      expect(screen.queryByText(/Adjustable Variables/)).not.toBeInTheDocument()
    })

    it('should not render variables section when empty', () => {
      const profile: ProfileData = { temperature: 93, variables: [] }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.queryByText(/Variables/)).not.toBeInTheDocument()
    })
  })

  describe('stages display', () => {
    it('should render stages with nested dynamics format', () => {
      const profile: ProfileData = {
        temperature: 94,
        stages: [
          {
            name: 'Soft Bloom',
            type: 'flow',
            dynamics: {
              points: [[0, 0], [5, 2], [15, 2]],
              over: 'time',
              interpolation: 'linear'
            },
            exit_triggers: [{ type: 'weight', value: 5, comparison: '>=' }],
            limits: [{ type: 'pressure', value: 3 }]
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Stages \(1\)/)).toBeInTheDocument()
      expect(screen.getByText('Soft Bloom')).toBeInTheDocument()
      expect(screen.getByText('flow')).toBeInTheDocument()
      // Should show dynamics - 0 → 2 ml/s
      expect(screen.getByText(/0\.0 → 2\.0 ml\/s/)).toBeInTheDocument()
    })

    it('should render stages with flattened dynamics format', () => {
      // Test flattened format (dynamics_points, dynamics_over, etc.)
      // This format comes from the history storage
      const profile = {
        temperature: 94,
        stages: [
          {
            name: 'Pressure Surge',
            type: 'pressure',
            dynamics_points: [[0, 3], [5, 8.5]],
            dynamics_over: 'time',
            dynamics_interpolation: 'linear',
            exit_triggers: [{ type: 'weight', value: 40, comparison: '>=' }]
          }
        ]
      } as ProfileData
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('Pressure Surge')).toBeInTheDocument()
      expect(screen.getByText('pressure')).toBeInTheDocument()
      // Should show dynamics - 3 → 8.5 bar
      expect(screen.getByText(/3\.0 → 8\.5 bar/)).toBeInTheDocument()
    })

    it('should show "Static" for stages without dynamics', () => {
      const profile: ProfileData = {
        temperature: 94,
        stages: [
          {
            name: 'Static Stage',
            type: 'pressure'
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('Static Stage')).toBeInTheDocument()
      // Check for the specific "no dynamics defined" text
      expect(screen.getByText(/no dynamics defined/)).toBeInTheDocument()
    })

    it('should display exit triggers', () => {
      const profile: ProfileData = {
        temperature: 94,
        stages: [
          {
            name: 'Test Stage',
            type: 'flow',
            dynamics: { points: [[0, 2]], over: 'time' },
            exit_triggers: [
              { type: 'weight', value: 40, comparison: '>=' },
              { type: 'time', value: 30, comparison: '>=' }
            ]
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Exit:/)).toBeInTheDocument()
      expect(screen.getByText(/weight >= 40g/)).toBeInTheDocument()
    })

    it('should display limits', () => {
      const profile: ProfileData = {
        temperature: 94,
        stages: [
          {
            name: 'Test Stage',
            type: 'flow',
            dynamics: { points: [[0, 2]], over: 'time' },
            limits: [{ type: 'pressure', value: 3 }]
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Max:/)).toBeInTheDocument()
      expect(screen.getByText(/pressure ≤ 3\.0 bar/)).toBeInTheDocument()
    })

    it('should resolve variable references in limits', () => {
      const profile: ProfileData = {
        variables: [
          { name: 'Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 8 }
        ],
        stages: [
          {
            name: 'Variable Limit Stage',
            type: 'flow',
            dynamics: { points: [[0, 2]], over: 'time' },
            limits: [{ type: 'pressure', value: '$peak_pressure' }]
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      // Should resolve $peak_pressure to 8.0, not show the variable name
      expect(screen.getByText(/pressure ≤ 8\.0 bar/)).toBeInTheDocument()
    })

    it('should handle multiple stages', () => {
      const profile: ProfileData = {
        temperature: 94,
        stages: [
          {
            name: 'Stage 1',
            type: 'flow',
            dynamics: { points: [[0, 2]], over: 'time' }
          },
          {
            name: 'Stage 2',
            type: 'pressure',
            dynamics: { points: [[0, 6], [10, 8]], over: 'time' }
          },
          {
            name: 'Stage 3',
            type: 'flow',
            dynamics: { points: [[0, 3]], over: 'time' }
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Stages \(3\)/)).toBeInTheDocument()
      expect(screen.getByText('Stage 1')).toBeInTheDocument()
      expect(screen.getByText('Stage 2')).toBeInTheDocument()
      expect(screen.getByText('Stage 3')).toBeInTheDocument()
    })
  })

  describe('dynamics pattern analysis', () => {
    it('should identify flat/constant patterns', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Constant Flow',
          type: 'flow',
          dynamics: { points: [[0, 2.5], [10, 2.5], [20, 2.5]], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      // Should show constant indicator
      expect(screen.getByText(/Holds at 2\.5 ml\/s/)).toBeInTheDocument()
    })

    it('should identify ascending patterns', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Ramp Up',
          type: 'pressure',
          dynamics: { points: [[0, 3], [5, 6], [10, 8.5]], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/3\.0 → 8\.5 bar/)).toBeInTheDocument()
      expect(screen.getByText(/ramping up/)).toBeInTheDocument()
    })

    it('should identify descending patterns', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Decline',
          type: 'pressure',
          dynamics: { points: [[0, 9], [5, 6], [10, 4]], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/9\.0 → 4\.0 bar/)).toBeInTheDocument()
      expect(screen.getByText(/declining/)).toBeInTheDocument()
    })

    it('should identify oscillating patterns', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Oscillate',
          type: 'pressure',
          dynamics: { points: [[0, 0], [2, 8], [4, 0], [6, 8], [8, 0]], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Oscillates/)).toBeInTheDocument()
    })

    it('should resolve variable references in dynamics', () => {
      const profile: ProfileData = {
        variables: [
          { name: 'Peak Pressure', key: 'peak', type: 'pressure', value: 9.0 }
        ],
        stages: [{
          name: 'Variable Stage',
          type: 'pressure',
          dynamics: { points: [[0, 3], [10, '$peak']], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      // Should resolve $peak to 9.0
      expect(screen.getByText(/3\.0 → 9\.0 bar/)).toBeInTheDocument()
    })
  })

  describe('duration display', () => {
    it('should show duration for time-based dynamics', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Timed Stage',
          type: 'flow',
          dynamics: { points: [[0, 2], [15, 2]], over: 'time' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText('15s')).toBeInTheDocument()
    })

    it('should show weight range for weight-based dynamics', () => {
      const profile: ProfileData = {
        stages: [{
          name: 'Weight Stage',
          type: 'pressure',
          dynamics: { points: [[0, 6], [30, 8]], over: 'weight' }
        }]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/30g range/)).toBeInTheDocument()
    })
  })

  describe('className prop', () => {
    it('should apply custom className', () => {
      const profile: ProfileData = { temperature: 93 }
      const { container } = render(
        <ProfileBreakdown profile={profile} className="custom-class" />
      )
      
      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('variable validation', () => {
    it('should show warning when info variable lacks emoji', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: 'Dose', key: 'info_dose', type: 'weight', value: 18 }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Info variable "Dose" should start with an emoji/)).toBeInTheDocument()
    })

    it('should show warning when adjustable variable has emoji', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: '☕ Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 9 }
        ],
        stages: [
          { name: 'Extract', type: 'pressure' }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Adjustable variable "☕ Peak Pressure" should not start with an emoji/)).toBeInTheDocument()
    })

    it('should show warning when adjustable variable is unused', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: 'Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 9 }
        ],
        stages: [
          { name: 'Extract', type: 'pressure' }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.getByText(/Variable "Peak Pressure" is defined but not used/)).toBeInTheDocument()
    })

    it('should not show warnings when variables are valid', () => {
      const profile: ProfileData = {
        temperature: 93,
        variables: [
          { name: '☕ Dose', key: 'info_dose', type: 'weight', value: 18 },
          { name: 'Peak Pressure', key: 'peak_pressure', type: 'pressure', value: 9 }
        ],
        stages: [
          { 
            name: 'Extract', 
            type: 'pressure',
            dynamics_points: [[0, '$peak_pressure']]
          }
        ]
      }
      render(<ProfileBreakdown profile={profile} />)
      
      expect(screen.queryByText(/Variable Issues/)).not.toBeInTheDocument()
    })
  })
})
