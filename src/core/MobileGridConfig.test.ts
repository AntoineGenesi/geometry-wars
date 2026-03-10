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
} from './MobileGridConfig';

describe('MobileGridConfig', () => {
  const STORAGE_KEY = 'gw3d-mobile-grid-brightness';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('constants', () => {
    it('has correct segment multiplier', () => {
      expect(MOBILE_GRID_SEGMENTS_MULTIPLIER).toBe(4);
    });

    it('has correct max segment caps (4× the 24×18 default)', () => {
      expect(MOBILE_GRID_MAX_SEGMENTS_U).toBe(96);
      expect(MOBILE_GRID_MAX_SEGMENTS_V).toBe(72);
    });

    it('default brightness is higher than the desktop default (0.10)', () => {
      expect(MOBILE_GRID_DEFAULT_BRIGHTNESS).toBeGreaterThan(0.10);
    });
  });

  describe('loadMobileGridBrightness', () => {
    it('returns default when nothing is saved', () => {
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_DEFAULT_BRIGHTNESS);
    });

    it('returns saved value from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, '0.5');
      expect(loadMobileGridBrightness()).toBe(0.5);
    });

    it('clamps returned value to [min, max] range', () => {
      localStorage.setItem(STORAGE_KEY, '-1');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_BRIGHTNESS_MIN);

      localStorage.setItem(STORAGE_KEY, '99');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_BRIGHTNESS_MAX);
    });

    it('ignores non-numeric localStorage values', () => {
      localStorage.setItem(STORAGE_KEY, 'not-a-number');
      expect(loadMobileGridBrightness()).toBe(MOBILE_GRID_DEFAULT_BRIGHTNESS);
    });
  });

  describe('saveMobileGridBrightness', () => {
    it('persists value to localStorage', () => {
      saveMobileGridBrightness(0.6);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('0.6');
    });

    it('round-trips through load/save', () => {
      saveMobileGridBrightness(0.45);
      expect(loadMobileGridBrightness()).toBe(0.45);
    });
  });
});
