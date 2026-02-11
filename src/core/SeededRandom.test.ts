import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setGameSeed,
  clearGameSeed,
  seededRandom,
  seededRandomInt,
  getCurrentSeed,
  isSeedActive,
} from './SeededRandom';

describe('SeededRandom', () => {
  // Store original Math.random to ensure tests are isolated
  const originalMathRandom = Math.random;

  afterEach(() => {
    // Clean up after each test
    clearGameSeed();
    Math.random = originalMathRandom;
  });

  describe('setGameSeed / clearGameSeed', () => {
    it('setGameSeed replaces Math.random globally', () => {
      setGameSeed(12345);
      expect(Math.random).toBe(seededRandom);
      expect(isSeedActive()).toBe(true);
    });

    it('clearGameSeed restores original Math.random', () => {
      setGameSeed(12345);
      clearGameSeed();
      expect(Math.random).toBe(originalMathRandom);
      expect(isSeedActive()).toBe(false);
    });

    it('getCurrentSeed returns the current state', () => {
      setGameSeed(12345);
      const seed = getCurrentSeed();
      expect(seed).toBe(12345);
    });
  });

  describe('determinism', () => {
    it('same seed produces same sequence', () => {
      setGameSeed(12345);
      const sequence1 = Array.from({ length: 100 }, () => seededRandom());

      setGameSeed(12345);
      const sequence2 = Array.from({ length: 100 }, () => seededRandom());

      expect(sequence1).toEqual(sequence2);
    });

    it('different seeds produce different sequences', () => {
      setGameSeed(12345);
      const sequence1 = Array.from({ length: 100 }, () => seededRandom());

      setGameSeed(54321);
      const sequence2 = Array.from({ length: 100 }, () => seededRandom());

      expect(sequence1).not.toEqual(sequence2);
    });

    it('Math.random() is deterministic when seed is set', () => {
      setGameSeed(12345);
      const sequence1 = Array.from({ length: 100 }, () => Math.random());

      setGameSeed(12345);
      const sequence2 = Array.from({ length: 100 }, () => Math.random());

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe('seededRandom()', () => {
    it('returns values in [0, 1)', () => {
      setGameSeed(42);
      for (let i = 0; i < 1000; i++) {
        const value = seededRandom();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it('has roughly uniform distribution', () => {
      setGameSeed(42);
      const buckets = new Array(10).fill(0);

      // Generate 10000 samples
      for (let i = 0; i < 10000; i++) {
        const value = seededRandom();
        const bucket = Math.floor(value * 10);
        buckets[bucket]++;
      }

      // Each bucket should have roughly 1000 samples (±20%)
      for (const count of buckets) {
        expect(count).toBeGreaterThan(800);
        expect(count).toBeLessThan(1200);
      }
    });

    it('chi-squared test for uniformity', () => {
      setGameSeed(42);
      const buckets = new Array(20).fill(0);
      const n = 10000;
      const expected = n / buckets.length;

      for (let i = 0; i < n; i++) {
        const value = seededRandom();
        const bucket = Math.floor(value * buckets.length);
        buckets[bucket]++;
      }

      // Calculate chi-squared statistic
      let chiSquared = 0;
      for (const observed of buckets) {
        chiSquared += Math.pow(observed - expected, 2) / expected;
      }

      // For 19 degrees of freedom (20 buckets - 1), critical value at p=0.05 is ~30.14
      // Our chi-squared should be less than this for uniform distribution
      expect(chiSquared).toBeLessThan(40); // Allow some margin
    });

    it('falls back to Math.random when no seed is set', () => {
      clearGameSeed();
      const value = seededRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  describe('seededRandomInt()', () => {
    it('returns integers in [min, max)', () => {
      setGameSeed(42);
      const values = new Set<number>();

      for (let i = 0; i < 1000; i++) {
        const value = seededRandomInt(1, 6); // [1, 6) = 1-5
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThan(6);
        values.add(value);
      }

      // Should have seen all values 1-5
      expect(values.size).toBe(5);
    });

    it('handles single-value range', () => {
      setGameSeed(42);
      for (let i = 0; i < 100; i++) {
        expect(seededRandomInt(5, 6)).toBe(5);
      }
    });

    it('works with negative ranges', () => {
      setGameSeed(42);
      for (let i = 0; i < 1000; i++) {
        const value = seededRandomInt(-10, -5);
        expect(value).toBeGreaterThanOrEqual(-10);
        expect(value).toBeLessThan(-5);
      }
    });

    it('is deterministic', () => {
      setGameSeed(12345);
      const sequence1 = Array.from({ length: 100 }, () => seededRandomInt(0, 100));

      setGameSeed(12345);
      const sequence2 = Array.from({ length: 100 }, () => seededRandomInt(0, 100));

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe('gameplay patterns', () => {
    it('Math.random() * max pattern works deterministically', () => {
      setGameSeed(42);
      const angles1 = Array.from({ length: 50 }, () => Math.random() * Math.PI * 2);

      setGameSeed(42);
      const angles2 = Array.from({ length: 50 }, () => Math.random() * Math.PI * 2);

      expect(angles1).toEqual(angles2);
    });

    it('Math.floor(Math.random() * array.length) pattern works', () => {
      setGameSeed(42);
      const arr = ['a', 'b', 'c', 'd', 'e'];
      const picks1 = Array.from({ length: 50 }, () => arr[Math.floor(Math.random() * arr.length)]);

      setGameSeed(42);
      const picks2 = Array.from({ length: 50 }, () => arr[Math.floor(Math.random() * arr.length)]);

      expect(picks1).toEqual(picks2);
    });

    it('min + Math.random() * (max - min) pattern works', () => {
      setGameSeed(42);
      const values1 = Array.from({ length: 50 }, () => 10 + Math.random() * 20);

      setGameSeed(42);
      const values2 = Array.from({ length: 50 }, () => 10 + Math.random() * 20);

      expect(values1).toEqual(values2);
    });

    it('Math.random() < probability pattern works', () => {
      setGameSeed(42);
      const results1 = Array.from({ length: 100 }, () => Math.random() < 0.5);

      setGameSeed(42);
      const results2 = Array.from({ length: 100 }, () => Math.random() < 0.5);

      expect(results1).toEqual(results2);
    });
  });

  describe('edge cases', () => {
    it('handles seed value 0', () => {
      setGameSeed(0);
      const value = seededRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('handles large seed values', () => {
      setGameSeed(2147483647); // Max 32-bit signed int
      const value = seededRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('produces different values after multiple calls', () => {
      setGameSeed(42);
      const values = new Set<number>();
      for (let i = 0; i < 100; i++) {
        values.add(seededRandom());
      }
      // Should have many different values
      expect(values.size).toBeGreaterThan(90);
    });
  });

  describe('test isolation', () => {
    it('each test starts with cleared state', () => {
      expect(isSeedActive()).toBe(false);
      expect(Math.random).toBe(originalMathRandom);
    });
  });
});
