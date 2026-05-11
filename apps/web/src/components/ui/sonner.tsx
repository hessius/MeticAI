import { CSSProperties } from "react"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ position: _ignored, ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="bottom-center"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
      // Force bottom-center — placed after spread so it always wins
      // eslint-disable-next-line react/jsx-no-duplicate-props
      position="bottom-center"
    />
  )
}

export { Toaster }
