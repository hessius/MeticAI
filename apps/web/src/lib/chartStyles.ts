// Chart colors matching Meticulous app style (muted to fit dark theme)
export const CHART_COLORS = {
  pressure: '#4ade80',      // Green (muted)
  flow: '#67e8f9',          // Light cyan/blue (muted)
  weight: '#fbbf24',        // Amber/Yellow (muted)
  gravimetricFlow: '#c2855a', // Brown-orange (muted to fit dark theme)
  // Profile target curves (lighter/dashed versions of main colors)
  targetPressure: '#86efac',  // Lighter green for target pressure
  targetFlow: '#a5f3fc'       // Lighter cyan for target flow
}

// Stage colors for background areas (matching tag colors)
export const STAGE_COLORS = [
  'rgba(239, 68, 68, 0.25)',   // Red
  'rgba(249, 115, 22, 0.25)',  // Orange  
  'rgba(234, 179, 8, 0.25)',   // Yellow
  'rgba(34, 197, 94, 0.25)',   // Green
  'rgba(59, 130, 246, 0.25)',  // Blue
  'rgba(168, 85, 247, 0.25)',  // Purple
  'rgba(236, 72, 153, 0.25)',  // Pink
  'rgba(20, 184, 166, 0.25)',  // Teal
]

export const STAGE_BORDER_COLORS = [
  'rgba(239, 68, 68, 0.5)',
  'rgba(249, 115, 22, 0.5)',
  'rgba(234, 179, 8, 0.5)',
  'rgba(34, 197, 94, 0.5)',
  'rgba(59, 130, 246, 0.5)',
  'rgba(168, 85, 247, 0.5)',
  'rgba(236, 72, 153, 0.5)',
  'rgba(20, 184, 166, 0.5)',
]

// Darker text colors for stage pills — legible on both light and dark backgrounds
export const STAGE_TEXT_COLORS_LIGHT = [
  'rgb(153, 27, 27)',    // Red-800
  'rgb(154, 52, 18)',    // Orange-800
  'rgb(133, 77, 14)',    // Yellow-800
  'rgb(22, 101, 52)',    // Green-800
  'rgb(30, 64, 175)',    // Blue-800
  'rgb(107, 33, 168)',   // Purple-800
  'rgb(157, 23, 77)',    // Pink-800
  'rgb(17, 94, 89)',     // Teal-800
]

export const STAGE_TEXT_COLORS_DARK = [
  'rgb(252, 165, 165)',  // Red-300
  'rgb(253, 186, 116)',  // Orange-300
  'rgb(253, 224, 71)',   // Yellow-300
  'rgb(134, 239, 172)',  // Green-300
  'rgb(147, 197, 253)',  // Blue-300
  'rgb(216, 180, 254)',  // Purple-300
  'rgb(249, 168, 212)',  // Pink-300
  'rgb(94, 234, 212)',   // Teal-300
]

// Comparison chart colors
export const COMPARISON_COLORS = {
  pressure: '#4ade80',
  flow: '#67e8f9',
  weight: '#fbbf24'
}
