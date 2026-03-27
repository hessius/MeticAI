import { ComponentProps } from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { Progressbar } from 'konsta/react'
import { useKonstaOverride } from '@/hooks/useKonstaOverride'
import { cn } from "@/lib/utils"

function ShadcnProgress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const useKonsta = useKonstaOverride()

  if (!useKonsta) {
    return <ShadcnProgress className={className} value={value} {...props} />
  }

  // Konsta Progressbar expects 0-1, shadcn Progress uses 0-100
  // Forward id, aria-*, and data-* attributes for accessibility
  const { id, ...rest } = props as Record<string, unknown>
  const forwardProps: Record<string, unknown> = {}
  if (id) forwardProps.id = id
  for (const [key, val] of Object.entries(rest)) {
    if (key.startsWith('aria-') || key.startsWith('data-')) forwardProps[key] = val
  }

  return (
    <Progressbar
      progress={(value || 0) / 100}
      className={className}
      {...forwardProps}
    />
  )
}

export { Progress }
