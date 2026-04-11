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

export { useGenerationProgress } from './useGenerationProgress';
export type { GenerationPhase, ProgressEvent, UseGenerationProgressReturn } from './useGenerationProgress';
export { PHASE_ORDER, phaseProgress } from './useGenerationProgress';

// UI Hooks
export { useIsDesktop } from './use-desktop';

export { useIsMobile } from './use-mobile';

export { useSwipeNavigation } from './use-swipe-navigation';

export { usePlatformTheme } from './usePlatformTheme';
export type { PlatformTheme, DetectedPlatform } from './usePlatformTheme';

// Platform / Capacitor Hooks
export { useWakeLock } from './useWakeLock';

export { useHaptics } from './useHaptics'

export { useBiometrics } from './useBiometrics'
export type { BiometryInfo } from './useBiometrics';

export { useBrewNotifications } from './useBrewNotifications';

export { useSecureStorage } from './useSecureStorage';

export { useNetworkStatus } from './useNetworkStatus';

export { useNativeShare } from './useNativeShare';

export { useActionSheet } from './useActionSheet';

export { useClipboard } from './useClipboard';

// Accessibility Hooks
export * from './a11y';
