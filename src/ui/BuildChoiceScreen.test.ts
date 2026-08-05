import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeaponType } from '../weapons/WeaponTypes';

type EventCallback = (e?: Event) => void;

class MockClassList {
  private classes = new Set<string>();

  add(cls: string): void {
    for (const name of cls.split(' ')) if (name) this.classes.add(name);
  }

  remove(cls: string): void {
    this.classes.delete(cls);
  }

  contains(cls: string): boolean {
    return this.classes.has(cls);
  }

  toggle(cls: string, force?: boolean): void {
    if (force === true) this.classes.add(cls);
    else if (force === false) this.classes.delete(cls);
    else if (this.classes.has(cls)) this.classes.delete(cls);
    else this.classes.add(cls);
  }
}

class MockElement {
  id = '';
  className = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  classList = new MockClassList();
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  private listeners = new Map<string, EventCallback[]>();

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    this.innerHTML += child.innerHTML;
    return child;
  }

  append(...children: MockElement[]): void {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(event: string, cb: EventCallback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  removeEventListener(event: string, cb: EventCallback): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(event, listeners.filter(listener => listener !== cb));
  }

  dispatch(event: string, payload?: Event): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

describe('BuildChoiceScreen conflict filtering', () => {
  let BuildChoiceScreen: typeof import('./BuildChoiceScreen').BuildChoiceScreen;
  let body: MockElement;
  let head: MockElement;
  let documentListeners: Map<string, EventCallback[]>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    body = new MockElement();
    head = new MockElement();
    documentListeners = new Map();

    vi.stubGlobal('document', {
      createElement: () => new MockElement(),
      body,
      head,
      getElementById: () => null,
      addEventListener: (event: string, cb: EventCallback) => {
        if (!documentListeners.has(event)) documentListeners.set(event, []);
        documentListeners.get(event)!.push(cb);
      },
      removeEventListener: (event: string, cb: EventCallback) => {
        const listeners = documentListeners.get(event) ?? [];
        documentListeners.set(event, listeners.filter(listener => listener !== cb));
      },
    });

    BuildChoiceScreen = (await import('./BuildChoiceScreen')).BuildChoiceScreen;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not auto-confirm when the only available Black Hole choice is excluded', () => {
    const screen = new BuildChoiceScreen();
    const onConfirm = vi.fn();

    screen.show(
      WeaponType.BlackHole,
      ['black_hole_ar_4'],
      new Set(['black_hole_al_4']),
      80,
      onConfirm,
    );
    vi.advanceTimersByTime(1500);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(body.children[0].innerHTML).toContain('conflicts with');
    screen.dispose();
  });

  it('auto-confirms a formerly conflicting Standard choice because Standard has no arbitrary exclusions', () => {
    const screen = new BuildChoiceScreen();
    const onConfirm = vi.fn();

    screen.show(
      WeaponType.Standard,
      ['standard_ar_5'],
      new Set(['standard_al_5']),
      120,
      onConfirm,
    );
    vi.advanceTimersByTime(1500);

    expect(onConfirm).toHaveBeenCalledWith('standard_ar_5');
    screen.dispose();
  });
});
