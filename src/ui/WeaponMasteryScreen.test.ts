/**
 * WeaponMasteryScreen unit tests.
 *
 * Uses a localStorage mock to seed mastery data, then verifies the
 * rendered DOM against expected values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WeaponMasteryScreen } from './WeaponMasteryScreen';
import { WeaponType } from '../weapons/WeaponTypes';

vi.mock('../i18n', () => ({
  t: (key: string, opts?: Record<string, unknown>) => {
    if (key === 'mastery.levelBadge' && opts?.level !== undefined) return `Lv.${opts.level}`;
    return key;
  },
}));

// ── localStorage stub ─────────────────────────────────────────────────────────

let _store: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => _store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { _store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete _store[key]; }),
  clear: vi.fn(() => { _store = {}; }),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedMastery(xpMap: Partial<Record<WeaponType, number>>): void {
  const weapons: Record<string, { xp: number; gamesPlayed: number }> = {};
  for (const [type, xp] of Object.entries(xpMap)) {
    weapons[type] = { xp: xp as number, gamesPlayed: 1 };
  }
  _store['gw_weapon_mastery'] = JSON.stringify({ version: 1, weapons });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WeaponMasteryScreen', () => {
  let screen: WeaponMasteryScreen;

  beforeEach(() => {
    _store = {};
    document.body.innerHTML = '';
    screen = new WeaponMasteryScreen();
  });

  afterEach(() => {
    screen.dispose();
  });

  it('show() renders without throwing', () => {
    expect(() => screen.show()).not.toThrow();
  });

  it('renders a card for each of the 10 weapons', () => {
    screen.show();
    const cards = document.querySelectorAll('.wms-card');
    expect(cards.length).toBe(10);
  });

  it('hides initially (has .hidden class)', () => {
    const el = document.getElementById('weapon-mastery-screen');
    expect(el?.classList.contains('hidden')).toBe(true);
  });

  it('removes .hidden on show()', () => {
    screen.show();
    const el = document.getElementById('weapon-mastery-screen');
    expect(el?.classList.contains('hidden')).toBe(false);
  });

  it('level badge reflects stored mastery data', () => {
    // Seed Standard weapon at 100 XP → level 1
    seedMastery({ [WeaponType.Standard]: 100 });
    screen.show();

    // Find the card for Blaster (Standard)
    const blasterCard = Array.from(document.querySelectorAll<HTMLElement>('.wms-card'))
      .find(c => c.dataset.weaponType === WeaponType.Standard);
    expect(blasterCard).toBeTruthy();

    const badge = blasterCard?.querySelector('.wms-level-badge');
    expect(badge?.textContent).toContain('Lv.1');
  });

  it('level badge shows Lv.0 for weapons with no XP', () => {
    screen.show();
    const card = document.querySelector<HTMLElement>(`.wms-card[data-weapon-type="${WeaponType.Spread}"]`);
    expect(card?.querySelector('.wms-level-badge')?.textContent).toContain('Lv.0');
  });

  it('XP bar width is set via data-target-width attribute', () => {
    // 200 XP → level 1, between 100 and 300, so 50% progress
    seedMastery({ [WeaponType.Standard]: 200 });
    screen.show();

    const card = document.querySelector<HTMLElement>(`.wms-card[data-weapon-type="${WeaponType.Standard}"]`);
    const fill = card?.querySelector<HTMLElement>('.wms-xp-fill');
    expect(fill).toBeTruthy();
    const targetWidth = parseFloat(fill?.dataset.targetWidth ?? '0');
    // 200 XP at level 1 (thresh 100..300): (200-100)/(300-100) = 50%
    expect(targetWidth).toBeCloseTo(50, 0);
  });

  it('max level card shows 100% XP bar', () => {
    seedMastery({ [WeaponType.BlackHole]: 1000 });
    screen.show();

    const card = document.querySelector<HTMLElement>(`.wms-card[data-weapon-type="${WeaponType.BlackHole}"]`);
    const fill = card?.querySelector<HTMLElement>('.wms-xp-fill');
    const targetWidth = parseFloat(fill?.dataset.targetWidth ?? '0');
    expect(targetWidth).toBe(100);
  });

  it('milestone nodes show correct unlocked vs locked state', () => {
    // Level 2 = levels 0,1,2 unlocked; 3,4,5 locked
    seedMastery({ [WeaponType.ChainLightning]: 300 }); // exactly level 2
    screen.show();

    // Expand the card to render milestones
    const card = document.querySelector<HTMLElement>(`.wms-card[data-weapon-type="${WeaponType.ChainLightning}"]`);
    card?.click();

    const nodes = card?.querySelectorAll('.wms-ms-node') ?? [];
    expect(nodes.length).toBe(6); // levels 0..5

    // First 3 should be unlocked or current, rest should be locked
    const unlockedCount = Array.from(nodes).filter(n =>
      n.classList.contains('unlocked') || n.classList.contains('current') || n.classList.contains('gold')
    ).length;
    expect(unlockedCount).toBe(3); // 0, 1, 2
  });

  it('Lv5 node gets the gold class', () => {
    seedMastery({ [WeaponType.Standard]: 1000 }); // max level
    screen.show();
    const card = document.querySelector<HTMLElement>(`.wms-card[data-weapon-type="${WeaponType.Standard}"]`);
    card?.click(); // expand

    const nodes = card?.querySelectorAll('.wms-ms-node');
    const lastNode = nodes?.[nodes.length - 1];
    expect(lastNode?.classList.contains('gold')).toBe(true);
  });

  it('clicking a card toggles the expanded class', () => {
    screen.show();
    const card = document.querySelector<HTMLElement>('.wms-card');
    expect(card?.classList.contains('expanded')).toBe(false);
    card?.click();
    expect(card?.classList.contains('expanded')).toBe(true);
    card?.click();
    expect(card?.classList.contains('expanded')).toBe(false);
  });

  it('hide() adds .hidden class', () => {
    screen.show();
    screen.hide();
    const el = document.getElementById('weapon-mastery-screen');
    expect(el?.classList.contains('hidden')).toBe(true);
  });

  it('dispose() removes the element from the DOM', () => {
    screen.show();
    screen.dispose();
    expect(document.getElementById('weapon-mastery-screen')).toBeNull();
  });

  it('onClose() callback fires when hide() is called', () => {
    const cb = vi.fn();
    screen.onClose(cb);
    screen.show();
    screen.hide();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('onClose() callback does NOT fire before hide()', () => {
    const cb = vi.fn();
    screen.onClose(cb);
    screen.show();
    expect(cb).not.toHaveBeenCalled();
  });

  it('close button triggers hide + onClose callback', () => {
    const cb = vi.fn();
    screen.onClose(cb);
    screen.show();

    const closeBtn = document.querySelector<HTMLButtonElement>('.wms-close');
    closeBtn?.click();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('weapon card has correct --wc CSS variable', () => {
    screen.show();
    // Just verify at least one card has the property set
    const card = document.querySelector<HTMLElement>('.wms-card');
    const style = card?.getAttribute('style') ?? '';
    expect(style).toContain('--wc:');
  });
});
