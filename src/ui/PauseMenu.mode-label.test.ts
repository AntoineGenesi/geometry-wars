import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PauseMenu,
  getMultiplayerPauseModeLabel,
  type PauseMenuGameData,
  type MultiplayerPauseModeState,
} from './PauseMenu';

vi.mock('../i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => vars?.name ?? key,
  onLanguageChange: () => () => undefined,
}));

vi.mock('./LanguageSelector', () => ({
  LanguageSelector: class {
    render(): void {}
    dispose(): void {}
  },
}));

type Listener = (event?: Event) => void;

class MockClassList {
  private readonly classes = new Set<string>();

  add(...classes: string[]): void {
    for (const cls of classes.flatMap(c => c.split(/\s+/))) if (cls) this.classes.add(cls);
  }

  remove(...classes: string[]): void {
    for (const cls of classes.flatMap(c => c.split(/\s+/))) this.classes.delete(cls);
  }

  contains(cls: string): boolean {
    return this.classes.has(cls);
  }

  toggle(cls: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.classes.has(cls);
    if (shouldAdd) this.classes.add(cls);
    else this.classes.delete(cls);
    return shouldAdd;
  }
}

class MockElement {
  id = '';
  className = '';
  textContent = '';
  title = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> & { cssText: string } = { cssText: '' };
  classList = new MockClassList();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  private html = '';
  private readonly listeners = new Map<string, Listener[]>();

  constructor(private readonly registry: MockElement[]) {}

  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
    const tagPattern = /<([a-z0-9-]+)([^>]*)>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(value)) !== null) {
      const child = new MockElement(this.registry);
      const attrs = match[2];
      child.id = attrs.match(/\sid="([^"]+)"/)?.[1] ?? '';
      child.className = attrs.match(/\sclass="([^"]+)"/)?.[1] ?? '';
      child.classList.add(child.className);
      const action = attrs.match(/\sdata-action="([^"]+)"/)?.[1];
      if (action) child.dataset.action = action;
      const style = attrs.match(/\sstyle="([^"]+)"/)?.[1] ?? '';
      if (style.includes('display:none')) child.style.display = 'none';
      this.appendChild(child);
    }
  }

  get innerHTML(): string {
    return this.html;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    this.registry.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  removeEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(event, listeners.filter(current => current !== listener));
  }

  querySelector(selector: string): MockElement | null {
    return findElement(this.flatten(), selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.flatten().filter(el => matchesSelector(el, selector));
  }

  private flatten(): MockElement[] {
    const elements: MockElement[] = [];
    const visit = (el: MockElement) => {
      for (const child of el.children) {
        elements.push(child);
        visit(child);
      }
    };
    visit(this);
    return elements;
  }
}

function matchesSelector(el: MockElement, selector: string): boolean {
  if (selector.startsWith('.')) return el.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  const dataAction = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];
  if (dataAction) return el.dataset.action === dataAction;
  return false;
}

function findElement(elements: MockElement[], selector: string): MockElement | null {
  return elements.find(el => matchesSelector(el, selector)) ?? null;
}

function installDomMock(): void {
  const registry: MockElement[] = [];
  const body = new MockElement(registry);
  const head = new MockElement(registry);
  const documentMock = {
    body,
    head,
    createElement: () => new MockElement(registry),
    querySelector: (selector: string) => findElement([body, head, ...registry], selector),
    querySelectorAll: (selector: string) => [body, head, ...registry].filter(el => matchesSelector(el, selector)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', documentMock);
}

function baseGameData(overrides: Partial<PauseMenuGameData> = {}): PauseMenuGameData {
  return {
    buffs: [],
    currentScore: 0,
    totalKills: 0,
    currentMode: '〰️ WAVES',
    weapon: {
      name: 'Standard',
      baseDamage: 1,
      fireRate: 6,
    },
    ...overrides,
  };
}

function sectionDisplay(selector: string): string {
  return (document.querySelector(selector) as unknown as MockElement | null)?.style.display ?? '';
}

describe('PauseMenu multiplayer mode labels', () => {
  beforeEach(() => {
    installDomMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [{ gameMode: 'waves', pvpMode: '', pvpEnabled: false }, 'Co-op'],
    [{ gameMode: 'waves', pvpMode: 'pvp', pvpEnabled: true }, 'PvP'],
    [{ gameMode: 'waves', pvpMode: 'pvpve', pvpEnabled: true }, 'PvPvE'],
    [{ gameMode: 'pvp', pvpMode: '', pvpEnabled: true }, 'PvP'],
    [{ gameMode: 'pvpve', pvpMode: '', pvpEnabled: true }, 'PvPvE'],
  ] satisfies Array<[MultiplayerPauseModeState, string]>)(
    'renders MP identity %s as a separate multiplayer row',
    (state, expectedLabel) => {
      const pauseMenu = new PauseMenu();
      pauseMenu.setGameData(baseGameData({
        currentMode: '〰️ WAVES',
        multiplayerMode: getMultiplayerPauseModeLabel(state),
      }));

      expect(document.querySelector('.stats-multiplayer-mode-name')?.textContent).toBe(expectedLabel);
      expect(sectionDisplay('.stats-multiplayer-mode-section')).toBe('');
      expect(document.querySelector('.stats-mode-name')?.textContent).toBe('〰️ WAVES');
      expect(sectionDisplay('.stats-mode-section')).toBe('');

      pauseMenu.dispose();
    },
  );

  it('keeps SP game mode useful without adding a multiplayer label', () => {
    const pauseMenu = new PauseMenu();
    pauseMenu.setGameData(baseGameData({
      currentMode: '👑 KING',
      multiplayerMode: undefined,
    }));

    expect(document.querySelector('.stats-mode-name')?.textContent).toBe('👑 KING');
    expect(sectionDisplay('.stats-mode-section')).toBe('');
    expect(document.querySelector('.stats-multiplayer-mode-name')?.textContent).toBe('');
    expect(sectionDisplay('.stats-multiplayer-mode-section')).toBe('none');

    pauseMenu.dispose();
  });
});
