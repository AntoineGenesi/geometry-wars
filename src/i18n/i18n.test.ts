/**
 * Unit tests for the i18n module.
 *
 * Tests cover: t(), changeLanguage(), getCurrentLanguage(), fallback behaviour,
 * and localStorage persistence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';

// ---------------------------------------------------------------------------
// Minimal localStorage mock
// ---------------------------------------------------------------------------

let mockStore = new Map<string, string>();

function setupLocalStorageMock(): void {
  mockStore = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mockStore.get(k) ?? null,
      setItem: (k: string, v: string) => mockStore.set(k, v),
      removeItem: (k: string) => mockStore.delete(k),
      clear: () => mockStore.clear(),
    },
  });
}

// ---------------------------------------------------------------------------
// Mock i18next-browser-languagedetector so tests work without a real browser
// ---------------------------------------------------------------------------

vi.mock('i18next-browser-languagedetector', () => ({
  default: {
    type: 'languageDetector' as const,
    async: false,
    init() {},
    detect() {
      try {
        return (globalThis as { localStorage?: { getItem(k: string): string | null } })
          .localStorage?.getItem('gw_language') ?? undefined;
      } catch {
        return undefined;
      }
    },
    cacheUserLanguage() {},
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type LocaleValue = string | number | boolean | null | LocaleObject | LocaleValue[];
interface LocaleObject {
  [key: string]: LocaleValue;
}

function flattenLocaleKeys(value: LocaleObject, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...flattenLocaleKeys(child as LocaleObject, nextKey));
    } else {
      keys.push(nextKey);
    }
  }
  return keys.sort();
}

describe('i18n module', () => {
  beforeEach(async () => {
    setupLocalStorageMock();
    vi.resetModules();
  });

  it('t() returns English text for a known key', async () => {
    const { initI18n, t } = await import('./index');
    await initI18n();
    expect(t('gameOver.title')).toBe('GAME OVER');
  });

  it('t() returns the key itself for an unknown key (i18next default)', async () => {
    const { initI18n, t } = await import('./index');
    await initI18n();
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('getCurrentLanguage() returns the current language', async () => {
    const { initI18n, getCurrentLanguage } = await import('./index');
    await initI18n();
    // Default should be 'en' (fallback) when no preference is stored
    expect(getCurrentLanguage()).toMatch(/^en/);
  });

  it('changeLanguage() switches language and t() returns translated text', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('es');
    expect(t('gameOver.title')).toBe('FIN DEL JUEGO');
  });

  it('changeLanguage() back to English returns original text', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('es');
    await changeLanguage('en');
    expect(t('gameOver.title')).toBe('GAME OVER');
  });

  it('changeLanguage() works for French', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('fr');
    expect(t('gameOver.title')).toBe('FIN DE PARTIE');
  });

  it('changeLanguage() works for German', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('de');
    expect(t('gameOver.title')).toBe('SPIEL VORBEI');
  });

  it('changeLanguage() works for Arabic', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('ar');
    expect(t('gameOver.title')).toBe('انتهت اللعبة');
  });

  it('t() with interpolation returns interpolated string', async () => {
    const { initI18n, t } = await import('./index');
    await initI18n();
    // levelComplete.nextStarAt = "Next star at {{score}}"
    expect(t('levelComplete.nextStarAt', { score: 5000 })).toBe('Next star at 5000');
  });

  it('interpolates network life-loss notifications', async () => {
    const { initI18n, t } = await import('./index');
    await initI18n();

    expect(t('network.death.youLostLife')).toBe('You lost a life!');
    expect(t('network.death.playerLostLife', { name: 'Ada' })).toBe('Ada lost a life!');
  });

  it('falls back to English when an unsupported language is set', async () => {
    const { initI18n, t, changeLanguage } = await import('./index');
    await initI18n();

    await changeLanguage('ja'); // not in supportedLngs
    // i18next falls back to 'en' for unsupported languages
    expect(t('gameOver.title')).toBe('GAME OVER');
  });

  it('KEYS constant provides dot-notation strings', async () => {
    const { KEYS } = await import('./index');
    expect(KEYS.gameOver.title).toBe('gameOver.title');
    expect(KEYS.levelComplete.nextStarAt).toBe('levelComplete.nextStarAt');
    expect(KEYS.pauseMenu.title).toBe('pauseMenu.title');
    expect(KEYS.settings.tabs.audio).toBe('settings.tabs.audio');
  });

  it('localStorage persistence: setting gw_language before init picks it up', async () => {
    // Pre-set the language preference before i18next initialises
    mockStore.set('gw_language', 'fr');

    const { initI18n, getCurrentLanguage } = await import('./index');
    await initI18n();

    expect(getCurrentLanguage()).toMatch(/^fr/);
  });
});

describe('locale key parity', () => {
  const locales: Record<string, LocaleObject> = { en, es, fr, de, ru, ar };
  const englishKeys = flattenLocaleKeys(en);

  it.each(Object.entries(locales))('%s has the same keys as en', (localeName, locale) => {
    const localeKeys = flattenLocaleKeys(locale);
    const missing = englishKeys.filter((key) => !localeKeys.includes(key));
    const extra = localeKeys.filter((key) => !englishKeys.includes(key));

    expect({ localeName, missing, extra }).toEqual({
      localeName,
      missing: [],
      extra: [],
    });
  });
});
