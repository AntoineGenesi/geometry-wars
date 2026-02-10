import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to mock window/navigator/localStorage before importing the module.
// The MobileDetector uses these globals at call time, not import time.
const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; },
});

vi.stubGlobal('window', {
  location: { search: '', href: 'http://localhost' },
  innerWidth: 1920,
  innerHeight: 1080,
});

vi.stubGlobal('navigator', {
  maxTouchPoints: 0,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
});

import {
  isMobile,
  setMobileOverride,
  getMobileOverride,
  resetMobileDetection,
} from '../core/MobileDetector';

describe('MobileDetector', () => {
  beforeEach(() => {
    resetMobileDetection();
    for (const k in mockLocalStorage) delete mockLocalStorage[k];
    // Reset globals to desktop defaults
    (window as any).location = { search: '', href: 'http://localhost' };
    (window as any).innerWidth = 1920;
    (window as any).innerHeight = 1080;
    (navigator as any).maxTouchPoints = 0;
    (navigator as any).userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  });

  describe('isMobile', () => {
    it('returns false for desktop environment (no touch, large screen)', () => {
      expect(isMobile()).toBe(false);
    });

    it('detects ?mobile=true URL parameter', () => {
      (window as any).location = { search: '?mobile=true', href: 'http://localhost?mobile=true' };
      resetMobileDetection();
      expect(isMobile()).toBe(true);
    });

    it('respects ?mobile=false URL parameter', () => {
      // Even with touch enabled, explicit false should override
      (navigator as any).maxTouchPoints = 5;
      (window as any).innerWidth = 390;
      (window as any).location = { search: '?mobile=false', href: 'http://localhost?mobile=false' };
      resetMobileDetection();
      expect(isMobile()).toBe(false);
    });

    it('auto-detects mobile: touch + small screen', () => {
      (navigator as any).maxTouchPoints = 5;
      (window as any).innerWidth = 390;
      (window as any).innerHeight = 844;
      resetMobileDetection();
      expect(isMobile()).toBe(true);
    });

    it('auto-detects mobile: touch + mobile user agent', () => {
      (navigator as any).maxTouchPoints = 5;
      (navigator as any).userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)';
      resetMobileDetection();
      expect(isMobile()).toBe(true);
    });

    it('does not detect mobile with touch but large screen + desktop UA', () => {
      (navigator as any).maxTouchPoints = 1; // Some laptops have touch
      (window as any).innerWidth = 1920;
      (window as any).innerHeight = 1080;
      resetMobileDetection();
      expect(isMobile()).toBe(false);
    });

    it('caches the result across multiple calls', () => {
      const first = isMobile();
      const second = isMobile();
      expect(first).toBe(second);
    });
  });

  describe('setMobileOverride', () => {
    it('forces mobile mode on', () => {
      setMobileOverride(true);
      expect(isMobile()).toBe(true);
    });

    it('forces mobile mode off', () => {
      setMobileOverride(false);
      expect(isMobile()).toBe(false);
    });

    it('reverts to auto-detect when set to null', () => {
      setMobileOverride(true);
      expect(isMobile()).toBe(true);

      setMobileOverride(null);
      // Auto-detect should return false (desktop globals)
      resetMobileDetection();
      expect(isMobile()).toBe(false);
    });

    it('persists override to localStorage', () => {
      setMobileOverride(true);
      expect(mockLocalStorage['gw3d-mobile-override']).toBe('true');
    });

    it('removes from localStorage when set to null', () => {
      setMobileOverride(true);
      setMobileOverride(null);
      expect(mockLocalStorage['gw3d-mobile-override']).toBeUndefined();
    });

    it('override takes priority over URL parameter', () => {
      (window as any).location = { search: '?mobile=true', href: 'http://localhost?mobile=true' };
      setMobileOverride(false);
      expect(isMobile()).toBe(false);
    });
  });

  describe('getMobileOverride', () => {
    it('returns null by default (auto-detect)', () => {
      expect(getMobileOverride()).toBeNull();
    });

    it('returns true after setMobileOverride(true)', () => {
      setMobileOverride(true);
      expect(getMobileOverride()).toBe(true);
    });

    it('returns false after setMobileOverride(false)', () => {
      setMobileOverride(false);
      expect(getMobileOverride()).toBe(false);
    });

    it('returns null after setMobileOverride(null)', () => {
      setMobileOverride(true);
      setMobileOverride(null);
      expect(getMobileOverride()).toBeNull();
    });
  });

  describe('localStorage persistence', () => {
    it('reads override from localStorage on first call', () => {
      mockLocalStorage['gw3d-mobile-override'] = 'true';
      resetMobileDetection();
      // With no manual override set in memory, it should read from storage
      // Note: getMobileOverride reads from storage fallback
      expect(getMobileOverride()).toBe(true);
    });
  });
});
