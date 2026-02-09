import { useTheme } from "next-themes"
import { CSSProperties } from "react"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Enable swipe to dismiss in all directions for better mobile UX
      swipeDirections={['down', 'up', 'left', 'right']}
      toastOptions={{
        style: {
          // Add safe area padding for dynamic island on iOS
          marginTop: 'max(0px, calc(env(safe-area-inset-top) - 1rem))',
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
