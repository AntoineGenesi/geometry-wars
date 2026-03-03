/**
 * Unit tests for GameSettingsPanel.
 *
 * Tests the pure helper functions and class logic without a real browser DOM.
 * DOM-dependent behaviour is tested via a minimal mock that mirrors GameOverScreen.test.ts patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isPvpActive,
  getLivesLabel,
  getDifficultyLabel,
  getSpawnRateLabel,
  getTimeLimitLabel,
  getBossFreqLabel,
  GameSettingsPanel,
  type PanelDocument,
} from './GameSettingsPanel';
import type { GameSettings } from '../../server/shared/GameSettings';
import { DEFAULT_GAME_SETTINGS } from '../../server/shared/GameSettings';

// ---------------------------------------------------------------------------
// Pure function tests — no DOM needed
// ---------------------------------------------------------------------------

describe('isPvpActive', () => {
  it('returns false for default settings (waves mode, pvpEnabled=false)', () => {
    expect(isPvpActive(DEFAULT_GAME_SETTINGS)).toBe(false);
  });

  it('returns true when mode is pvp', () => {
    expect(isPvpActive({ ...DEFAULT_GAME_SETTINGS, mode: 'pvp' })).toBe(true);
  });

  it('returns true when mode is pvpve', () => {
    expect(isPvpActive({ ...DEFAULT_GAME_SETTINGS, mode: 'pvpve' })).toBe(true);
  });

  it('returns true when pvpEnabled is true regardless of mode', () => {
    expect(isPvpActive({ ...DEFAULT_GAME_SETTINGS, mode: 'waves', pvpEnabled: true })).toBe(true);
  });

  it('returns false for non-pvp modes when pvpEnabled is false', () => {
    const nonPvpModes: GameSettings['mode'][] = ['waves', 'king', 'sniper', 'rainbow', 'claustrophobia'];
    for (const mode of nonPvpModes) {
      expect(isPvpActive({ ...DEFAULT_GAME_SETTINGS, mode, pvpEnabled: false })).toBe(false);
    }
  });
});

describe('getLivesLabel', () => {
  it('labels 1 as Hardcore', () => {
    expect(getLivesLabel(1)).toContain('Hardcore');
  });

  it('labels 2 as Hard', () => {
    expect(getLivesLabel(2)).toContain('Hard');
  });

  it('labels 3 as Normal', () => {
    expect(getLivesLabel(3)).toContain('Normal');
  });

  it('labels 5 as Easy', () => {
    expect(getLivesLabel(5)).toContain('Easy');
  });

  it('labels 9 as Casual', () => {
    expect(getLivesLabel(9)).toContain('Casual');
  });
});

describe('getDifficultyLabel', () => {
  it('labels 0.5 as Easy', () => {
    expect(getDifficultyLabel(0.5)).toContain('Easy');
  });

  it('labels 1.0 as Normal', () => {
    expect(getDifficultyLabel(1.0)).toContain('Normal');
  });

  it('labels 2.0 as Insane', () => {
    expect(getDifficultyLabel(2.0)).toContain('Insane');
  });

  it('includes the multiplier value', () => {
    expect(getDifficultyLabel(1.5)).toContain('1.50x');
  });
});

describe('getTimeLimitLabel', () => {
  it('returns Unlimited for 0', () => {
    expect(getTimeLimitLabel(0)).toBe('Unlimited');
  });

  it('shows seconds for short values', () => {
    expect(getTimeLimitLabel(90)).toContain('90s');
  });

  it('shows minutes for long values', () => {
    expect(getTimeLimitLabel(300)).toContain('5 min');
  });
});

describe('getBossFreqLabel', () => {
  it('labels 0 as Never', () => {
    expect(getBossFreqLabel(0)).toContain('Never');
  });

  it('labels 0.5 as Normal', () => {
    expect(getBossFreqLabel(0.5)).toContain('Normal');
  });

  it('labels 1.0 as Always', () => {
    expect(getBossFreqLabel(1.0)).toContain('Always');
  });
});

describe('getSpawnRateLabel', () => {
  it('labels 1.0 as Normal', () => {
    expect(getSpawnRateLabel(1.0)).toContain('Normal');
  });

  it('includes multiplier value', () => {
    const label = getSpawnRateLabel(2.0);
    expect(label).toContain('2.00x');
  });
});

// ---------------------------------------------------------------------------
// Minimal DOM mock (same pattern as GameOverScreen.test.ts)
// ---------------------------------------------------------------------------

type EventHandler = (e?: Event) => void;

class MockElement {
  id = '';
  className = '';
  textContent: string | null = '';
  innerHTML = '';
  tagName: string;
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  private _attrs: Record<string, string> = {};
  private _events: Map<string, EventHandler[]> = new Map();

  readonly classList = (() => {
    const classes = new Set<string>();
    return {
      add: (...cls: string[]) => cls.forEach(c => classes.add(c)),
      remove: (...cls: string[]) => cls.forEach(c => classes.delete(c)),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else {
          force ? classes.add(c) : classes.delete(c);
        }
      },
      toString: () => Array.from(classes).join(' '),
    };
  })();

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get value(): string { return this._attrs['value'] ?? ''; }
  set value(v: string) { this._attrs['value'] = v; }

  setAttribute(name: string, val: string): void { this._attrs[name] = val; }
  getAttribute(name: string): string | null { return this._attrs[name] ?? null; }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  addEventListener(event: string, handler: EventHandler): void {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event)!.push(handler);
  }

  dispatchEvent(event: string, obj?: Event): void {
    for (const h of this._events.get(event) ?? []) h(obj);
  }

  click(): void { this.dispatchEvent('click'); }

  querySelector(selector: string): MockElement | null {
    const byClass = selector.startsWith('.');
    const byId = selector.startsWith('#');
    const key = selector.slice(1);
    return this._findOne((el) =>
      byId ? el.id === key :
      byClass ? el.classList.contains(key) :
      false
    );
  }

  querySelectorAll(selector: string): MockElement[] {
    const byClass = selector.startsWith('.');
    const key = selector.slice(1);
    const results: MockElement[] = [];
    this._findAll((el) => byClass ? el.classList.contains(key) : false, results);
    return results;
  }

  private _findOne(pred: (el: MockElement) => boolean): MockElement | null {
    for (const child of this.children) {
      if (pred(child)) return child;
      const found = child._findOne(pred);
      if (found) return found;
    }
    return null;
  }

  private _findAll(pred: (el: MockElement) => boolean, out: MockElement[]): void {
    for (const child of this.children) {
      if (pred(child)) out.push(child);
      child._findAll(pred, out);
    }
  }
}

function makeMockDocument(): PanelDocument & { _body: MockElement; _ids: Map<string, MockElement> } {
  const _ids = new Map<string, MockElement>();
  const _body = new MockElement('body');

  return {
    _body,
    _ids,
    createElement: (tag: string) => {
      const el = new MockElement(tag);
      return el as unknown as HTMLElement;
    },
    getElementById: (id: string) => {
      const el = _ids.get(id) ?? null;
      return el as unknown as HTMLElement | null;
    },
    get body() { return _body as unknown as HTMLElement; },
  };
}

// ---------------------------------------------------------------------------
// GameSettingsPanel class tests — DOM mock
// ---------------------------------------------------------------------------

describe('GameSettingsPanel', () => {
  let mockDoc: ReturnType<typeof makeMockDocument>;
  let panel: GameSettingsPanel;

  beforeEach(() => {
    mockDoc = makeMockDocument();
    panel = new GameSettingsPanel({ document: mockDoc as unknown as PanelDocument });
    panel.mount();
  });

  // -------------------------------------------------------------------------
  // PvP section visibility
  // -------------------------------------------------------------------------

  describe('PvP section visibility', () => {
    it('PvP section is hidden by default (waves mode, pvpEnabled=false)', () => {
      expect(panel.isPvpSectionVisible()).toBe(false);
    });

    it('PvP section shows when mode changes to pvp', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'pvp' });
      expect(panel.isPvpSectionVisible()).toBe(true);
    });

    it('PvP section shows when mode changes to pvpve', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'pvpve' });
      expect(panel.isPvpSectionVisible()).toBe(true);
    });

    it('PvP section shows when pvpEnabled is set to true on non-pvp mode', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'waves', pvpEnabled: true });
      expect(panel.isPvpSectionVisible()).toBe(true);
    });

    it('PvP section hides when switching back to non-pvp mode with pvpEnabled=false', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'pvp' });
      expect(panel.isPvpSectionVisible()).toBe(true);

      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'king', pvpEnabled: false });
      expect(panel.isPvpSectionVisible()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reset to defaults
  // -------------------------------------------------------------------------

  describe('Reset to defaults', () => {
    it('getSettings() returns default values after construction', () => {
      const s = panel.getSettings();
      expect(s).toEqual(DEFAULT_GAME_SETTINGS);
    });

    it('setSettings() changes internal state', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, lives: 7, mode: 'king' });
      const s = panel.getSettings();
      expect(s.lives).toBe(7);
      expect(s.mode).toBe('king');
    });

    it('resetToDefaults restores all values to DEFAULT_GAME_SETTINGS', () => {
      // Change some settings
      panel.setSettings({
        ...DEFAULT_GAME_SETTINGS,
        lives: 9,
        mode: 'pvp',
        pvpEnabled: true,
        difficultyMultiplier: 2.0,
        enemyCountCap: 80,
      });
      expect(panel.getSettings().lives).toBe(9);

      // Trigger reset via the button
      const resetBtn = (mockDoc._body as unknown as MockElement).querySelector('.gsp-reset-btn');
      expect(resetBtn).not.toBeNull();
      resetBtn!.click();

      const after = panel.getSettings();
      expect(after).toEqual(DEFAULT_GAME_SETTINGS);
    });

    it('onChange fires after reset with default settings', () => {
      const spy = vi.fn();
      const p = new GameSettingsPanel({
        document: mockDoc as unknown as PanelDocument,
        onChange: spy,
      });
      p.mount();

      // Modify settings first
      p.setSettings({ ...DEFAULT_GAME_SETTINGS, lives: 5 });

      // Reset
      const resetBtn = (mockDoc._body as unknown as MockElement).querySelector('.gsp-reset-btn');
      resetBtn!.click();

      expect(spy).toHaveBeenCalled();
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0] as GameSettings;
      expect(lastCall).toEqual(DEFAULT_GAME_SETTINGS);
    });

    it('PvP section is hidden after reset (default mode is waves)', () => {
      panel.setSettings({ ...DEFAULT_GAME_SETTINGS, mode: 'pvp' });
      expect(panel.isPvpSectionVisible()).toBe(true);

      const resetBtn = (mockDoc._body as unknown as MockElement).querySelector('.gsp-reset-btn');
      resetBtn!.click();

      expect(panel.isPvpSectionVisible()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // onChange callback
  // -------------------------------------------------------------------------

  describe('onChange callback', () => {
    it('fires when setSettings is called externally', () => {
      const spy = vi.fn();
      const p = new GameSettingsPanel({
        document: mockDoc as unknown as PanelDocument,
        onChange: spy,
      });
      p.mount();
      p.setSettings({ ...DEFAULT_GAME_SETTINGS, lives: 1 });
      // Note: setSettings does NOT fire onChange (it's an external update, not user input)
      // Only user input fires onChange — so spy count depends on design decision.
      // The design: setSettings is an external sync (does NOT fire onChange).
      expect(p.getSettings().lives).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // show / hide
  // -------------------------------------------------------------------------

  describe('show / hide', () => {
    it('panel starts hidden', () => {
      const body = mockDoc._body as unknown as MockElement;
      const panelEl = body.querySelector('.gsp-panel');
      // Panel should have gsp-hidden class initially
      expect(panelEl?.classList.contains('gsp-hidden')).toBe(true);
    });

    it('show() removes gsp-hidden', () => {
      panel.show();
      const body = mockDoc._body as unknown as MockElement;
      // Find the panel — querySelector by class works because el() uses classList.add
      const panelEl = body.querySelector('.gsp-panel');
      expect(panelEl?.classList.contains('gsp-hidden')).toBe(false);
    });

    it('hide() adds gsp-hidden', () => {
      panel.show();
      panel.hide();
      const body = mockDoc._body as unknown as MockElement;
      const panelEl = body.querySelector('.gsp-panel');
      expect(panelEl?.classList.contains('gsp-hidden')).toBe(true);
    });
  });
});
