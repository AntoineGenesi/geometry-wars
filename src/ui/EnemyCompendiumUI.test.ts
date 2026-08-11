import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnemyCompendiumScreen } from './EnemyCompendiumScreen';
import { EnemyDiscoveryToast } from './EnemyDiscoveryToast';
import { EnemyDiscoveryStore } from './EnemyDiscoveryStore';
import { createLockedEnemyPreviewElement } from './EnemyModelPreview';

class FakeClassList {
  private classes = new Set<string>();
  constructor(initial = '') {
    initial.split(/\s+/).filter(Boolean).forEach((item) => this.classes.add(item));
  }
  add(cls: string): void { this.classes.add(cls); }
  remove(cls: string): void { this.classes.delete(cls); }
  contains(cls: string): boolean { return this.classes.has(cls); }
  toString(): string { return Array.from(this.classes).join(' '); }
}

class FakeElement {
  id = '';
  className = '';
  textContent = '';
  title = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  classList = new FakeClassList();

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = [];
    this.append(...children);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'id') this.id = value;
    (this as any)[name] = value;
  }

  addEventListener(): void {}
}

function walk(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap((child) => walk(child))];
}

function installFakeDocument() {
  const body = new FakeElement();
  const head = new FakeElement();
  const document = {
    body,
    head,
    createElement: () => new FakeElement(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getElementById: (id: string) => walk(body).concat(walk(head)).find((el) => el.id === id) ?? null,
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { localStorage: null });
  return { body, head, document };
}

describe('Enemy compendium UI', () => {
  beforeEach(() => {
    installFakeDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a locked question-mark preview without rendering enemy frames', () => {
    const preview = createLockedEnemyPreviewElement();
    expect(preview.dataset.enemyPreview).toBe('locked');
    expect(walk(preview as any).some((el) => el.className.includes('ap-enemy-preview-question') && el.textContent === '?')).toBe(true);
  });

  it('renders seen and locked compendium entries with masked locked descriptions', () => {
    const store = new EnemyDiscoveryStore(null);
    store.markSeen('grunt');
    const screen = new EnemyCompendiumScreen(store);
    screen.show();

    const root = (screen as any).container as FakeElement;
    const entries = walk(root).filter((el) => el.dataset.discoveryState);
    expect(entries.length).toBeGreaterThan(30);
    expect(entries.find((el) => el.dataset.enemyType === 'grunt')?.dataset.discoveryState).toBe('seen');
    expect(entries.find((el) => el.dataset.enemyType === 'rocket')?.dataset.discoveryState).toBe('locked');
    expect(walk(root).some((el) => el.textContent.includes('Charges directly at the player'))).toBe(true);
    expect(walk(root).some((el) => el.textContent.includes('Unknown Enemy'))).toBe(true);
    expect(walk(root).some((el) => /[#?]{5}/.test(el.textContent))).toBe(true);
    screen.dispose();
  });

  it('dedupes active, queued, and already-shown first-sighting toasts', () => {
    vi.useFakeTimers();
    const toast = new EnemyDiscoveryToast();
    expect(toast.enqueue('grunt')).toBe(true);
    expect(toast.enqueue('grunt')).toBe(false);
    expect(toast.enqueue('rocket')).toBe(true);
    expect(toast.getQueueLengthForTests()).toBe(2);

    vi.advanceTimersByTime(3600);
    expect(toast.enqueue('grunt')).toBe(false);
    expect(toast.getQueueLengthForTests()).toBe(1);
    toast.dispose();
  });

  it('keeps enemy discovery toasts compact in the left corner on mobile', () => {
    const { head } = installFakeDocument();
    new EnemyDiscoveryToast();
    const style = walk(head).find((el) => el.id === 'enemy-discovery-toast-styles');
    const css = style?.textContent ?? '';

    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('top: max(10px, env(safe-area-inset-top))');
    expect(css).toContain('left: max(10px, env(safe-area-inset-left))');
    expect(css).toContain('width: min(230px, calc(100vw - 20px))');
    expect(css).toContain('font-size: 12px');
  });

  it('keeps Enemy Types entry points in StartMenu and PauseMenu markup', () => {
    const root = process.cwd();
    const startMenu = fs.readFileSync(path.join(root, 'src/ui/StartMenu.ts'), 'utf8');
    const pauseMenu = fs.readFileSync(path.join(root, 'src/ui/PauseMenu.ts'), 'utf8');
    expect(startMenu).toContain('id="enemy-types-btn"');
    expect(startMenu).toContain('new EnemyCompendiumScreen()');
    expect(pauseMenu).toContain('data-action="enemy-types"');
    expect(pauseMenu).toContain('new EnemyCompendiumScreen()');
  });
});
