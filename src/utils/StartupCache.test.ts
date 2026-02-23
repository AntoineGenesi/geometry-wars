import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeSimpleHash,
  computeObjectHash,
  getStartupCacheHash,
  isStartupCacheFresh,
  getStartupCache,
  setStartupCache,
  setDDABaseline,
  getDDABaseline,
  clearStartupCache,
  type StartupConfigData,
  type DDABaselineData,
} from './StartupCache';

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_CONFIG: StartupConfigData = {
  weaponConfigs: {
    standard: { ammo: -1, damageMultiplier: 1.0 },
    spread:   { ammo: 50, damageMultiplier: 0.8 },
  },
  serverVersion: 'abc123',
};

const SAMPLE_BASELINE: DDABaselineData = {
  performanceScore: 0.6,
  killRate: 12.5,
  deathRate: 1.2,
  scoreRate: 3400,
  capturedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests: computeSimpleHash
// ---------------------------------------------------------------------------

describe('computeSimpleHash', () => {
  it('returns an 8-char hex string', () => {
    const h = computeSimpleHash('hello');
    expect(h).toHaveLength(8);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(computeSimpleHash('abc')).toBe(computeSimpleHash('abc'));
  });

  it('differs for different inputs', () => {
    expect(computeSimpleHash('abc')).not.toBe(computeSimpleHash('abd'));
  });

  it('handles empty string', () => {
    const h = computeSimpleHash('');
    expect(h).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeObjectHash
// ---------------------------------------------------------------------------

describe('computeObjectHash', () => {
  it('produces same hash for identical objects', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 2 };
    expect(computeObjectHash(a)).toBe(computeObjectHash(b));
  });

  it('produces different hash when values differ', () => {
    expect(computeObjectHash({ x: 1 })).not.toBe(computeObjectHash({ x: 2 }));
  });
});

// ---------------------------------------------------------------------------
// Tests: localStorage read/write
// ---------------------------------------------------------------------------

describe('StartupCache', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // --- getStartupCacheHash ---

  it('getStartupCacheHash returns null when empty', () => {
    expect(getStartupCacheHash()).toBeNull();
  });

  it('getStartupCacheHash returns stored hash after write', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    expect(getStartupCacheHash()).toBe('deadbeef');
  });

  // --- isStartupCacheFresh ---

  it('isStartupCacheFresh returns false when no cache', () => {
    expect(isStartupCacheFresh('deadbeef')).toBe(false);
  });

  it('isStartupCacheFresh returns true when hash matches and cache is fresh', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    expect(isStartupCacheFresh('deadbeef')).toBe(true);
  });

  it('isStartupCacheFresh returns false when hash differs', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    expect(isStartupCacheFresh('cafecafe')).toBe(false);
  });

  it('isStartupCacheFresh returns false when cache is expired', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    // Backdate the timestamp by 25 hours
    const pastMs = Date.now() - 25 * 60 * 60 * 1000;
    localStorageMock.setItem('gw_startup_cache_timestamp', String(pastMs));
    expect(isStartupCacheFresh('deadbeef')).toBe(false);
  });

  // --- getStartupCache / setStartupCache ---

  it('getStartupCache returns null when empty', () => {
    expect(getStartupCache()).toBeNull();
  });

  it('getStartupCache returns data after setStartupCache', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    const result = getStartupCache();
    expect(result).not.toBeNull();
    expect(result!.serverVersion).toBe('abc123');
    expect(result!.weaponConfigs.standard.ammo).toBe(-1);
  });

  it('setStartupCache overwrites previous cache', () => {
    setStartupCache('hash1', { ...SAMPLE_CONFIG, serverVersion: 'v1' });
    setStartupCache('hash2', { ...SAMPLE_CONFIG, serverVersion: 'v2' });
    expect(getStartupCacheHash()).toBe('hash2');
    expect(getStartupCache()!.serverVersion).toBe('v2');
  });

  // --- DDA baseline ---

  it('getDDABaseline returns null when no cache', () => {
    expect(getDDABaseline()).toBeNull();
  });

  it('getDDABaseline returns null when cache has no baseline', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    expect(getDDABaseline()).toBeNull();
  });

  it('setDDABaseline persists baseline in existing cache', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    setDDABaseline(SAMPLE_BASELINE);
    const result = getDDABaseline();
    expect(result).not.toBeNull();
    expect(result!.performanceScore).toBe(0.6);
    expect(result!.killRate).toBe(12.5);
  });

  it('setDDABaseline does nothing when no cache exists', () => {
    setDDABaseline(SAMPLE_BASELINE);
    expect(getDDABaseline()).toBeNull();
  });

  it('setDDABaseline does not change the hash', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    setDDABaseline(SAMPLE_BASELINE);
    expect(getStartupCacheHash()).toBe('deadbeef');
  });

  // --- clearStartupCache ---

  it('clearStartupCache removes all cache keys', () => {
    setStartupCache('deadbeef', SAMPLE_CONFIG);
    clearStartupCache();
    expect(getStartupCacheHash()).toBeNull();
    expect(getStartupCache()).toBeNull();
    expect(isStartupCacheFresh('deadbeef')).toBe(false);
  });
});
