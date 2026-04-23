import { ImgHTMLAttributes } from 'react'

interface MeticLogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  size?: number | string
  variant?: 'default' | 'white'
}

/**
 * Metic Logo Component
 * 
 * Renders the Metic coffee cup logo using the SVG files from public folder.
 * Supports custom sizing and light/dark variants.
 * 
 * @param size - Width/height of the logo (default: 40)
 * @param variant - 'default' for dark logo, 'white' for light logo
 * @param className - Additional CSS classes
 */
export function MeticLogo({ 
  size = 40, 
  variant = 'default',
  className = '',
  ...props 
}: MeticLogoProps) {
  const base = import.meta.env.BASE_URL || '/'
  const logoSrc = variant === 'white' ? `${base}logo-white.svg` : `${base}logo.svg`

  return (
    <img
      src={logoSrc}
      alt="Metic Logo"
      width={size}
      height={size}
      className={className}
      {...props}
    />
  )
}
