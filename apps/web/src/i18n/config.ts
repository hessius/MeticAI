import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

export const supportedLanguages = ['en', 'sv', 'es', 'it', 'fr', 'de'] as const;
export type SupportedLanguage = typeof supportedLanguages[number];

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  sv: 'Svenska',
  es: 'Español',
  it: 'Italiano',
  fr: 'Français',
  de: 'Deutsch',
};

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'meticai-language',
    },
    backend: {
      loadPath: `${import.meta.env.BASE_URL || '/'}locales/{{lng}}/{{ns}}.json`,
      queryStringParams: { v: __APP_VERSION__ },
    },
    react: {
      useSuspense: false,
    },
  });

// Expose the i18n singleton for non-React surfaces that must render before /
// outside the React tree (e.g. the plain-DOM boot diagnostics overlay in
// src/lib/diagnostics.ts). Those call sites always pass an English defaultValue,
// so this is a progressive enhancement, not a hard dependency.
;(globalThis as Record<string, unknown>).i18next = i18n;

export default i18n;
