/**
 * Tests for VisualMode persistence (pixelated vs modern).
 *
 * Regression test: loadVisualMode defaults to 'pixelated', saveVisualMode persists.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadVisualMode, saveVisualMode, type VisualMode } from './VisualStyleSettings';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VisualMode persistence', () => {
  describe('loadVisualMode', () => {
    it('returns pixelated by default when nothing is saved', () => {
      expect(loadVisualMode()).toBe('pixelated');
    });

    it('returns pixelated when explicitly saved as pixelated', () => {
      saveVisualMode('pixelated');
      expect(loadVisualMode()).toBe('pixelated');
    });

    it('returns modern when saved as modern', () => {
      saveVisualMode('modern');
      expect(loadVisualMode()).toBe('modern');
    });

    it('falls back to pixelated for unknown stored values', () => {
      store['gw3d-visual-mode'] = 'legacy';
      expect(loadVisualMode()).toBe('pixelated');
    });

    it('falls back to pixelated when localStorage throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => { throw new Error('unavailable'); },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null,
      });
      expect(loadVisualMode()).toBe('pixelated');
    });
  });

  describe('saveVisualMode', () => {
    it('persists pixelated', () => {
      saveVisualMode('pixelated');
      expect(store['gw3d-visual-mode']).toBe('pixelated');
    });

    it('persists modern', () => {
      saveVisualMode('modern');
      expect(store['gw3d-visual-mode']).toBe('modern');
    });

    it('does not throw when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => { throw new Error('full'); },
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null,
      });
      expect(() => saveVisualMode('modern')).not.toThrow();
    });

    it('round-trips both modes', () => {
      const modes: VisualMode[] = ['pixelated', 'modern'];
      for (const mode of modes) {
        saveVisualMode(mode);
        expect(loadVisualMode()).toBe(mode);
      }
    });
  });
});
