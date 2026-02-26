/**
 * i18n public API.
 *
 * Usage:
 *   import { t, changeLanguage, getCurrentLanguage } from './i18n';
 *   await initI18n();    // call once at startup
 *   t('gameOver.title'); // => 'GAME OVER'
 */

export { initI18n, STORAGE_KEY } from './config';
export { KEYS } from './keys';
import { i18next } from './config';

/**
 * Translate a key, with optional interpolation options.
 * Falls back to the key itself when no translation is found.
 *
 * @example
 *   t('gameOver.title')           // 'GAME OVER'
 *   t('levelComplete.nextStarAt', { score: 5000 })
 */
export function t(key: string, opts?: object): string {
  return i18next.t(key, opts as Record<string, unknown>) as string;
}

/**
 * Switch the active language and persist the preference to localStorage.
 *
 * @param lang  BCP 47 language tag, e.g. 'en', 'es', 'fr', 'de'
 */
export function changeLanguage(lang: string): Promise<void> {
  return i18next.changeLanguage(lang).then(() => {
    // Resolve with void
  });
}

/**
 * Return the currently active language code, e.g. 'en'.
 */
export function getCurrentLanguage(): string {
  return i18next.language;
}

/**
 * Subscribe to language change events. Returns an unsubscribe function.
 *
 * @example
 *   const unsub = onLanguageChange(() => rebuild());
 *   // later:
 *   unsub();
 */
export function onLanguageChange(handler: () => void): () => void {
  i18next.on('languageChanged', handler);
  return () => i18next.off('languageChanged', handler);
}
