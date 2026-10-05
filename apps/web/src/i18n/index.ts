import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en.ts';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes already
});

export default i18n;
