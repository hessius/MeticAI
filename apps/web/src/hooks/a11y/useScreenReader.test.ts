import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { 
  useScreenReaderAnnouncement, 
  useReducedMotion, 
  useAnimationDuration 
} from './useScreenReader';

describe('useScreenReader', () => {
  describe('useScreenReaderAnnouncement', () => {
    beforeEach(() => {
      // Clear any existing announcers
      document.querySelectorAll('[role="status"]').forEach(el => el.remove());
    });

    afterEach(() => {
      // Clean up announcers
      document.querySelectorAll('[role="status"]').forEach(el => el.remove());
    });

    it('should return an announce function', () => {
      const { result } = renderHook(() => useScreenReaderAnnouncement());
      expect(typeof result.current).toBe('function');
    });

    it('should create an announcer element on mount', () => {
      renderHook(() => useScreenReaderAnnouncement());
      
      const announcer = document.querySelector('[role="status"]');
      expect(announcer).not.toBeNull();
      expect(announcer?.getAttribute('aria-live')).toBe('polite');
      expect(announcer?.getAttribute('aria-atomic')).toBe('true');
    });

    it('should announce polite messages', async () => {
      const { result } = renderHook(() => useScreenReaderAnnouncement());
      
      act(() => {
        result.current('Test announcement');
      });

      const announcer = document.querySelector('[role="status"]');
      expect(announcer?.textContent).toBe('Test announcement');
      expect(announcer?.getAttribute('aria-live')).toBe('polite');
    });

    it('should announce assertive messages', async () => {
      const { result } = renderHook(() => useScreenReaderAnnouncement());
      
      act(() => {
        result.current('Urgent announcement', 'assertive');
      });

      const announcer = document.querySelector('[role="status"]');
      expect(announcer?.textContent).toBe('Urgent announcement');
      expect(announcer?.getAttribute('aria-live')).toBe('assertive');
    });

    it('should clear announcement after timeout', async () => {
      vi.useFakeTimers();
      
      const { result } = renderHook(() => useScreenReaderAnnouncement());
      
      act(() => {
        result.current('Temporary message');
      });

      const announcer = document.querySelector('[role="status"]');
      expect(announcer?.textContent).toBe('Temporary message');

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      expect(announcer?.textContent).toBe('');

      vi.useRealTimers();
    });

    it('should remove announcer on unmount', () => {
      const { unmount } = renderHook(() => useScreenReaderAnnouncement());
      
      expect(document.querySelector('[role="status"]')).not.toBeNull();
      
      unmount();
      
      expect(document.querySelector('[role="status"]')).toBeNull();
    });

    it('should handle multiple announcements', () => {
      const { result } = renderHook(() => useScreenReaderAnnouncement());
      
      act(() => {
        result.current('First message');
      });

      const announcer = document.querySelector('[role="status"]');
      expect(announcer?.textContent).toBe('First message');

      act(() => {
        result.current('Second message');
      });

      expect(announcer?.textContent).toBe('Second message');
    });
  });

  describe('useReducedMotion', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it('should return false when user does not prefer reduced motion', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);
    });

    it('should return true when user prefers reduced motion', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(true);
    });

    it('should update when media query changes', () => {
      let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
      
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: (event: string, handler: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            changeHandler = handler;
          }
        },
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useReducedMotion());
      expect(result.current).toBe(false);

      // Simulate media query change
      if (changeHandler) {
        act(() => {
          changeHandler!({ matches: true } as MediaQueryListEvent);
        });
      }

      expect(result.current).toBe(true);
    });

    it('should remove event listener on unmount', () => {
      const removeEventListenerMock = vi.fn();
      
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerMock,
      }));

      const { unmount } = renderHook(() => useReducedMotion());
      unmount();

      expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('useAnimationDuration', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it('should return default duration when motion is not reduced', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useAnimationDuration(300));
      expect(result.current).toBe(300);
    });

    it('should return 0 when motion is reduced', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useAnimationDuration(300));
      expect(result.current).toBe(0);
    });

    it('should work with different duration values', () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result: result500 } = renderHook(() => useAnimationDuration(500));
      expect(result500.current).toBe(500);

      const { result: result1000 } = renderHook(() => useAnimationDuration(1000));
      expect(result1000.current).toBe(1000);
    });
  });
});
