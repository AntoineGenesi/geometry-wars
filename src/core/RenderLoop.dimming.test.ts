/**
 * UV-distance dimming hysteresis tests — s44r2-01 (torus entity flickering fix).
 *
 * The root cause: on compact surfaces like small torus, entities' UV distances can
 * hover near SURFACE_NEAR_UV (0.15), toggling between bright (surfaceVis=1.0) and
 * dimmed (surfaceVis<1.0) every frame → visible flicker.
 *
 * Fix: hysteresis with two thresholds:
 *   ENTER = 0.17  (only start dimming when past this, from bright state)
 *   EXIT  = 0.13  (only stop dimming when below this, from dimmed state)
 *
 * This tests the core hysteresis logic without requiring a full GameContext.
 */

import { describe, it, expect } from 'vitest';

// Mirror the constants from RenderLoop.ts
const SURFACE_NEAR_UV_ENTER = 0.17;
const SURFACE_NEAR_UV_EXIT  = 0.13;
const SURFACE_NEAR_UV       = 0.15;
const SURFACE_FAR_UV        = 0.45;
const SURFACE_DIM_OPACITY   = 0.15; // s44r8-04: raised from 0.08

/**
 * Pure implementation of the hysteresis dimming logic from RenderLoop.ts.
 * Returns { surfaceVis, nextDimmed } so tests can chain calls.
 */
function computeSurfaceVis(uvDist: number, wasDimmed: boolean): { surfaceVis: number; nextDimmed: boolean } {
  const nearThreshold = wasDimmed ? SURFACE_NEAR_UV_EXIT : SURFACE_NEAR_UV_ENTER;
  if (uvDist <= nearThreshold) {
    return { surfaceVis: 1.0, nextDimmed: false };
  } else if (uvDist >= SURFACE_FAR_UV) {
    return { surfaceVis: SURFACE_DIM_OPACITY, nextDimmed: true };
  } else {
    const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV);
    const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
    const surfaceVis = 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY);
    return { surfaceVis, nextDimmed: true };
  }
}

describe('UV-distance dimming hysteresis (s44r2-01 torus flicker fix)', () => {

  describe('bright-state baseline', () => {
    it('entity well within near zone (uvDist=0.05) is fully bright', () => {
      const { surfaceVis } = computeSurfaceVis(0.05, false);
      expect(surfaceVis).toBe(1.0);
    });

    it('entity at exactly ENTER threshold (uvDist=0.17) stays bright from bright state', () => {
      const { surfaceVis, nextDimmed } = computeSurfaceVis(0.17, false);
      expect(surfaceVis).toBe(1.0);
      expect(nextDimmed).toBe(false);
    });

    it('entity just past ENTER (uvDist=0.18) from bright state starts dimming', () => {
      const { surfaceVis, nextDimmed } = computeSurfaceVis(0.18, false);
      expect(surfaceVis).toBeLessThan(1.0);
      expect(nextDimmed).toBe(true);
    });
  });

  describe('dimmed-state baseline', () => {
    it('entity well within near zone (uvDist=0.05) clears dimmed state', () => {
      const { surfaceVis, nextDimmed } = computeSurfaceVis(0.05, true);
      expect(surfaceVis).toBe(1.0);
      expect(nextDimmed).toBe(false);
    });

    it('entity at exactly EXIT threshold (uvDist=0.13) stops dimming from dimmed state', () => {
      const { surfaceVis, nextDimmed } = computeSurfaceVis(0.13, true);
      expect(surfaceVis).toBe(1.0);
      expect(nextDimmed).toBe(false);
    });

    it('entity just above EXIT (uvDist=0.14) from dimmed state stays dimmed', () => {
      const { surfaceVis, nextDimmed } = computeSurfaceVis(0.14, true);
      expect(surfaceVis).toBeLessThan(1.0);
      expect(nextDimmed).toBe(true);
    });
  });

  describe('anti-flicker: oscillation around 0.15 does not cause brightness changes', () => {
    it('entity oscillating between 0.14 and 0.16 from bright state stays bright (no flicker)', () => {
      // Both values are within the hysteresis band [EXIT=0.13, ENTER=0.17]
      // From bright state: threshold=0.17, so 0.14 and 0.16 are both BELOW threshold → bright
      const r1 = computeSurfaceVis(0.14, false);
      expect(r1.surfaceVis).toBe(1.0);
      expect(r1.nextDimmed).toBe(false);

      const r2 = computeSurfaceVis(0.16, r1.nextDimmed);
      expect(r2.surfaceVis).toBe(1.0);
      expect(r2.nextDimmed).toBe(false);

      // Entity keeps oscillating — stays bright throughout
      const r3 = computeSurfaceVis(0.14, r2.nextDimmed);
      expect(r3.surfaceVis).toBe(1.0);
    });

    it('entity oscillating between 0.14 and 0.16 from dimmed state stays dimmed (no flicker)', () => {
      // From dimmed state: threshold=0.13, so 0.14 and 0.16 are both ABOVE threshold → dimmed
      const r1 = computeSurfaceVis(0.14, true);
      expect(r1.surfaceVis).toBeLessThan(1.0);
      expect(r1.nextDimmed).toBe(true);

      const r2 = computeSurfaceVis(0.16, r1.nextDimmed);
      expect(r2.surfaceVis).toBeLessThan(1.0);
      expect(r2.nextDimmed).toBe(true);

      const r3 = computeSurfaceVis(0.14, r2.nextDimmed);
      expect(r3.surfaceVis).toBeLessThan(1.0);
    });

    it('without hysteresis, oscillating 0.14/0.16 around 0.15 would flicker', () => {
      // Demonstrate the OLD behavior WITHOUT hysteresis: single threshold at 0.15
      // would produce alternating bright/dimmed states (the bug we fixed)
      function oldComputeSurfaceVis(uvDist: number): number {
        if (uvDist <= SURFACE_NEAR_UV) return 1.0;
        if (uvDist >= SURFACE_FAR_UV) return SURFACE_DIM_OPACITY;
        const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV);
        const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
        return 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY);
      }

      const vis14 = oldComputeSurfaceVis(0.14); // < 0.15 → bright
      const vis16 = oldComputeSurfaceVis(0.16); // > 0.15 → dimmed (however slightly)

      // Old code: bright vs slightly-dimmed on alternate frames
      expect(vis14).toBe(1.0);
      expect(vis16).toBeLessThan(1.0);

      // The new hysteresis code from bright state keeps BOTH at 1.0
      const newR14 = computeSurfaceVis(0.14, false);
      const newR16 = computeSurfaceVis(0.16, newR14.nextDimmed);
      expect(newR14.surfaceVis).toBe(1.0);
      expect(newR16.surfaceVis).toBe(1.0); // key difference vs old code
    });
  });

  describe('transition behavior', () => {
    it('entity moving from near (bright) into dim zone transitions correctly', () => {
      // Start bright, move away from player
      let dimmed = false;
      const distances = [0.05, 0.10, 0.16, 0.18, 0.25, 0.35, 0.45];
      const visibilities: number[] = [];

      for (const d of distances) {
        const r = computeSurfaceVis(d, dimmed);
        visibilities.push(r.surfaceVis);
        dimmed = r.nextDimmed;
      }

      // Should be monotonically non-increasing (no sudden jumps upward while moving away)
      for (let i = 1; i < visibilities.length; i++) {
        expect(visibilities[i]).toBeLessThanOrEqual(visibilities[i - 1] + 0.001); // small tolerance
      }

      // First two (within hysteresis band from bright) should be fully bright
      expect(visibilities[0]).toBe(1.0);
      expect(visibilities[1]).toBe(1.0);
      expect(visibilities[2]).toBe(1.0); // uvDist=0.16 < ENTER=0.17 from bright → stays bright
      // Once past ENTER (0.18), starts dimming
      expect(visibilities[3]).toBeLessThan(1.0);
    });

    it('entity returning from dim zone to bright zone transitions correctly', () => {
      // Start dimmed at 0.45, move back toward player
      let dimmed = true;
      const distances = [0.45, 0.35, 0.25, 0.16, 0.14, 0.12, 0.05];
      const visibilities: number[] = [];

      for (const d of distances) {
        const r = computeSurfaceVis(d, dimmed);
        visibilities.push(r.surfaceVis);
        dimmed = r.nextDimmed;
      }

      // Should be monotonically non-decreasing (brightness increases as entity approaches)
      for (let i = 1; i < visibilities.length; i++) {
        expect(visibilities[i]).toBeGreaterThanOrEqual(visibilities[i - 1] - 0.001);
      }

      // At uvDist=0.16 from dimmed state: threshold=EXIT=0.13, 0.16>0.13 → still dimmed
      expect(visibilities[3]).toBeLessThan(1.0); // 0.16 from dimmed → not yet bright
      // At uvDist=0.14 from dimmed: threshold=0.13, 0.14>0.13 → still dimmed
      expect(visibilities[4]).toBeLessThan(1.0);
      // At uvDist=0.12 from dimmed: threshold=0.13, 0.12<0.13 → returns to bright
      expect(visibilities[5]).toBe(1.0);
    });
  });

  describe('far zone behavior unchanged', () => {
    it('entity beyond SURFACE_FAR_UV gets minimum opacity', () => {
      const { surfaceVis } = computeSurfaceVis(0.46, false);
      expect(surfaceVis).toBe(SURFACE_DIM_OPACITY);
    });

    it('far zone behavior is the same regardless of previous dimmed state', () => {
      const r1 = computeSurfaceVis(0.50, false);
      const r2 = computeSurfaceVis(0.50, true);
      expect(r1.surfaceVis).toBe(SURFACE_DIM_OPACITY);
      expect(r2.surfaceVis).toBe(SURFACE_DIM_OPACITY);
    });
  });
});
