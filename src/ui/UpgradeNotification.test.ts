import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeaponType } from '../weapons/WeaponTypes';

class MockElement {
  id = '';
  textContent = '';
  innerHTML = '';
  style: Record<string, string> = {};
  parentElement: MockElement | null = null;
  children: MockElement[] = [];

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
}

describe('UpgradeNotification', () => {
  let UpgradeNotification: typeof import('./UpgradeNotification').UpgradeNotification;
  let body: MockElement;
  let head: MockElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    body = new MockElement();
    head = new MockElement();

    vi.stubGlobal('document', {
      createElement: () => new MockElement(),
      getElementById: (id: string) => [...head.children, ...body.children].find((el) => el.id === id) ?? null,
      head,
      body,
    });
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    UpgradeNotification = (await import('./UpgradeNotification')).UpgradeNotification;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses bottom-screen nonblocking placement for auto-applied upgrade notices', () => {
    const notification = new UpgradeNotification();

    notification.show('standard_a_1', WeaponType.Standard);
    const container = body.children.find(child => child.id === 'upgrade-notification');

    expect(container?.style.cssText).toContain('bottom: 11%');
    expect(container?.style.cssText).not.toContain('top: 12%');
    expect(container?.innerHTML).toContain('Dual bolts');
    notification.dispose();
  });

  it('uses a compact top-left placement for mobile upgrade notices', () => {
    const notification = new UpgradeNotification();
    const style = head.children.find(child => child.id === 'upgrade-notification-style');
    const css = style?.textContent ?? '';

    expect(css).toContain('@media (pointer: coarse), (max-width: 640px)');
    expect(css).toContain('top: max(10px, env(safe-area-inset-top)) !important');
    expect(css).toContain('left: max(10px, env(safe-area-inset-left)) !important');
    expect(css).toContain('font-size: 10px');
    expect(css).toContain('font-size: 9px');
    notification.dispose();
  });
});
