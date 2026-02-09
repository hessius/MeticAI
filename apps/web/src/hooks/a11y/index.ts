/**
 * Accessibility Hooks
 * 
 * This module exports all accessibility-related hooks for the application.
 * These hooks help implement WCAG AA compliance for keyboard navigation,
 * screen reader support, and reduced motion preferences.
 */

// Focus Management Hooks
export { 
  useFocusTrap, 
  useAutoFocus, 
  useRovingTabIndex 
} from './useFocusManagement';

// Screen Reader Hooks
export { 
  useScreenReaderAnnouncement, 
  useReducedMotion, 
  useAnimationDuration 
} from './useScreenReader';
