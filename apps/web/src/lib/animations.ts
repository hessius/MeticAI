import type { Variants, Transition } from 'framer-motion'

// ---------------------------------------------------------------------------
// Shared spring configs
// ---------------------------------------------------------------------------

/** Snappy, tactile feel — good for list items and micro-interactions */
export const snappySpring: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
}

/** Softer entrance — good for page-level transitions and modals */
export const gentleSpring: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Fade in from transparent */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

/** Slide in from below with fade */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

/** Scale up from slightly smaller */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
}

/** Slide in from right (for list items) */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

/** Collapse/expand for accordions */
export const collapse: Variants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto' },
}

/** Stagger children — use on a parent wrapper */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
}
