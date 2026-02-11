import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-tight transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 hover:shadow-md",
        destructive:
          "bg-destructive/90 text-white shadow-sm hover:bg-destructive focus-visible:ring-destructive/40",
        outline:
          "border border-border/60 bg-transparent shadow-sm hover:bg-secondary/80 hover:border-border",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/70",
        ghost:
          "hover:bg-secondary/60 text-muted-foreground hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        liquid:
          "liquid-button rounded-full font-semibold hover:-translate-y-0.5",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-9 rounded-lg gap-1.5 px-4 text-xs",
        lg: "h-12 rounded-xl px-7 text-base",
        icon: "size-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
