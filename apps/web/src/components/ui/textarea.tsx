import { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-[rgba(255,255,255,0.1)] placeholder:text-muted-foreground/60 focus-visible:border-[#FFB300] focus-visible:ring-2 focus-visible:ring-[#FFB300]/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-[rgba(0,0,0,0.3)] flex field-sizing-content min-h-16 w-full rounded-xl border px-4 py-3 text-sm shadow-sm transition-all duration-200 outline-none disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
