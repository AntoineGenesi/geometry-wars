import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadMobileGridBrightness,
  saveMobileGridBrightness,
  MOBILE_GRID_DEFAULT_BRIGHTNESS,
  MOBILE_GRID_BRIGHTNESS_MIN,
  MOBILE_GRID_BRIGHTNESS_MAX,
  MOBILE_GRID_SEGMENTS_MULTIPLIER,
  MOBILE_GRID_MAX_SEGMENTS_U,
  MOBILE_GRID_MAX_SEGMENTS_V,
  loadGridBrightness,
  saveGridBrightness,
  loadGridDensity,
  saveGridDensity,
  GRID_DENSITY_PRESETS,
  DESKTOP_GRID_DEFAULT_BRIGHTNESS,
  type GridDensityPreset,
} from './MobileGridConfig';

// In-memory localStorage mock — avoids jsdom dependency
function makeLocalStorageMock(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
}

describe('MobileGridConfig', () => {
  const STORAGE_KEY = 'gw3d-mobile-grid-brightness';
  let lsMock: Storage;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal('localStorage', lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constants', () => {
    it('has correct segment multiplier', () => {
      expect(MOBILE_GRID_SEGMENTS_MULTIPLIER).toBe(4);
    });

    it('has correct max segment caps (4× the 24×18 default)', () => {
      expect(MOBILE_GRID_MAX_SEGMENTS_U).toBe(96);
      expect(MOBILE_GRID_MAX_SEGMENTS_V).toBe(72);
    });

    it('default brightness is higher than the quiet desktop default', () => {
      expect(MOBILE_GRID_DEFAULT_BRIGHTNESS).toBeGreaterThan(DESKTOP_GRID_DEFAULT_BRIGHTNESS);
    });
  });

  describe('loadMobileGridBrightness', () => {
    it('returns default when nothing is saved', () => {
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_DEFAULT_BRIGHTNESS);
    });

    it('returns saved value from localStorage', () => {
      lsMock.setItem(STORAGE_KEY, '0.5');
      expect(loadMobileGridBrightness()).toBe(0.5);
    });

    it('clamps returned value to [min, max] range', () => {
      lsMock.setItem(STORAGE_KEY, '-1');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_BRIGHTNESS_MIN);

      lsMock.setItem(STORAGE_KEY, '99');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_BRIGHTNESS_MAX);
    });

    it('ignores non-numeric localStorage values', () => {
      lsMock.setItem(STORAGE_KEY, 'not-a-number');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_DEFAULT_BRIGHTNESS);
    });
  });

  describe('saveMobileGridBrightness', () => {
    it('persists value to localStorage', () => {
      saveMobileGridBrightness(0.6);
      expect(lsMock.getItem(STORAGE_KEY)).toBe('0.6');
    });

    it('round-trips through load/save', () => {
      saveMobileGridBrightness(0.45);
      expect(loadMobileGridBrightness()).toBe(0.45);
    });
  });
});

describe('Universal grid settings', () => {
  const BRIGHTNESS_KEY = 'gw3d-grid-brightness';
  const DENSITY_KEY = 'gw3d-grid-density';
  const OLD_MOBILE_KEY = 'gw3d-mobile-grid-brightness';
  let lsMock: Storage;

  beforeEach(() => {
    lsMock = makeLocalStorageMock();
    vi.stubGlobal('localStorage', lsMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('DESKTOP_GRID_DEFAULT_BRIGHTNESS', () => {
    it('is a quiet readable desktop default', () => {
      expect(DESKTOP_GRID_DEFAULT_BRIGHTNESS).toBe(0.08);
    });
  });

  describe('GRID_DENSITY_PRESETS', () => {
    it('medium preset matches existing hardcoded default (24×18)', () => {
      expect(GRID_DENSITY_PRESETS.medium.segmentsU).toBe(24);
      expect(GRID_DENSITY_PRESETS.medium.segmentsV).toBe(18);
    });

    it('low is half of medium, high is double of medium', () => {
      expect(GRID_DENSITY_PRESETS.low.segmentsU).toBe(12);
      expect(GRID_DENSITY_PRESETS.high.segmentsU).toBe(48);
    });
  });

  describe('loadGridBrightness', () => {
    it('returns desktop default when nothing saved (desktop)', () => {
      expect(loadGridBrightness(false)).toBe(DESKTOP_GRID_DEFAULT_BRIGHTNESS);
    });

    it('returns mobile default when nothing saved (mobile)', () => {
      expect(loadGridBrightness(true)).toBe(MOBILE_GRID_DEFAULT_BRIGHTNESS);
    });

    it('returns saved value from universal key (desktop)', () => {
      lsMock.setItem(BRIGHTNESS_KEY, '0.4');
      expect(loadGridBrightness(false)).toBe(0.4);
    });

    it('returns saved value from universal key (mobile)', () => {
      lsMock.setItem(BRIGHTNESS_KEY, '0.6');
      expect(loadGridBrightness(true)).toBe(0.6);
    });

    it('clamps to [0, 1]', () => {
      lsMock.setItem(BRIGHTNESS_KEY, '-0.5');
      expect(loadGridBrightness(false)).toBe(0);
      lsMock.setItem(BRIGHTNESS_KEY, '1.5');
      expect(loadGridBrightness(false)).toBe(1);
    });

    it('ignores non-numeric values and returns default', () => {
      lsMock.setItem(BRIGHTNESS_KEY, 'bad');
      expect(loadGridBrightness(false)).toBe(DESKTOP_GRID_DEFAULT_BRIGHTNESS);
    });

    it('falls back to old mobile key on mobile when universal key absent', () => {
      lsMock.setItem(OLD_MOBILE_KEY, '0.55');
      expect(loadGridBrightness(true)).toBe(0.55);
    });

    it('universal key takes precedence over old mobile key', () => {
      lsMock.setItem(OLD_MOBILE_KEY, '0.55');
      lsMock.setItem(BRIGHTNESS_KEY, '0.25');
      expect(loadGridBrightness(true)).toBe(0.25);
    });

    it('does NOT fall back to old mobile key on desktop', () => {
      lsMock.setItem(OLD_MOBILE_KEY, '0.55');
      expect(loadGridBrightness(false)).toBe(DESKTOP_GRID_DEFAULT_BRIGHTNESS);
    });
  });

  describe('saveGridBrightness', () => {
    it('persists to universal key', () => {
      saveGridBrightness(0.3);
      expect(lsMock.getItem(BRIGHTNESS_KEY)).toBe('0.3');
    });

    it('round-trips through load/save', () => {
      saveGridBrightness(0.75);
      expect(loadGridBrightness(false)).toBe(0.75);
    });
  });

  describe('loadGridDensity', () => {
    it('returns medium when nothing saved', () => {
      expect(loadGridDensity()).toBe('medium');
    });

    it('returns saved preset', () => {
      lsMock.setItem(DENSITY_KEY, 'low');
      expect(loadGridDensity()).toBe('low');
      lsMock.setItem(DENSITY_KEY, 'high');
      expect(loadGridDensity()).toBe('high');
    });

    it('ignores invalid values and returns medium', () => {
      lsMock.setItem(DENSITY_KEY, 'ultra');
      expect(loadGridDensity()).toBe('medium');
    });
  });

  describe('saveGridDensity', () => {
    it('persists to localStorage', () => {
      saveGridDensity('high');
      expect(lsMock.getItem(DENSITY_KEY)).toBe('high');
    });

    it('round-trips all three presets', () => {
      const presets: GridDensityPreset[] = ['low', 'medium', 'high'];
      for (const p of presets) {
        saveGridDensity(p);
        expect(loadGridDensity()).toBe(p);
      }
    });
  });
});
