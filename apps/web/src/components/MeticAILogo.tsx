import { ImgHTMLAttributes } from 'react'

interface MeticAILogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  size?: number | string
  variant?: 'default' | 'white'
}

/**
 * MeticAI Logo Component
 * 
 * Renders the MeticAI coffee cup logo using the SVG files from public folder.
 * Supports custom sizing and light/dark variants.
 * 
 * @param size - Width/height of the logo (default: 40)
 * @param variant - 'default' for dark logo, 'white' for light logo
 * @param className - Additional CSS classes
 */
export function MeticAILogo({ 
  size = 40, 
  variant = 'default',
  className = '',
  ...props 
}: MeticAILogoProps) {
  const logoSrc = variant === 'white' ? '/logo-white.svg' : '/logo.svg'

  return (
    <img
      src={logoSrc}
      alt="MeticAI Logo"
      width={size}
      height={size}
      className={className}
      {...props}
    />
  )
}
