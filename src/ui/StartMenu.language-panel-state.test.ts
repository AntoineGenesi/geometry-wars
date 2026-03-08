/**
 * Regression test: Language selector flag click must NOT exit the current sub-panel.
 *
 * Bug (s44r3-01): StartMenu.onLanguageChange re-renders the entire HTML
 * (this.container.innerHTML = this.createMenuHTML()), resetting all sub-panel
 * visibility to defaults (main-buttons visible, surface-section/lan-section hidden).
 * If the user had navigated to the Quick Game or LAN panel, they'd be returned
 * to the main menu after clicking a language flag.
 *
 * Fix: capture hidden-class state of all panel IDs before re-render, restore after.
 *
 * This test validates the captureHiddenState / restoreHiddenState utilities that
 * StartMenu uses in its onLanguageChange handler.
 */

import { describe, it, expect } from 'vitest';
import { captureHiddenState, restoreHiddenState } from './panelState';

// ---------------------------------------------------------------------------
// Minimal DOM mock (no jsdom dependency)
// ---------------------------------------------------------------------------

function makeElement(id: string, isHidden: boolean) {
  const classSet = new Set<string>(isHidden ? ['hidden'] : []);
  return {
    id,
    classList: {
      contains: (cls: string) => classSet.has(cls),
      add: (cls: string) => { classSet.add(cls); },
      remove: (cls: string) => { classSet.delete(cls); },
    },
  };
}

type MockEl = ReturnType<typeof makeElement>;

function makeContainer(elements: MockEl[]) {
  return {
    querySelector(sel: string) {
      const match = /^#(.+)$/.exec(sel);
      if (!match) return null;
      return elements.find((e) => e.id === match[1]) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartMenu language change — panel visibility preservation', () => {
  const PANEL_IDS = [
    'main-buttons',
    'adventure-levels',
    'lan-section',
    'surface-section',
    'lan-name-dialog',
    'lan-host-surface-pick',
    'lan-host-info',
    'lan-enter-btn',
    'lan-stop-btn',
    'lan-name-error',
    'lan-troubleshoot-backdrop',
    'custom-mesh-loading',
  ];

  it('captureHiddenState records which panels are hidden', () => {
    const els = [
      makeElement('main-buttons', true),    // hidden (user is in sub-panel)
      makeElement('surface-section', false), // visible (user opened Quick Game)
      makeElement('lan-section', true),      // hidden
    ];
    const root = makeContainer(els);
    const state = captureHiddenState(root, ['main-buttons', 'surface-section', 'lan-section']);

    expect(state.get('main-buttons')).toBe(true);
    expect(state.get('surface-section')).toBe(false);
    expect(state.get('lan-section')).toBe(true);
  });

  it('restoreHiddenState re-applies hidden/visible state correctly', () => {
    const els = [
      makeElement('main-buttons', false),    // after re-render: visible (bug — was hidden)
      makeElement('surface-section', true),  // after re-render: hidden (bug — was visible)
    ];
    const root = makeContainer(els);

    // Saved state from BEFORE re-render
    const savedState = new Map([
      ['main-buttons', true],    // was hidden
      ['surface-section', false], // was visible
    ]);

    restoreHiddenState(root, savedState);

    expect(els[0].classList.contains('hidden')).toBe(true);  // restored to hidden ✓
    expect(els[1].classList.contains('hidden')).toBe(false); // restored to visible ✓
  });

  it('round-trip: capture→re-render→restore preserves user navigation state', () => {
    // User clicked "Quick Game" → main-buttons hidden, surface-section visible
    const beforeEls = [
      makeElement('main-buttons', true),     // hidden — user navigated away
      makeElement('surface-section', false), // visible — quick game panel open
      makeElement('lan-section', true),
      makeElement('adventure-levels', true),
    ];
    const beforeRoot = makeContainer(beforeEls);

    // Step 1: capture state before re-render
    const savedState = captureHiddenState(
      beforeRoot,
      ['main-buttons', 'surface-section', 'lan-section', 'adventure-levels'],
    );

    // Step 2: re-render — all elements reset to default (main-buttons visible, rest hidden)
    const afterEls = [
      makeElement('main-buttons', false),    // default: visible (THE BUG without fix)
      makeElement('surface-section', true),  // default: hidden
      makeElement('lan-section', true),
      makeElement('adventure-levels', true),
    ];
    const afterRoot = makeContainer(afterEls);

    // Without the fix: user sees main menu (main-buttons visible = bad)
    expect(afterEls[0].classList.contains('hidden')).toBe(false);

    // Step 3: restore saved state
    restoreHiddenState(afterRoot, savedState);

    // With the fix: surface-section still visible, main-buttons still hidden
    expect(afterEls[0].classList.contains('hidden')).toBe(true);  // main-buttons hidden ✓
    expect(afterEls[1].classList.contains('hidden')).toBe(false); // surface-section visible ✓
    expect(afterEls[2].classList.contains('hidden')).toBe(true);  // lan-section hidden ✓
  });

  it('defaults missing elements to hidden (safe sentinel for newly added panels)', () => {
    const root = makeContainer([]); // empty — element not found
    const state = captureHiddenState(root, PANEL_IDS);

    for (const id of PANEL_IDS) {
      expect(state.get(id)).toBe(true);
    }
  });

  it('restoreHiddenState is a no-op for elements missing after re-render', () => {
    const root = makeContainer([]);
    const state = new Map([['main-buttons', false]]);
    expect(() => restoreHiddenState(root, state)).not.toThrow();
  });
});
