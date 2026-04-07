"use client"

import { ComponentProps } from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Checkbox as KCheckbox } from 'konsta/react'
import { Check as CheckIcon } from "lucide-react"

import { useKonstaOverride } from '@/hooks/useKonstaOverride'
import { cn } from "@/lib/utils"

function ShadcnCheckbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  const useKonsta = useKonstaOverride()

  if (!useKonsta) {
    return <ShadcnCheckbox className={className} {...props} />
  }

  const { checked, onCheckedChange, disabled, name, ...rest } = props
  // Forward id, aria-*, data-* attributes for accessibility
  const forwardedProps: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rest)) {
    if (key === 'id' || key === 'value' || key.startsWith('aria-') || key.startsWith('data-')) {
      forwardedProps[key] = val
    }
  }

  return (
    <KCheckbox
      checked={checked === true}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onCheckedChange?.(e.target.checked)}
      disabled={disabled}
      name={name}
      className={className}
      {...forwardedProps}
    />
  )
}

export { Checkbox }
