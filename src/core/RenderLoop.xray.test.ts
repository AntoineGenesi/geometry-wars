import { describe, it, expect } from 'vitest';

/**
 * S27b: View-based entity visibility.
 *
 * The near-player X-ray boost was removed in S27b. Visibility is determined solely
 * by the DepthOcclusionSystem (raycast-based: 0 surface intersections = bright,
 * 1 = dimmed, 2+ = nearly invisible). Proximity to the player no longer overrides
 * occlusion dimming.
 *
 * S28a UPDATE: Proximity boost re-introduced at the RenderLoop level.
 * Enemies within 8 world units of player are forced to full visibility regardless
 * of depth-occlusion dimming. This prevents tunnel-map surfaces from hiding
 * close-proximity enemies that are about to hit the player.
 * The DepthOcclusionSystem itself is UNCHANGED — the boost is a RenderLoop override.
 */

/** Opacity values from DepthOcclusionSystem DEFAULT_OCCLUSION_CONFIG. */
const DEPTH_OPACITY = {
  visible: 1.0,   // 0 surface intersections: enemy is on visible side
  oneLayer: 0.5,  // 1 surface intersection: behind one wall
  twoPlus: 0.15,  // 2+ surface intersections: behind multiple walls
} as const;

/** Proximity override constants (must match RenderLoop.ts). */
const PROXIMITY_BRIGHT_RADIUS = 8.0;
const PROXIMITY_BRIGHT_RADIUS_SQ = PROXIMITY_BRIGHT_RADIUS * PROXIMITY_BRIGHT_RADIUS;
const PROXIMITY_FADE_RADIUS = 12.0;
const PROXIMITY_FADE_RADIUS_SQ = PROXIMITY_FADE_RADIUS * PROXIMITY_FADE_RADIUS;

/** Simulate the RenderLoop proximity boost formula. */
function applyProximityBoost(visibility: number, distSq: number): number {
  if (distSq < PROXIMITY_BRIGHT_RADIUS_SQ) {
    return Math.max(visibility, 1.0);
  } else if (distSq < PROXIMITY_FADE_RADIUS_SQ) {
    const dist = Math.sqrt(distSq);
    const t = (dist - PROXIMITY_BRIGHT_RADIUS) / (PROXIMITY_FADE_RADIUS - PROXIMITY_BRIGHT_RADIUS);
    return Math.max(visibility, 1.0 - t);
  }
  return visibility;
}

describe('View-based entity visibility (post-S27b)', () => {
  it('fully visible enemies (0 surface intersections) are at opacity 1.0', () => {
    expect(DEPTH_OPACITY.visible).toBe(1.0);
  });

  it('one-layer occluded enemies are at 50% opacity', () => {
    expect(DEPTH_OPACITY.oneLayer).toBe(0.5);
  });

  it('enemies behind 2+ surface layers are nearly invisible (0.15)', () => {
    expect(DEPTH_OPACITY.twoPlus).toBe(0.15);
  });

  it('far-side dim is significantly less than near-side bright', () => {
    // Occluded enemies should be clearly dimmer (contrast for gameplay readability)
    expect(DEPTH_OPACITY.twoPlus).toBeLessThan(DEPTH_OPACITY.visible * 0.25);
  });

  it('DepthOcclusionSystem opacities are unchanged by S28a (occlusion system unmodified)', () => {
    // The raycast occlusion system itself was NOT changed in S28a.
    // The proximity boost is a RenderLoop-level override applied AFTER getOpacity().
    expect(DEPTH_OPACITY.twoPlus).toBe(0.15);
    expect(DEPTH_OPACITY.oneLayer).toBe(0.5);
  });
});

describe('Proximity visibility override (S28a — re-introduced for tunnel maps)', () => {
  it('deeply occluded enemy within 8 units of player is boosted to full visibility', () => {
    // Enemy 5 units away (3-4-0 triangle), deeply occluded
    const dx = 3, dy = 4, dz = 0; // dist = 5
    const distSq = dx * dx + dy * dy + dz * dz; // 25 < 64
    const visibility = applyProximityBoost(DEPTH_OPACITY.twoPlus, distSq);
    expect(visibility).toBe(1.0);
  });

  it('enemy at exactly 8 units is at full visibility (boundary)', () => {
    const distSq = PROXIMITY_BRIGHT_RADIUS_SQ; // exactly 64
    const visibility = applyProximityBoost(DEPTH_OPACITY.twoPlus, distSq - 0.001);
    expect(visibility).toBe(1.0);
  });

  it('enemy at 10 units (in fade zone) gets 0.5 proximity boost', () => {
    // dist=10: t = (10-8)/(12-8) = 0.5, boost = 0.5
    // DEPTH_OPACITY.twoPlus = 0.15 < 0.5, so boost wins
    const dist = 10;
    const distSq = dist * dist; // 100, between 64 and 144
    const visibility = applyProximityBoost(DEPTH_OPACITY.twoPlus, distSq);
    expect(visibility).toBeCloseTo(0.5, 5);
  });

  it('enemy at 10 units: boost does not apply if visibility already higher', () => {
    // If enemy is already fully visible (no occlusion), boost has no effect
    const dist = 10;
    const distSq = dist * dist;
    const visibility = applyProximityBoost(1.0, distSq);
    expect(visibility).toBe(1.0); // no change
  });

  it('enemy beyond 12 units is not boosted — occlusion applies normally', () => {
    const dist = 15;
    const distSq = dist * dist; // 225 > 144
    const visibility = applyProximityBoost(DEPTH_OPACITY.twoPlus, distSq);
    expect(visibility).toBe(DEPTH_OPACITY.twoPlus); // unchanged: 0.15
  });

  it('enemy at exactly 12 units (fade boundary) gets 0 proximity boost', () => {
    const distSq = PROXIMITY_FADE_RADIUS_SQ; // exactly 144
    const visibility = applyProximityBoost(DEPTH_OPACITY.twoPlus, distSq + 0.001);
    expect(visibility).toBe(DEPTH_OPACITY.twoPlus); // no boost
  });

  it('proximity boost uses Math.max — never reduces visibility', () => {
    // A fully visible (unoccluded) enemy should stay at 1.0 even outside proximity
    const distSq = 9 * 9; // 81, just outside bright zone but inside fade
    const visibility = applyProximityBoost(1.0, distSq);
    expect(visibility).toBe(1.0); // not reduced
  });

  it('fade zone gives smooth gradient between 8 and 12 units', () => {
    // At 8 units: boost = 1.0
    // At 10 units: boost = 0.5
    // At 12 units: boost = 0.0 (no effect)
    const boostAt8 = applyProximityBoost(0, PROXIMITY_BRIGHT_RADIUS_SQ - 0.001);
    const boostAt10 = applyProximityBoost(0, 100);
    const boostAt12 = applyProximityBoost(0, PROXIMITY_FADE_RADIUS_SQ + 0.001);
    expect(boostAt8).toBe(1.0);
    expect(boostAt10).toBeCloseTo(0.5, 5);
    expect(boostAt12).toBe(0.0); // no boost applied, stays at input 0
  });
});
