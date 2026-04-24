import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import zh from './zh.json';

export const SUPPORTED_LANGS = ['en', 'zh'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      // Persist user choice in localStorage; do NOT auto-detect from
      // navigator/system — keep EN as the default until the user picks ZH
      // via the in-app dropdown. This keeps e2e selectors stable while still
      // allowing full localisation.
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'sidepad.lang',
    },
  });

export default i18n;
