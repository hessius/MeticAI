# Swipe Navigation & Gesture Support

This document describes the swipe navigation and gesture support implemented in the MeticAI web application.

## Features

### 1. Swipe-to-Navigate-Back

Users can swipe right on mobile devices to navigate back to the previous screen, mimicking native mobile app behavior.

**Supported Views:**
- **Form View** → Swipe right to return to Start screen
- **Results View** → Swipe right to return to Form
- **History Detail View** → Swipe right to return to History
- **History View** → Swipe right to return to Start
- **Settings View** → Swipe right to return to Start

**Not Active On:**
- Start screen (no previous screen)
- Loading screen (prevents accidental interruption)
- Error screen (user should explicitly choose retry or reset)

### 2. Swipe-to-Dismiss Toasts

Toast notifications can now be dismissed by swiping in any direction (up, down, left, or right), providing a more intuitive mobile experience.

**Configuration:**
- Swipe directions: up, down, left, right
- Distance threshold: ~45px (default)
- Velocity-based dismissal

## Implementation Details

### Hook: `useSwipeNavigation`

Located in `src/hooks/use-swipe-navigation.ts`

**Parameters:**
```typescript
interface SwipeNavigationOptions {
  onSwipeRight?: () => void      // Callback for right swipe
  onSwipeLeft?: () => void       // Callback for left swipe  
  enabled?: boolean              // Enable/disable detection (default: true)
  threshold?: number             // Min distance in pixels (default: 50)
  velocityThreshold?: number     // Min velocity (default: 0.3 px/ms)
}
```

**Features:**
- Touch event detection (touchstart, touchend, touchcancel)
- Single-finger gesture tracking
- Horizontal/vertical direction detection
- Configurable distance and velocity thresholds
- Cleanup on unmount

**Usage Example:**
```typescript
import { useSwipeNavigation } from '@/hooks/use-swipe-navigation'
import { useIsMobile } from '@/hooks/use-mobile'

function MyComponent() {
  const isMobile = useIsMobile()
  
  useSwipeNavigation({
    onSwipeRight: () => {
      if (isMobile) {
        // Navigate back
        navigateBack()
      }
    },
    enabled: isMobile && canGoBack,
    threshold: 50,
    velocityThreshold: 0.3,
  })
  
  // ... component logic
}
```

### Toast Configuration

The Sonner toast component has been enhanced in `src/components/ui/sonner.tsx`:

```typescript
<Sonner
  swipeDirections={['down', 'up', 'left', 'right']}
  // ... other props
/>
```

This enables multi-directional swipe-to-dismiss for all toast notifications.

## Testing

### Unit Tests

Location: `src/hooks/use-swipe-navigation.test.ts`

**Test Coverage:**
- ✓ Swipe right detection with sufficient distance and velocity
- ✓ Swipe left detection
- ✓ Threshold enforcement (distance too small)
- ✓ Velocity enforcement (swipe too slow)
- ✓ Direction filtering (vertical swipes ignored)
- ✓ Enable/disable functionality
- ✓ Touch cancel handling
- ✓ Multi-finger touch rejection
- ✓ Event listener cleanup on unmount

Run tests with:
```bash
npm run test:run src/hooks/use-swipe-navigation.test.ts
```

### Manual Testing

**Test on Mobile Devices:**
1. Open the app on a mobile browser (iOS Safari, Chrome on Android)
2. Navigate to the form view
3. Swipe right across the screen
4. Verify navigation back to start screen
5. Trigger a toast notification
6. Swipe the toast in any direction to dismiss

**Test on Desktop:**
- Swipe navigation is disabled on desktop (viewport ≥ 768px)
- Only touch events trigger swipes, not mouse drags

## Browser Compatibility

- **iOS Safari**: ✓ Fully supported
- **Chrome (Android)**: ✓ Fully supported
- **Firefox (Mobile)**: ✓ Fully supported
- **Edge (Mobile)**: ✓ Fully supported

## Accessibility Considerations

1. **Swipe is supplementary**: All navigation actions remain accessible via visible back buttons
2. **No interference**: Swipe gestures don't interfere with scrolling or other touch interactions
3. **Single-finger only**: Multi-finger gestures (pinch, zoom) are not affected
4. **Disabled when inappropriate**: Swipe is disabled on loading/error screens to prevent confusion

## Performance

- **Passive event listeners**: Touch events use `{ passive: true }` for better scroll performance
- **Minimal overhead**: Only active when enabled and on mobile devices
- **No polling**: Event-driven detection with no continuous monitoring

## Future Enhancements

Potential improvements for future versions:

1. **Visual feedback**: Add visual swipe indicator/animation
2. **Customizable gestures**: Allow swipe left for forward navigation
3. **Gesture zones**: Define specific screen areas for swipe detection
4. **Advanced gestures**: Support for swipe up/down actions
5. **Haptic feedback**: Vibration on successful swipe (where supported)

## Troubleshooting

**Swipe not working:**
- Verify you're on a mobile device or using mobile emulation
- Check that the view supports back navigation
- Ensure swipe moves >50px horizontally across the screen
- Swipe should be quick enough (velocity > 0.3 px/ms)

**Accidental navigation:**
- Increase the `threshold` parameter for longer swipe distance
- Increase `velocityThreshold` for faster swipe requirement

**Conflicts with other gestures:**
- The hook checks for horizontal-dominant swipes to avoid scroll interference
- Multi-finger touches are automatically ignored
