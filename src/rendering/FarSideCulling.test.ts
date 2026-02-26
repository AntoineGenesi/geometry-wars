/**
 * Regression tests for the far-side enemy visibility culling feature.
 *
 * At 150+ entities, regular enemies on the far side of the surface are hidden
 * to reduce visual clutter. Culling deactivates below 120 (hysteresis) to prevent
 * flickering when enemy count oscillates around the activation threshold.
 *
 * The logic lives in RenderLoop.ts (enemy_visibility section).
 * These tests verify the constants and formula produce correct behaviour.
 */

import { describe, it, expect } from 'vitest';

// Constants mirrored from RenderLoop.ts — if they change there, update here.
const FAR_SIDE_ENTITY_THRESHOLD_ON  = 150;  // culling activates at 150+
const FAR_SIDE_ENTITY_THRESHOLD_OFF = 120;  // culling deactivates below 120 (hysteresis)
const FAR_SIDE_NEAR_DOT = 0.15;   // dot > this: fully visible (near side)
const FAR_SIDE_FAR_DOT = -0.10;   // dot < this: hidden (far side)
const FAR_SIDE_RANGE = FAR_SIDE_NEAR_DOT - FAR_SIDE_FAR_DOT; // 0.25

/**
 * Simulate the hysteresis culling state machine from RenderLoop.ts.
 * @param entityCount - current number of entities
 * @param currentlyActive - whether culling is currently active
 */
function updateCullingState(entityCount: number, currentlyActive: boolean): boolean {
  if (!currentlyActive && entityCount >= FAR_SIDE_ENTITY_THRESHOLD_ON) return true;
  if (currentlyActive && entityCount < FAR_SIDE_ENTITY_THRESHOLD_OFF) return false;
  return currentlyActive;
}

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
  describe('entity count threshold with hysteresis', () => {
    it('does NOT cull when starting from 0 entities at 149 (below ON threshold)', () => {
      expect(updateCullingState(149, false)).toBe(false);
    });

    it('activates culling at exactly 150 entities (ON threshold)', () => {
      expect(updateCullingState(150, false)).toBe(true);
    });

    it('activates culling at 200 entities', () => {
      expect(updateCullingState(200, false)).toBe(true);
    });

    it('stays active when already active at 130 (between OFF=120 and ON=150)', () => {
      // Hysteresis: once active, culling stays on until below 120
      expect(updateCullingState(130, true)).toBe(true);
    });

    it('stays active when already active at 121 (just above OFF threshold)', () => {
      expect(updateCullingState(121, true)).toBe(true);
    });

    it('deactivates when already active and count drops below 120 (OFF threshold)', () => {
      expect(updateCullingState(119, true)).toBe(false);
    });

    it('deactivates at exactly 0 entities when active', () => {
      expect(updateCullingState(0, true)).toBe(false);
    });

    it('hysteresis prevents flicker: 150→149→150 cycle stays stable', () => {
      // Simulates enemy count oscillating around 150
      let active = false;
      active = updateCullingState(150, active); // → true
      active = updateCullingState(149, active); // → still true (149 >= OFF=120)
      active = updateCullingState(150, active); // → still true
      expect(active).toBe(true);
    });

    it('hysteresis prevents flicker: drop to 119 is needed to deactivate', () => {
      let active = true;
      active = updateCullingState(148, active); // → still true
      active = updateCullingState(120, active); // → still true (120 >= OFF=120)
      active = updateCullingState(119, active); // → false
      expect(active).toBe(false);
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

  describe('boss-only shockwave filter', () => {
    // Regression test: shockwave must only trigger for boss-tier enemies.
    // The filter used in GameLoop.ts and network-main.ts:
    //   enemy.baseTypeName.startsWith('boss_')
    function isBossTier(baseTypeName: string): boolean {
      return baseTypeName.startsWith('boss_');
    }

    it('triggers for all boss variants', () => {
      const bossNames = [
        'boss_sapphire', 'boss_ruby', 'boss_emerald',
        'boss_topaz', 'boss_amethyst', 'boss_opal',
      ];
      for (const name of bossNames) {
        expect(isBossTier(name)).toBe(true);
      }
    });

    it('does NOT trigger for regular enemies', () => {
      const regularNames = [
        'grunt', 'wanderer', 'snake', 'virus', 'splitter',
        'swarm', 'fractal', 'lurker', 'orbiter', 'phaser',
        'cluster', 'helix', 'repulsor', 'painter', 'stealth_stalker',
        'approach_glow', 'giant_wanderer', 'giant_snake', 'giant_rocket',
        'titan_grunt', 'titan_spinner', 'titan_weaver', 'spawner',
      ];
      for (const name of regularNames) {
        expect(isBossTier(name)).toBe(false);
      }
    });

    it('does NOT trigger for empty baseTypeName', () => {
      expect(isBossTier('')).toBe(false);
    });
  });
});
