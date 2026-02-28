import { t, changeLanguage, getCurrentLanguage, onLanguageChange } from '../i18n';

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧' },
  { code: 'es', flag: '🇪🇸' },
  { code: 'fr', flag: '🇫🇷' },
  { code: 'de', flag: '🇩🇪' },
  { code: 'ru', flag: '🇷🇺' },
] as const;

type LanguageCode = (typeof LANGUAGES)[number]['code'];

/**
 * Reusable language picker component.
 * Renders flag + language name buttons into a container element.
 * Clicking a button calls changeLanguage() and updates selected state reactively.
 */
export class LanguageSelector {
  private container: HTMLElement;
  private _unsub: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(): void {
    this.container.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'lang-selector-section';

    const title = document.createElement('div');
    title.className = 'lang-selector-title';
    title.textContent = t('languages.title');
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'lang-selector-grid';

    // Normalize 'en-US' style codes to bare 'en'
    const currentLang = getCurrentLanguage().split('-')[0] as LanguageCode;

    for (const { code, flag } of LANGUAGES) {
      const btn = document.createElement('button');
      btn.className = 'lang-btn';
      if (code === currentLang) btn.classList.add('selected');
      btn.dataset.lang = code;
      btn.textContent = flag;
      btn.title = t(`languages.${code}`); // Tooltip shows language name on hover
      btn.addEventListener('click', () => {
        changeLanguage(code);
      });
      grid.appendChild(btn);
    }

    section.appendChild(grid);
    this.container.appendChild(section);

    // Update selected state when language changes (without full re-render)
    this._unsub = onLanguageChange(() => {
      const newLang = getCurrentLanguage().split('-')[0];
      this.container.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
        btn.classList.toggle('selected', btn.dataset.lang === newLang);
      });
    });
  }

  dispose(): void {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }
}
