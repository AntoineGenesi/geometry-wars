import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the near-player X-ray visibility boost formula used in RenderLoop.ts.
 * Tested in isolation (pure math, no game context) to avoid DOM/WebGL dependencies.
 *
 * The formula (mirrored from RenderLoop.ts):
 *   if (distToPlayer < NEAR_PLAYER_RADIUS):
 *     t = 1.0 - (distToPlayer / NEAR_PLAYER_RADIUS)   [1.0 at player, 0.0 at radius]
 *     boostFactor = t * t                              [quadratic falloff]
 *     visibility = visibility + boostFactor * (1.0 - visibility)  [additive push toward 1.0]
 */

const NEAR_PLAYER_RADIUS = 8.0; // Must match RenderLoop.ts

/** Pure implementation of the X-ray boost for isolated testing. */
function applyXrayBoost(visibility: number, distToPlayer: number): number {
  if (distToPlayer >= NEAR_PLAYER_RADIUS) return visibility;
  const t = 1.0 - (distToPlayer / NEAR_PLAYER_RADIUS);
  const boostFactor = t * t;
  return visibility + boostFactor * (1.0 - visibility);
}

describe('Near-player X-ray visibility boost formula', () => {
  it('constant NEAR_PLAYER_RADIUS is 8.0 world units', () => {
    expect(NEAR_PLAYER_RADIUS).toBe(8.0);
  });

  it('fully boosts visibility to 1.0 at distance 0 (enemy at player position)', () => {
    expect(applyXrayBoost(0.04, 0)).toBeCloseTo(1.0); // deeply occluded → full bright
    expect(applyXrayBoost(0.12, 0)).toBeCloseTo(1.0); // 1-layer occluded → full bright
    expect(applyXrayBoost(0.0, 0)).toBeCloseTo(1.0);  // invisible → full bright
    expect(applyXrayBoost(1.0, 0)).toBeCloseTo(1.0);  // already bright → stays bright
  });

  it('applies no boost at exactly nearRadius boundary', () => {
    const base = 0.12;
    expect(applyXrayBoost(base, NEAR_PLAYER_RADIUS)).toBe(base);
  });

  it('applies no boost beyond nearRadius', () => {
    const base = 0.04;
    expect(applyXrayBoost(base, NEAR_PLAYER_RADIUS + 0.001)).toBe(base);
    expect(applyXrayBoost(base, NEAR_PLAYER_RADIUS * 2)).toBe(base);
    expect(applyXrayBoost(base, 100)).toBe(base);
  });

  it('uses quadratic falloff at half-radius (t=0.5 → boostFactor=0.25)', () => {
    // At half radius: t=0.5, boostFactor=0.25
    // result = 0 + 0.25 * (1 - 0) = 0.25
    expect(applyXrayBoost(0.0, NEAR_PLAYER_RADIUS * 0.5)).toBeCloseTo(0.25);
  });

  it('quadratic falloff is softer than linear at mid-range', () => {
    // Linear would give t=0.5 boost → 0.5. Quadratic gives t²=0.25 → 0.25.
    // Quadratic should produce LESS boost than linear at half-radius.
    const quadResult = applyXrayBoost(0.0, NEAR_PLAYER_RADIUS * 0.5);
    const linearBoost = 0.5;
    expect(quadResult).toBeLessThan(linearBoost);
  });

  it('boost is additive (deeply occluded enemies reach 1.0 when close)', () => {
    // Multiplicative boost on 0.04 cannot reach 1.0. Additive can.
    expect(applyXrayBoost(0.04, 0)).toBeCloseTo(1.0);
    expect(applyXrayBoost(0.04, 1)).toBeGreaterThan(0.7); // close enemy still very bright
  });

  it('boost is monotonically stronger as distance decreases', () => {
    const base = 0.12;
    let prev = applyXrayBoost(base, NEAR_PLAYER_RADIUS - 0.01);
    for (let dist = NEAR_PLAYER_RADIUS - 0.5; dist >= 0; dist -= 0.5) {
      const current = applyXrayBoost(base, dist);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  it('result is always in [0, 1] range', () => {
    for (let dist = 0; dist <= NEAR_PLAYER_RADIUS + 2; dist += 0.25) {
      const result = applyXrayBoost(0.04, dist);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1.0 + 1e-9); // tiny float tolerance
    }
  });

  it('does not affect enemies outside nearRadius (regression guard)', () => {
    // Enemies far from player must keep occlusion dimming intact
    expect(applyXrayBoost(0.04, 9)).toBe(0.04);
    expect(applyXrayBoost(0.12, 10)).toBe(0.12);
    expect(applyXrayBoost(1.0, 50)).toBe(1.0);
  });
});
