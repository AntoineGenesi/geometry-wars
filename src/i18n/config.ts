import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';

export const STORAGE_KEY = 'gw_language';

/**
 * Initialise i18next with English as the fallback language.
 * Language detection order: localStorage → browser navigator.
 * Language preference is persisted to localStorage under 'gw_language'.
 */
export function initI18n(): Promise<void> {
  return i18next
    .use(LanguageDetector)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'es', 'fr', 'de'],
      resources: {
        en: { translation: en },
        es: { translation: es },
        fr: { translation: fr },
        de: { translation: de },
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: STORAGE_KEY,
        caches: ['localStorage'],
      },
      interpolation: {
        escapeValue: false,
      },
    })
    .then(() => {
      // Resolve with void so callers can await without caring about TFunction
    });
}

export { i18next };
