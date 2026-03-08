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
