import { useState, useEffect } from 'react'
import { Coffee } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

const sizes = {
  sm: { container: 'w-8 h-8', icon: 14 },
  md: { container: 'w-10 h-10', icon: 18 },
  lg: { container: 'w-12 h-12', icon: 24 },
} as const

interface ProfileImageProps {
  imageUrl?: string
  alt?: string
  size?: keyof typeof sizes
  className?: string
}

export function ProfileImage({ imageUrl, alt = '', size = 'md', className }: ProfileImageProps) {
  const [error, setError] = useState(false)

  // Reset error when URL changes (e.g., cached image becomes available)
  useEffect(() => { setError(false) }, [imageUrl])
  const s = sizes[size]

  return (
    <div className={cn(
      s.container,
      'rounded-full overflow-hidden border border-border/30 shrink-0 bg-secondary/60',
      className,
    )}>
      {imageUrl && !error ? (
        <img
          src={imageUrl}
          alt={alt}
          className="w-full h-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Coffee size={s.icon} className="text-muted-foreground/40" weight="fill" />
        </div>
      )}
    </div>
  )
}
