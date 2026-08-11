import { vi } from 'vitest';

type Listener = (event?: Event) => void;

class MockClassList {
  private readonly classes = new Set<string>();

  add(...classes: string[]): void {
    for (const cls of classes) if (cls) this.classes.add(cls);
  }

  remove(...classes: string[]): void {
    for (const cls of classes) this.classes.delete(cls);
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
  style: Record<string, string> & { cssText: string } = { cssText: '' };
  classList = new MockClassList();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  private html = '';
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    private readonly registry: Map<string, MockElement>,
    private readonly tagName: string,
  ) {}

  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
    const tagPattern = /<([a-z0-9-]+)([^>]*)>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(value)) !== null) {
      const child = new MockElement(this.registry, match[1]);
      const attrs = match[2];
      const id = attrs.match(/\sid="([^"]+)"/)?.[1];
      const className = attrs.match(/\sclass="([^"]+)"/)?.[1];
      if (id) {
        child.id = id;
        this.registry.set(id, child);
      }
      if (className) {
        child.className = className;
        child.classList.add(...className.split(/\s+/));
      }
      this.appendChild(child);
    }
  }

  get innerHTML(): string {
    return this.html;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) this.registry.set(child.id, child);
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
    if (selector.startsWith('#')) return this.registry.get(selector.slice(1)) ?? null;
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this.find(child => child.className.split(/\s+/).includes(cls));
    }
    return this.find(child => child.tagName.toLowerCase() === selector.toLowerCase());
  }

  private find(predicate: (el: MockElement) => boolean): MockElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

export interface OverlayTestDom {
  body: MockElement;
  head: MockElement;
  styles(): string[];
}

export function installOverlayTestDom(): OverlayTestDom {
  const registry = new Map<string, MockElement>();
  const body = new MockElement(registry, 'body');
  const head = new MockElement(registry, 'head');
  const listeners = new Map<string, Listener[]>();

  vi.stubGlobal('document', {
    body,
    head,
    createElement: (tagName: string) => new MockElement(registry, tagName),
    getElementById: (id: string) => registry.get(id) ?? null,
    addEventListener: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
    },
    removeEventListener: (event: string, listener: Listener) => {
      const current = listeners.get(event) ?? [];
      listeners.set(event, current.filter(existing => existing !== listener));
    },
  });

  return {
    body,
    head,
    styles: () => head.children.map(child => child.textContent),
  };
}
