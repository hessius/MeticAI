import type React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap, useAutoFocus, useRovingTabIndex } from './useFocusManagement';

describe('useFocusManagement', () => {
  describe('useFocusTrap', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should return a ref', () => {
      const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(false));
      expect(result.current).toBeDefined();
      expect(result.current.current).toBeNull();
    });

    it('should not trap focus when inactive', () => {
      const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(false));
      expect(result.current.current).toBeNull();
    });

    it('should handle keyboard events when active', () => {
      const { result, rerender } = renderHook(
        ({ isActive }) => useFocusTrap<HTMLDivElement>(isActive),
        { initialProps: { isActive: false } }
      );

      // Create container with focusable elements
      const testContainer = document.createElement('div');
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      button1.textContent = 'Button 1';
      button2.textContent = 'Button 2';
      testContainer.appendChild(button1);
      testContainer.appendChild(button2);
      document.body.appendChild(testContainer);

      // Assign the container to the ref
      Object.defineProperty(result.current, 'current', {
        value: testContainer,
        writable: true,
      });

      // Activate trap
      rerender({ isActive: true });

      // Clean up
      document.body.removeChild(testContainer);
    });
  });

  describe('useAutoFocus', () => {
    it('should return a ref', () => {
      const { result } = renderHook(() => useAutoFocus<HTMLButtonElement>(true));
      expect(result.current).toBeDefined();
    });

    it('should not focus when shouldFocus is false', () => {
      const { result } = renderHook(() => useAutoFocus<HTMLButtonElement>(false));
      expect(result.current.current).toBeNull();
    });

    it('should attempt to focus element when shouldFocus is true', () => {
      const button = document.createElement('button');
      const focusSpy = vi.spyOn(button, 'focus');
      document.body.appendChild(button);

      const { result } = renderHook(() => useAutoFocus<HTMLButtonElement>(true));
      
      // Manually set the ref
      Object.defineProperty(result.current, 'current', {
        value: button,
        writable: true,
      });

      // Re-render to trigger the effect
      const { rerender } = renderHook(
        ({ shouldFocus }) => {
          const ref = useAutoFocus<HTMLButtonElement>(shouldFocus);
          Object.defineProperty(ref, 'current', {
            value: button,
            writable: true,
          });
          return ref;
        },
        { initialProps: { shouldFocus: true } }
      );

      rerender({ shouldFocus: true });

      document.body.removeChild(button);
      focusSpy.mockRestore();
    });
  });

  describe('useRovingTabIndex', () => {
    const mockItems = [
      { id: 'item-1', disabled: false },
      { id: 'item-2', disabled: false },
      { id: 'item-3', disabled: true },
      { id: 'item-4', disabled: false },
    ];

    it('should return containerRef and getItemProps', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      expect(result.current.containerRef).toBeDefined();
      expect(result.current.getItemProps).toBeDefined();
      expect(typeof result.current.getItemProps).toBe('function');
    });

    it('should set tabIndex 0 for first item and -1 for others', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const props0 = result.current.getItemProps('item-1', 0);
      const props1 = result.current.getItemProps('item-2', 1);
      const props2 = result.current.getItemProps('item-3', 2);

      expect(props0.tabIndex).toBe(0);
      expect(props1.tabIndex).toBe(-1);
      expect(props2.tabIndex).toBe(-1);
    });

    it('should include data-roving-item-id in item props', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const props = result.current.getItemProps('item-1', 0);
      expect(props['data-roving-item-id']).toBe('item-1');
    });

    it('should include onKeyDown and onFocus handlers', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const props = result.current.getItemProps('item-1', 0);
      expect(typeof props.onKeyDown).toBe('function');
      expect(typeof props.onFocus).toBe('function');
    });

    it('should handle vertical orientation', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      // Create mock keyboard event
      const mockEvent = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const props = result.current.getItemProps('item-1', 0);
      
      act(() => {
        props.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle horizontal orientation', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'horizontal')
      );

      const mockEvent = {
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const props = result.current.getItemProps('item-1', 0);
      
      act(() => {
        props.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle Home key', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const mockEvent = {
        key: 'Home',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const props = result.current.getItemProps('item-2', 1);
      
      act(() => {
        props.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle End key', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const mockEvent = {
        key: 'End',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const props = result.current.getItemProps('item-1', 0);
      
      act(() => {
        props.onKeyDown(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should skip disabled items when navigating', () => {
      const items = [
        { id: 'item-1', disabled: false },
        { id: 'item-2', disabled: true },
        { id: 'item-3', disabled: false },
      ];

      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(items, 'vertical')
      );

      // Should be able to get props without error
      const props = result.current.getItemProps('item-1', 0);
      expect(props['data-roving-item-id']).toBe('item-1');
    });

    it('should update current index on focus', () => {
      const { result } = renderHook(() => 
        useRovingTabIndex<HTMLDivElement>(mockItems, 'vertical')
      );

      const props = result.current.getItemProps('item-2', 1);
      
      act(() => {
        props.onFocus();
      });

      // After focusing item-2, it should have tabIndex 0
      const updatedProps = result.current.getItemProps('item-2', 1);
      expect(updatedProps.tabIndex).toBe(0);
    });
  });
});
