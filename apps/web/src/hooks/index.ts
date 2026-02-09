/**
 * Application Hooks
 * 
 * This module re-exports all application hooks for convenient imports.
 */

// Core Hooks
export { useHistory } from './useHistory';
export type { HistoryEntry, HistoryResponse } from './useHistory';

export { useProfileImageCache } from './useProfileImageCache';

export { useShotHistory } from './useShotHistory';

export { useUpdateStatus } from './useUpdateStatus';

export { useUpdateTrigger } from './useUpdateTrigger';

// UI Hooks
export { useIsDesktop } from './use-desktop';

export { useIsMobile } from './use-mobile';

export { useSwipeNavigation } from './use-swipe-navigation';

// Accessibility Hooks
export * from './a11y';
