import type { Preview } from '@storybook/react-vite'
import { Suspense, useEffect } from 'react'
import i18n from 'i18next'
import '../src/i18n/config'
import '../src/main.css'

const preview: Preview = {
  parameters: {
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