import type React from 'react';
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Hook to trap focus within a container (useful for modals/dialogs)
 */
export function useFocusTrap<T extends HTMLElement>(
  isActive: boolean
): RefObject<T | null> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement;

    // Get all focusable elements
    const getFocusableElements = (): HTMLElement[] => {
      const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      return Array.from(
        container.querySelectorAll<HTMLElement>(focusableSelectors)
      ).filter((el) => {
        return (
          el.offsetWidth > 0 &&
          el.offsetHeight > 0 &&
          !el.hasAttribute('aria-hidden')
        );
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    };

    // Focus first focusable element
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus to previously focused element
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    };
  }, [isActive]);

  return containerRef;
}

/**
 * Hook to automatically focus an element on mount
 */
export function useAutoFocus<T extends HTMLElement>(
  shouldFocus = true
): RefObject<T | null> {
  const elementRef = useRef<T>(null);

  useEffect(() => {
    if (shouldFocus && elementRef.current) {
      elementRef.current.focus();
    }
  }, [shouldFocus]);

  return elementRef;
}

/**
 * Hook to manage roving tab index for arrow key navigation
 * 
 * @param items - Array of items with id and optional disabled state
 * @param orientation - Navigation direction ('vertical' or 'horizontal')
 * @returns Container ref and function to get props for each item
 * 
 * @example
 * const { containerRef, getItemProps } = useRovingTabIndex(items, 'vertical');
 * 
 * <div ref={containerRef}>
 *   {items.map((item, index) => (
 *     <button key={item.id} {...getItemProps(item.id, index)}>
 *       {item.label}
 *     </button>
 *   ))}
 * </div>
 * 
 * Note: The returned props include a 'data-roving-item-id' attribute that must be
 * spread onto each item element for the roving tabindex to work correctly.
 */
export function useRovingTabIndex<T extends HTMLElement>(
  items: Array<{ id: string; disabled?: boolean }>,
  orientation: 'horizontal' | 'vertical' = 'vertical'
): {
  containerRef: RefObject<T | null>;
  getItemProps: (id: string, index: number) => {
    'data-roving-item-id': string;
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onFocus: () => void;
  };
} {
  const containerRef = useRef<T>(null);
  const currentIndexRef = useRef(0);

  const getNextIndex = (currentIndex: number, direction: 1 | -1): number => {
    let nextIndex = currentIndex;
    let attempts = 0;
    const maxAttempts = items.length;

    do {
      nextIndex = (nextIndex + direction + items.length) % items.length;
      attempts++;
    } while (items[nextIndex]?.disabled && attempts < maxAttempts);

    return nextIndex;
  };

  const focusItem = (index: number) => {
    if (!containerRef.current) return;

    const item = items[index];
    if (!item || item.disabled) return;

    const element = containerRef.current.querySelector<HTMLElement>(
      `[data-roving-item-id="${item.id}"]`
    );

    if (element) {
      element.focus();
      currentIndexRef.current = index;
    }
  };

  const getItemProps = (id: string, index: number) => ({
    'data-roving-item-id': id,
    tabIndex: index === currentIndexRef.current ? 0 : -1,
    onKeyDown: (e: React.KeyboardEvent) => {
      const isVertical = orientation === 'vertical';
      const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
      const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

      if (e.key === nextKey) {
        e.preventDefault();
        focusItem(getNextIndex(index, 1));
      } else if (e.key === prevKey) {
        e.preventDefault();
        focusItem(getNextIndex(index, -1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusItem(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusItem(items.length - 1);
      }
    },
    onFocus: () => {
      currentIndexRef.current = index;
    },
  });

  return { containerRef, getItemProps };
}
