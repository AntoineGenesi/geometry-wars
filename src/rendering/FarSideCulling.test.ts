/**
 * Regression tests for the far-side enemy visibility culling feature.
 *
 * At 150+ entities, regular enemies on the far side of the surface are hidden
 * to reduce visual clutter. This file tests the core math that drives the fade zone.
 *
 * The logic lives in RenderLoop.ts (enemy_visibility section).
 * These tests verify the constants and formula produce correct behaviour.
 */

import { describe, it, expect } from 'vitest';

// Constants mirrored from RenderLoop.ts — if they change there, update here.
const FAR_SIDE_ENTITY_THRESHOLD = 150;
const FAR_SIDE_NEAR_DOT = 0.15;   // dot > this: fully visible (near side)
const FAR_SIDE_FAR_DOT = -0.10;   // dot < this: hidden (far side)
const FAR_SIDE_RANGE = FAR_SIDE_NEAR_DOT - FAR_SIDE_FAR_DOT; // 0.25

/**
 * The far-factor formula from RenderLoop.ts — pure function for testing.
 * dot < FAR_SIDE_FAR_DOT  → 0 (hidden)
 * dot > FAR_SIDE_NEAR_DOT → 1 (fully visible)
 * in between              → smooth linear fade
 */
function computeFarFactor(dot: number): number {
  return Math.max(0, Math.min(1, (dot - FAR_SIDE_FAR_DOT) / FAR_SIDE_RANGE));
}

describe('Far-side enemy culling', () => {
  describe('entity count threshold', () => {
    it('activates culling at exactly 150 entities', () => {
      expect(FAR_SIDE_ENTITY_THRESHOLD).toBe(150);
    });

    it('does NOT cull at 149 entities (one below threshold)', () => {
      // Verified by allEnemies.length >= FAR_SIDE_ENTITY_THRESHOLD check
      const entityCount = 149;
      const doCulling = entityCount >= FAR_SIDE_ENTITY_THRESHOLD;
      expect(doCulling).toBe(false);
    });

    it('culls at 150 entities (at threshold)', () => {
      const entityCount = 150;
      const doCulling = entityCount >= FAR_SIDE_ENTITY_THRESHOLD;
      expect(doCulling).toBe(true);
    });

    it('culls at 200 entities (above threshold)', () => {
      const entityCount = 200;
      const doCulling = entityCount >= FAR_SIDE_ENTITY_THRESHOLD;
      expect(doCulling).toBe(true);
    });
  });

  describe('far-side factor formula', () => {
    it('returns 0 for enemies directly on the far side (dot = -1)', () => {
      expect(computeFarFactor(-1.0)).toBe(0);
    });

    it('returns 0 at the far-dot boundary (dot = -0.10)', () => {
      expect(computeFarFactor(-0.10)).toBe(0);
    });

    it('returns 0 for enemies just past the fade zone (dot = -0.11)', () => {
      expect(computeFarFactor(-0.11)).toBe(0);
    });

    it('returns 1 for enemies directly on the near side (dot = 1)', () => {
      expect(computeFarFactor(1.0)).toBe(1);
    });

    it('returns 1 at the near-dot boundary (dot = 0.15)', () => {
      expect(computeFarFactor(0.15)).toBe(1);
    });

    it('returns 1 for enemies just past the near zone (dot = 0.16)', () => {
      expect(computeFarFactor(0.16)).toBe(1);
    });

    it('smoothly fades at the horizon midpoint (dot = 0.025 ≈ midpoint)', () => {
      // midpoint = (FAR_SIDE_FAR_DOT + FAR_SIDE_NEAR_DOT) / 2 = (-0.10 + 0.15) / 2 = 0.025
      const midDot = (FAR_SIDE_FAR_DOT + FAR_SIDE_NEAR_DOT) / 2;
      const factor = computeFarFactor(midDot);
      expect(factor).toBeCloseTo(0.5, 5);
    });

    it('is strictly increasing across the fade zone', () => {
      const dots = [-0.10, -0.05, 0.0, 0.025, 0.10, 0.15];
      for (let i = 1; i < dots.length; i++) {
        expect(computeFarFactor(dots[i])).toBeGreaterThanOrEqual(computeFarFactor(dots[i - 1]));
      }
    });

    it('clamps output to [0, 1] regardless of input', () => {
      const extremes = [-10, -2, -1.5, 2, 10];
      for (const dot of extremes) {
        const factor = computeFarFactor(dot);
        expect(factor).toBeGreaterThanOrEqual(0);
        expect(factor).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('death effect scale formula', () => {
    // Mirrors the formula in GameLoop.ts
    // Math.max(0.3, 1.0 - Math.max(0, enemies.length - 100) / 200)
    function computeDeathShockwaveScale(enemyCount: number): number {
      return Math.max(0.3, 1.0 - Math.max(0, enemyCount - 100) / 200);
    }

    it('is 1.0 at 100 or fewer enemies', () => {
      expect(computeDeathShockwaveScale(0)).toBe(1.0);
      expect(computeDeathShockwaveScale(50)).toBe(1.0);
      expect(computeDeathShockwaveScale(100)).toBe(1.0);
    });

    it('scales down between 100 and 300 enemies', () => {
      const scale200 = computeDeathShockwaveScale(200);
      expect(scale200).toBeGreaterThan(0.3);
      expect(scale200).toBeLessThan(1.0);
      expect(scale200).toBeCloseTo(0.5, 5); // (1 - (200-100)/200) = 0.5
    });

    it('bottoms out at 0.3 at 300+ enemies', () => {
      expect(computeDeathShockwaveScale(300)).toBeCloseTo(0.3, 5);
      expect(computeDeathShockwaveScale(500)).toBe(0.3);
      expect(computeDeathShockwaveScale(1000)).toBe(0.3);
    });

    it('never goes below minimum of 0.3', () => {
      for (const count of [0, 100, 200, 300, 500, 1000]) {
        expect(computeDeathShockwaveScale(count)).toBeGreaterThanOrEqual(0.3);
      }
    });
  });
});
