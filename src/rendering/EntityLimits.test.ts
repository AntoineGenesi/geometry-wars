import { describe, it, expect } from 'vitest';
import { getEntityLimits, EntityLimits } from './EntityLimits';

describe('EntityLimits', () => {
  describe('getEntityLimits', () => {
    it('returns limits for high tier', () => {
      const limits = getEntityLimits('high');
      expect(limits.maxEnemies).toBe(500);
      expect(limits.maxBullets).toBe(2000);
      expect(limits.maxParticles).toBe(10000);
      expect(limits.maxGeoms).toBe(1000);
      expect(limits.bloomEnabled).toBe(true);
      expect(limits.shadowsEnabled).toBe(true);
    });

    it('returns limits for medium tier', () => {
      const limits = getEntityLimits('medium');
      expect(limits.maxEnemies).toBe(200);
      expect(limits.maxBullets).toBe(800);
      expect(limits.maxParticles).toBe(5000);
      expect(limits.maxGeoms).toBe(500);
      expect(limits.bloomEnabled).toBe(true);
      expect(limits.shadowsEnabled).toBe(false);
    });

    it('returns limits for low tier', () => {
      const limits = getEntityLimits('low');
      expect(limits.maxEnemies).toBe(80);
      expect(limits.maxBullets).toBe(300);
      expect(limits.maxParticles).toBe(2000);
      expect(limits.maxGeoms).toBe(200);
      expect(limits.bloomEnabled).toBe(false);
      expect(limits.shadowsEnabled).toBe(false);
    });

    it('returns a new object each call (no shared mutation)', () => {
      const a = getEntityLimits('high');
      const b = getEntityLimits('high');
      expect(a).not.toBe(b); // Different references
      expect(a).toEqual(b);  // Same values
    });

    it('returned object can be mutated without affecting future calls', () => {
      const a = getEntityLimits('medium');
      a.maxEnemies = 9999;
      const b = getEntityLimits('medium');
      expect(b.maxEnemies).toBe(200); // Unaffected
    });

    it('high tier has strictly more capacity than medium', () => {
      const high = getEntityLimits('high');
      const medium = getEntityLimits('medium');
      expect(high.maxEnemies).toBeGreaterThan(medium.maxEnemies);
      expect(high.maxBullets).toBeGreaterThan(medium.maxBullets);
      expect(high.maxParticles).toBeGreaterThan(medium.maxParticles);
      expect(high.maxGeoms).toBeGreaterThan(medium.maxGeoms);
    });

    it('medium tier has strictly more capacity than low', () => {
      const medium = getEntityLimits('medium');
      const low = getEntityLimits('low');
      expect(medium.maxEnemies).toBeGreaterThan(low.maxEnemies);
      expect(medium.maxBullets).toBeGreaterThan(low.maxBullets);
      expect(medium.maxParticles).toBeGreaterThan(low.maxParticles);
      expect(medium.maxGeoms).toBeGreaterThan(low.maxGeoms);
    });

    it('low tier disables bloom', () => {
      const low = getEntityLimits('low');
      expect(low.bloomEnabled).toBe(false);
    });

    it('only high tier enables shadows', () => {
      expect(getEntityLimits('high').shadowsEnabled).toBe(true);
      expect(getEntityLimits('medium').shadowsEnabled).toBe(false);
      expect(getEntityLimits('low').shadowsEnabled).toBe(false);
    });
  });
});
