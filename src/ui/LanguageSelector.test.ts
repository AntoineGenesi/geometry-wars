/**
 * Unit tests for LanguageSelector.
 *
 * Tests verify: 4 language buttons rendered, click triggers changeLanguage,
 * selected state reflects current language, dispose cleans up listener.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// i18n mock
// ---------------------------------------------------------------------------

let mockCurrentLang = 'en';
const mockChangeLanguageCalls: string[] = [];
const languageChangeHandlers: (() => void)[] = [];

vi.mock('../i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'languages.title': 'LANGUAGE',
      'languages.en': 'English',
      'languages.es': 'Español',
      'languages.fr': 'Français',
      'languages.de': 'Deutsch',
      'languages.ru': 'Русский',
    };
    return map[key] ?? key;
  },
  changeLanguage: (lang: string) => {
    mockCurrentLang = lang;
    mockChangeLanguageCalls.push(lang);
    languageChangeHandlers.forEach((h) => h());
    return Promise.resolve();
  },
  getCurrentLanguage: () => mockCurrentLang,
  onLanguageChange: (handler: () => void) => {
    languageChangeHandlers.push(handler);
    return () => {
      const idx = languageChangeHandlers.indexOf(handler);
      if (idx !== -1) languageChangeHandlers.splice(idx, 1);
    };
  },
}));

// ---------------------------------------------------------------------------
// Minimal DOM mock (same pattern as GameOverScreen.test.ts)
// ---------------------------------------------------------------------------

type EventCb = (e?: Event) => void;

class MockElement {
  tagName: string;
  private _className = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  children: MockElement[] = [];
  style: Record<string, string> = {};
  title = '';
  private listeners: Record<string, EventCb[]> = {};

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get className(): string {
    return this._className;
  }

  set className(value: string) {
    this._className = value;
    // Sync classList with className
    this.classList._classes.clear();
    if (value) {
      value.split(/\s+/).forEach((cls) => {
        if (cls) this.classList._classes.add(cls);
      });
    }
  }

  classList = {
    _classes: new Set<string>(),
    add: (cls: string) => {
      this.classList._classes.add(cls);
      // Sync className with classList
      const parts = Array.from(this.classList._classes);
      this._className = parts.join(' ');
    },
    remove: (cls: string) => {
      this.classList._classes.delete(cls);
      const parts = Array.from(this.classList._classes);
      this._className = parts.join(' ');
    },
    toggle: (cls: string, force?: boolean) => {
      if (force === undefined) {
        if (this.classList._classes.has(cls)) {
          this.classList._classes.delete(cls);
        } else {
          this.classList._classes.add(cls);
        }
      } else if (force) {
        this.classList._classes.add(cls);
      } else {
        this.classList._classes.delete(cls);
      }
      const parts = Array.from(this.classList._classes);
      this._className = parts.join(' ');
    },
    contains: (cls: string) => this.classList._classes.has(cls),
  };

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, cb: EventCb): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  click(): void {
    const cbs = this.listeners['click'] ?? [];
    cbs.forEach((cb) => cb());
  }

  querySelectorAll(selector: string): MockElement[] {
    // Return all descendants matching the given className selector (.lang-btn)
    const cls = selector.startsWith('.') ? selector.slice(1) : null;
    const results: MockElement[] = [];
    const search = (el: MockElement) => {
      if (cls && el.classList._classes.has(cls)) results.push(el);
      el.children.forEach(search);
    };
    this.children.forEach(search);
    return results;
  }
}

const createdElements: MockElement[] = [];

// ---------------------------------------------------------------------------
// Setup DOM mock
// ---------------------------------------------------------------------------

function setupDOMMock() {
  createdElements.length = 0;
  vi.stubGlobal('document', {
    createElement: (tag: string): MockElement => {
      const el = new MockElement(tag);
      createdElements.push(el);
      return el as unknown as HTMLElement;
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LanguageSelector', () => {
  let container: MockElement;

  beforeEach(() => {
    mockCurrentLang = 'en';
    mockChangeLanguageCalls.length = 0;
    languageChangeHandlers.length = 0;
    createdElements.length = 0;

    container = new MockElement('div');

    // Setup DOM mock
    setupDOMMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 5 language buttons', async () => {
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    const buttons = container.querySelectorAll('.lang-btn');
    expect(buttons).toHaveLength(5);
  });

  it('buttons contain only flag emoji', async () => {
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    const buttons = container.querySelectorAll('.lang-btn');
    const texts = buttons.map((b) => b.textContent);
    expect(texts).toContain('🇬🇧');
    expect(texts).toContain('🇪🇸');
    expect(texts).toContain('🇫🇷');
    expect(texts).toContain('🇩🇪');
    expect(texts).toContain('🇷🇺');
  });

  it('selected button matches current language', async () => {
    mockCurrentLang = 'es';
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    const buttons = container.querySelectorAll('.lang-btn');
    const selectedBtn = buttons.find((b) => b.classList.contains('selected'));
    expect(selectedBtn).toBeDefined();
    expect(selectedBtn!.dataset.lang).toBe('es');
  });

  it('clicking a language button calls changeLanguage', async () => {
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    const buttons = container.querySelectorAll('.lang-btn');
    const esBtn = buttons.find((b) => b.dataset.lang === 'es');
    expect(esBtn).toBeDefined();
    esBtn!.click();

    expect(mockChangeLanguageCalls).toContain('es');
  });

  it('language change event updates selected state without full re-render', async () => {
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    // Initially English is selected
    const buttons = container.querySelectorAll('.lang-btn');
    const enBtn = buttons.find((b) => b.dataset.lang === 'en')!;
    const frBtn = buttons.find((b) => b.dataset.lang === 'fr')!;
    expect(enBtn.classList.contains('selected')).toBe(true);
    expect(frBtn.classList.contains('selected')).toBe(false);

    // Simulate language change to French
    mockCurrentLang = 'fr';
    languageChangeHandlers.forEach((h) => h());

    expect(enBtn.classList.contains('selected')).toBe(false);
    expect(frBtn.classList.contains('selected')).toBe(true);
  });

  it('dispose removes the language change listener', async () => {
    const { LanguageSelector } = await import('./LanguageSelector');
    const selector = new LanguageSelector(container as unknown as HTMLElement);
    selector.render();

    const handlerCountAfterRender = languageChangeHandlers.length;
    expect(handlerCountAfterRender).toBeGreaterThan(0);

    selector.dispose();
    expect(languageChangeHandlers.length).toBe(handlerCountAfterRender - 1);
  });
});
