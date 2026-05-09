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
      swipeDirections={['down', 'up', 'left', 'right'] as ToasterProps['swipeDirections']}
      // Position below status bar / Dynamic Island on iOS
      offset="env(safe-area-inset-top, 0px)"
      toastOptions={{
        style: {
          // Ensure toasts clear the safe area on all devices
          marginTop: 'max(0px, env(safe-area-inset-top, 0px))',
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
