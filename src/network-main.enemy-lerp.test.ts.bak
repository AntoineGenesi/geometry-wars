/**
 * s44r2-03 Regression: Enemy UV lerp must take the SHORT path across UV seams.
 *
 * Without fix: lerp goes the LONG way when enemy crosses U=0/1 seam or V=0/1 seam (torus).
 * Example: enemy at U=0.98 moving to U=0.02 (just wrapped) — buggy lerp goes 0.96 UV units
 * backward instead of 0.04 UV units forward, causing rubber-banding across the whole surface.
 *
 * With fix: wrap-aware delta chooses the shortest path, capping rubber-band effect.
 */

import { describe, it, expect } from 'vitest';

// -----------------------------------------------------------------------
// Extracted lerp logic — mirrors the fix applied in network-main.ts
// -----------------------------------------------------------------------

/**
 * Compute the shortest UV delta accounting for seam wrapping.
 * @param current  Current UV coordinate (0-1)
 * @param target   Target UV coordinate (0-1)
 * @param wraps    Whether this axis wraps (U always wraps, V only on torus/etc.)
 */
function wrapAwareDelta(current: number, target: number, wraps: boolean): number {
  let d = target - current;
  if (wraps && Math.abs(d) > 0.5) d -= Math.sign(d);
  return d;
}

/**
 * Apply one lerp step toward target, wrap-aware.
 * Returns the new UV value (clamped or wrapped as appropriate).
 */
function lerpUV(current: number, target: number, lerp: number, wraps: boolean): number {
  const delta = wrapAwareDelta(current, target, wraps);
  const next = current + delta * lerp;
  if (wraps) return ((next % 1) + 1) % 1;
  return next;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('enemy UV lerp wrap-aware (s44r2-03)', () => {
  describe('U axis (always wraps)', () => {
    it('takes the SHORT path when enemy crosses U=0/1 seam going forward (0.98 → 0.02)', () => {
      // Enemy at U=0.98, server reports U=0.02 (enemy just crossed the seam forward)
      // Buggy path: 0.98 → 0.02 = delta -0.96 (long way backward)
      // Fixed path: 0.98 → 1.02 → 0.02 = delta +0.04 (short way forward, wraps)
      const current = 0.98;
      const target = 0.02;

      // Buggy direct delta takes the long way
      const buggyDelta = target - current; // -0.96
      expect(Math.abs(buggyDelta)).toBeGreaterThan(0.5);

      // Fixed delta takes the short way
      const fixedDelta = wrapAwareDelta(current, target, true);
      expect(fixedDelta).toBeCloseTo(0.04, 5);
      expect(Math.abs(fixedDelta)).toBeLessThan(0.5);
    });

    it('takes the SHORT path when enemy crosses U=0/1 seam going backward (0.02 → 0.98)', () => {
      const current = 0.02;
      const target = 0.98;

      const buggyDelta = target - current; // 0.96
      expect(Math.abs(buggyDelta)).toBeGreaterThan(0.5);

      const fixedDelta = wrapAwareDelta(current, target, true);
      expect(fixedDelta).toBeCloseTo(-0.04, 5);
      expect(Math.abs(fixedDelta)).toBeLessThan(0.5);
    });

    it('does NOT wrap when enemy is moving normally (no seam crossing)', () => {
      const current = 0.3;
      const target = 0.5;
      const delta = wrapAwareDelta(current, target, true);
      expect(delta).toBeCloseTo(0.2, 5);
    });

    it('lerped UV stays in [0,1] range after wrapping forward', () => {
      const current = 0.98;
      const target = 0.02;
      const lerp = 0.35;
      const next = lerpUV(current, target, lerp, true);
      // With wrap-aware delta of +0.04, step = 0.04 * 0.35 = 0.014
      // next = 0.98 + 0.014 = 0.994 (still in [0,1])
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(1);
      expect(next).toBeCloseTo(0.994, 3);
    });

    it('lerped UV wraps correctly when it crosses 1.0', () => {
      // Enemy at U=0.99, target U=0.01
      // delta = 0.02, step = 0.02 * 1.0 = 0.02 (lerp=1 for easy math)
      // next = 0.99 + 0.02 = 1.01 → wrapped = 0.01
      const current = 0.99;
      const target = 0.01;
      const lerp = 1.0; // instant convergence for test
      const next = lerpUV(current, target, lerp, true);
      expect(next).toBeCloseTo(0.01, 3);
    });
  });

  describe('V axis (wraps on torus, no-wrap on sphere)', () => {
    it('V wraps on torus: takes short path across V seam', () => {
      const current = 0.97;
      const target = 0.03;
      const fixedDelta = wrapAwareDelta(current, target, true); // wraps=true (torus)
      expect(fixedDelta).toBeCloseTo(0.06, 5);
      expect(Math.abs(fixedDelta)).toBeLessThan(0.5);
    });

    it('V does NOT wrap on sphere: takes direct path', () => {
      // On sphere, V=0 is north pole, V=1 is south pole — cannot wrap
      const current = 0.97;
      const target = 0.03;
      const delta = wrapAwareDelta(current, target, false); // wraps=false (sphere)
      // Goes the long way (from 0.97 down to 0.03 = -0.94)
      expect(delta).toBeCloseTo(-0.94, 5);
    });
  });

  describe('Mobius half-twist snap (s44r22-19)', () => {
    // On Mobius, crossing the U=0/1 seam inverts V (the half-twist).
    // When dv > 0.3 on Mobius, we SNAP V instead of lerping to avoid
    // intermediate V values that place enemies inside the surface geometry,
    // causing depth occlusion to dim them to near-invisible.

    /**
     * Mobius-aware lerp step. Mirrors the fix in network-main.ts.
     * @param currentU Current U
     * @param currentV Current V
     * @param targetU Target U
     * @param targetV Target V
     * @param lerp Lerp factor (0-1)
     * @param isMobius Whether this is a Mobius surface
     * @param wrapsV Whether V wraps (false for Mobius)
     */
    function mobiusLerpStep(
      currentU: number, currentV: number,
      targetU: number, targetV: number,
      lerp: number,
      isMobius: boolean,
      wrapsV: boolean
    ): { u: number; v: number } {
      let du = targetU - currentU;
      if (Math.abs(du) > 0.5) du -= Math.sign(du);
      let dv = targetV - currentV;
      if (wrapsV && Math.abs(dv) > 0.5) dv -= Math.sign(dv);

      let snapV = false;
      if (isMobius && Math.abs(dv) > 0.3) {
        snapV = true;
      }

      const newU = currentU + du * lerp;
      const newV = snapV ? targetV : (currentV + dv * lerp);

      const u = ((newU % 1) + 1) % 1;
      let v: number;
      if (isMobius) {
        v = Math.max(0.02, Math.min(0.98, newV));
      } else {
        v = wrapsV ? ((newV % 1) + 1) % 1 : newV;
      }
      return { u, v };
    }

    it('snaps V when dv > 0.3 on Mobius (half-twist crossing)', () => {
      // Enemy at (u=0.98, v=0.3), server sends (u=0.02, v=0.7) — crossed U seam, V inverted
      const result = mobiusLerpStep(0.98, 0.3, 0.02, 0.7, 0.35, true, false);
      // V should SNAP to target (0.7), not lerp through intermediate values
      expect(result.v).toBe(0.7);
    });

    it('does NOT snap V for small dv on Mobius (normal movement)', () => {
      // Enemy moving normally on Mobius (small V change)
      const result = mobiusLerpStep(0.5, 0.4, 0.52, 0.42, 0.35, true, false);
      // V should lerp normally: 0.4 + 0.02 * 0.35 = 0.407
      expect(result.v).toBeCloseTo(0.407, 3);
      expect(result.v).not.toBe(0.42); // NOT snapped
    });

    it('clamps V to [0.02, 0.98] on Mobius (strip edges)', () => {
      // V drifting past 1.0 edge
      const result = mobiusLerpStep(0.5, 0.97, 0.52, 1.05, 0.35, true, false);
      expect(result.v).toBeLessThanOrEqual(0.98);
      expect(result.v).toBeGreaterThanOrEqual(0.02);
    });

    it('clamps V to [0.02, 0.98] on Mobius (negative edge)', () => {
      // V drifting below 0.0 edge
      const result = mobiusLerpStep(0.5, 0.03, 0.52, -0.05, 0.35, true, false);
      expect(result.v).toBeGreaterThanOrEqual(0.02);
    });

    it('does NOT snap V on non-Mobius surface even with large dv', () => {
      // On sphere (non-Mobius), large V delta is just normal lerp
      const result = mobiusLerpStep(0.5, 0.2, 0.52, 0.8, 0.35, false, false);
      // V should lerp: 0.2 + 0.6 * 0.35 = 0.41
      expect(result.v).toBeCloseTo(0.41, 3);
      expect(result.v).not.toBe(0.8); // NOT snapped
    });

    it('prevents invisible enemies: V stays within valid range after twist', () => {
      // Simulate multiple frames of an enemy crossing the Mobius twist
      let u = 0.96, v = 0.3;
      const targetU = 0.04, targetV = 0.7; // Post-twist target
      const lerp = 0.35;

      for (let i = 0; i < 10; i++) {
        const result = mobiusLerpStep(u, v, targetU, targetV, lerp, true, false);
        // V must ALWAYS be in valid range (never inside surface)
        expect(result.v).toBeGreaterThanOrEqual(0.02);
        expect(result.v).toBeLessThanOrEqual(0.98);
        u = result.u;
        v = result.v;
      }
      // After 10 frames, should have converged near target
      expect(u).toBeCloseTo(targetU, 1);
      expect(v).toBeCloseTo(targetV, 1);
    });
  });

  describe('no-op cases', () => {
    it('returns 0 delta when already at target', () => {
      expect(wrapAwareDelta(0.5, 0.5, true)).toBe(0);
      expect(wrapAwareDelta(0.0, 0.0, true)).toBe(0);
    });

    it('handles exactly 0.5 delta (ambiguous — either direction is same distance)', () => {
      // At exactly 0.5, Math.abs(d) === 0.5 — wrap condition not triggered
      // This is edge case; both directions are equal-length
      const delta = wrapAwareDelta(0.0, 0.5, true);
      expect(Math.abs(delta)).toBeCloseTo(0.5, 5);
    });
  });
});
