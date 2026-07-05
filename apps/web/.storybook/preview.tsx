import type { Preview } from '@storybook/react-vite'
import { Suspense, useEffect } from 'react'
import { MotionGlobalConfig } from 'framer-motion'
import i18n from 'i18next'
import '../src/i18n/config'
import '../src/main.css'

const preview: Preview = {
  parameters: {
    // Deterministic-by-default for visual-regression snapshots: this Storybook
    // exists primarily for the advisory visual-regression job, so animations are
    // disabled project-wide (CSS animations/transitions + framer-motion via
    // MotionGlobalConfig.skipAnimations in the decorator below). An individual
    // story can re-enable them with `parameters: { disableAnimation: false }`.
    disableAnimation: true,
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        {
          name: 'dark',
          value: '#252525',
        },
        {
          name: 'light',
          value: '#ffffff',
        },
      ],
    },
  },
  decorators: [
    (Story, context) => {
      const disableAnimation = !!context.parameters?.disableAnimation
      // Set synchronously on every render (before the Story mounts) so the
      // very first frame of framer-motion entrance animations is already
      // settled — an effect would run after paint, too late for a 300ms
      // entrance vs. the screenshot. Self-correcting per story (false when not
      // opted in) so it never leaks into normal, non-test stories. framer-motion
      // animates via JS inline styles, which a CSS override cannot stop.
      MotionGlobalConfig.skipAnimations = disableAnimation
      // The CSS override (pure-CSS animations/transitions) touches document.head,
      // so it must be added/removed in an effect with teardown — Storybook 10
      // swaps stories without reloading the preview iframe.
      useEffect(() => {
        if (!disableAnimation) return
        const style = document.createElement('style')
        style.setAttribute('data-test-no-anim', '')
        style.innerHTML = `*,*::before,*::after{animation:none!important;transition:none!important;}`
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, [disableAnimation])
      return <Story />
    },
    (Story, context) => {
      const locale = context.globals.locale || 'en';
      useEffect(() => {
        i18n.changeLanguage(locale);
      }, [locale]);
      return (
        <Suspense fallback={<div>Loading...</div>}>
          <div className="dark">
            <Story />
          </div>
        </Suspense>
      );
    },
  ],
  globalTypes: {
    locale: {
      name: 'Locale',
      description: 'Internationalization locale',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'sv', title: 'Svenska' },
          { value: 'es', title: 'Español' },
          { value: 'it', title: 'Italiano' },
          { value: 'fr', title: 'Français' },
          { value: 'de', title: 'Deutsch' },
        ],
        showName: true,
      },
    },
  },
};

export default preview;