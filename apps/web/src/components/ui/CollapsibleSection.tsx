import { useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretDown, CaretUp } from '@phosphor-icons/react'

interface CollapsibleSectionProps {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  /** Optional trailing element shown next to the caret (e.g. status badge) */
  trailing?: ReactNode
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  trailing,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left group"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </h3>
        </span>
        <span className="flex items-center gap-2">
          {trailing}
          {open ? (
            <CaretUp size={16} className="text-muted-foreground" />
          ) : (
            <CaretDown size={16} className="text-muted-foreground" />
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
