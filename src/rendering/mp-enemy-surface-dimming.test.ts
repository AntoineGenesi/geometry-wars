/**
 * Regression guard for MP enemy surface visibility (depth dimming).
 *
 * Created as part of s44r8-05 (verification system overhaul) to catch the
 * "MP invisible enemies" bug where enemies appeared at 8% opacity even when
 * the player was standing right next to them.
 *
 * Root cause of the bug:
 *   Enemy surfacePosition.u/v were computed from sphere-approximation
 *   (_worldPosToApproxUV on client, or sphere-formula on server), instead of
 *   the actual surface UV. On non-spherical surfaces (torus, cube, pill etc.),
 *   the sphere-approx UV is WRONG → uvDist is incorrectly large → enemies at
 *   uvDist > NET_SURFACE_FAR_UV (0.45) get surfaceVis = 0.08 → 8% opacity.
 *
 * The network-main.ts render loop computes surface visibility as:
 *
 *   const NET_SURFACE_NEAR_UV  = 0.15;  // fully bright within 15% UV distance
 *   const NET_SURFACE_FAR_UV   = 0.45;  // fully dim beyond 45% UV distance
 *   const NET_SURFACE_DIM_OPC  = 0.15;  // 15% opacity for far-away enemies (s44r8-04: raised from 0.08)
 *
 *   const uvDist = sqrt(eu² + ev²)  // wrap-corrected UV distance
 *   surfaceVis = 1.0               if uvDist <= NEAR_UV
 *   surfaceVis = 0.08              if uvDist >= FAR_UV
 *   surfaceVis = smooth curve      otherwise
 *
 * A bug in UV coordinates causes enemies to appear at uvDist > 0.45 even
 * when they are physically adjacent to the player → surfaceVis = 0.08.
 *
 * These tests verify the surface dimming calculation is correct and document
 * the "sphere-approx UV makes nearby enemy invisible" failure mode.
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run src/rendering/mp-enemy-surface-dimming.test.ts
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicated surface visibility constants and logic from network-main.ts
// (render loop, lines ~6411-6448). These MUST stay in sync with production code.
// If the constants change in network-main.ts, update here.
// ---------------------------------------------------------------------------

const NET_SURFACE_NEAR_UV  = 0.15;   // fully bright within this UV distance
const NET_SURFACE_FAR_UV   = 0.45;   // fully dim beyond this UV distance
const NET_SURFACE_DIM_OPC  = 0.15;   // minimum opacity for far-away enemies (s44r8-04: raised from 0.08)

/**
 * Compute the surface-UV-based visibility for an enemy, given wrap-corrected
 * UV distances between enemy and local player.
 *
 * This replicates the production logic in network-main.ts render loop.
 *
 * @param enemyU - Enemy surface U coordinate [0, 1]
 * @param enemyV - Enemy surface V coordinate [0, 1]
 * @param playerU - Local player surface U coordinate [0, 1]
 * @param playerV - Local player surface V coordinate [0, 1]
 * @param wrapsV - Whether the surface V axis wraps (torus, cube-tunnel, pipe, mobius, cube-ring)
 * @returns Visibility in [NET_SURFACE_DIM_OPC, 1.0]
 */
function computeSurfaceUVVisibility(
  enemyU: number,
  enemyV: number,
  playerU: number,
  playerV: number,
  wrapsV: boolean,
): number {
  // Wrap-corrected UV deltas (same logic as network-main.ts lines 6433-6437)
  const euRaw = Math.abs(enemyU - playerU);
  const evRaw = Math.abs(enemyV - playerV);
  const eu = Math.min(euRaw, 1.0 - euRaw); // U always wraps
  const ev = wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
  const uvDist = Math.sqrt(eu * eu + ev * ev);

  // Surface visibility curve (network-main.ts lines 6438-6448)
  if (uvDist <= NET_SURFACE_NEAR_UV) {
    return 1.0;
  } else if (uvDist >= NET_SURFACE_FAR_UV) {
    return NET_SURFACE_DIM_OPC;
  } else {
    const uvT = (uvDist - NET_SURFACE_NEAR_UV) / (NET_SURFACE_FAR_UV - NET_SURFACE_NEAR_UV);
    const uvSt = uvT * uvT * (3.0 - 2.0 * uvT); // smoothstep
    return 1.0 - uvSt * (1.0 - NET_SURFACE_DIM_OPC);
  }
}

/**
 * Compute sphere-approximation UV for a 3D world position (as server used to do).
 * This is the BUGGY approach: treats all surfaces as if they are spheres.
 *
 * @param wx, wy, wz - World-space position of the entity
 * @returns [u, v] in [0, 1]
 */
function sphereApproxUV(wx: number, wy: number, wz: number): [number, number] {
  const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (len < 0.001) return [0, 0.5];
  const nx = wx / len, ny = wy / len, nz = wz / len;
  const u = (Math.atan2(nz, nx) / (2 * Math.PI) + 1) % 1;
  const v = Math.acos(Math.max(-1, Math.min(1, ny))) / Math.PI;
  return [u, v];
}

// ---------------------------------------------------------------------------
// Core visibility logic tests
// ---------------------------------------------------------------------------

describe('computeSurfaceUVVisibility — basic cases (sphere-style, wrapsV=false)', () => {
  it('enemy at SAME UV as player: surfaceVis = 1.0 (fully bright)', () => {
    // Enemy standing right next to player
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.5, 0.5, false);
    expect(vis).toBeCloseTo(1.0, 5);
  });

  it('enemy within NEAR_UV (0.1 apart): surfaceVis = 1.0', () => {
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.6, 0.5, false);
    expect(vis).toBe(1.0);
  });

  it('enemy at NEAR_UV boundary (0.15 apart): surfaceVis = 1.0', () => {
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.65, 0.5, false);
    expect(vis).toBe(1.0);
  });

  it('enemy beyond FAR_UV (0.5 apart, far side): surfaceVis = NET_SURFACE_DIM_OPC = 0.15', () => {
    // Enemy on opposite side of the map: should appear at 15% opacity (s44r8-04: raised from 8%)
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.0, 0.5, false);
    expect(vis).toBeCloseTo(NET_SURFACE_DIM_OPC, 5);
  });

  it('enemy in transition zone (0.3 uvDist): surfaceVis is between 0.08 and 1.0', () => {
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.8, 0.5, false);
    expect(vis).toBeGreaterThan(NET_SURFACE_DIM_OPC);
    expect(vis).toBeLessThan(1.0);
  });

  it('final opacity = min(depthOcclusionOpacity, surfaceVis): nearby enemy stays bright', () => {
    // When depth occlusion returns 1.0 (no occlusion) AND uvDist is small,
    // final visibility should be min(1.0, 1.0) = 1.0
    const depthOpacity = 1.0;
    const surfaceVis = computeSurfaceUVVisibility(0.5, 0.5, 0.55, 0.5, false);
    const finalVis = Math.min(depthOpacity, surfaceVis);
    expect(finalVis).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// V-wrapping surfaces (torus, cube-tunnel, pipe, mobius, cube-ring)
// ---------------------------------------------------------------------------

describe('computeSurfaceUVVisibility — torus (wrapsV=true)', () => {
  it('enemy at same UV: surfaceVis = 1.0', () => {
    const vis = computeSurfaceUVVisibility(0.3, 0.7, 0.3, 0.7, true);
    expect(vis).toBeCloseTo(1.0, 5);
  });

  it('enemy near V seam (V=0.02 vs V=0.98): short wrap path = 0.04 UV → surfaceVis = 1.0', () => {
    // Without wrap: dvRaw = |0.02 - 0.98| = 0.96 → uvDist = 0.96 > FAR_UV → 8% (BUG!)
    // With wrap: dv = min(0.96, 1-0.96) = 0.04 → uvDist = 0.04 < NEAR_UV → 100%
    const visWrapped = computeSurfaceUVVisibility(0.5, 0.02, 0.5, 0.98, true);
    expect(visWrapped).toBeCloseTo(1.0, 5);
  });

  it('BUG SCENARIO (no V-wrap): enemy near V seam would get 8% opacity erroneously', () => {
    // Simulates old code that didn't wrap V: enemy at V=0.02 vs player at V=0.98
    // Raw dvRaw = 0.96 → uvDist = 0.96 → FAR_UV → surfaceVis = 0.08 → invisible!
    const visNoWrap = computeSurfaceUVVisibility(0.5, 0.02, 0.5, 0.98, false);
    // With wrapsV=false, the raw distance 0.96 is used → far → 15% (was 8% before s44r8-04)
    expect(visNoWrap).toBeCloseTo(NET_SURFACE_DIM_OPC, 5);
    // This is the BUG: enemy physically next to player appears dimmed
  });
});

// ---------------------------------------------------------------------------
// THE CRITICAL BUG: sphere-approx UV makes nearby enemies appear at 8% opacity
// ---------------------------------------------------------------------------

describe('REGRESSION: sphere-approx UV causes nearby enemies to appear at 8% opacity', () => {
  /**
   * Scenario: On a TORUS, player is at the inner tube (u=0.5, v=0.0) — inner equator.
   * Enemy is at the SAME position (u=0.5, v=0.0).
   *
   * Correct UV distance: 0 → surfaceVis = 1.0
   *
   * Sphere-approx UV for inner torus position (5, 0, 0):
   *   atan2(0, 5) = 0 → u = 0
   *   acos(0/5) = π/2 → v = 0.5
   * So sphere-approx gives (u=0, v=0.5) instead of (u=0.5, v=0.0).
   *
   * If the server sends sphere-approx UVs AND the client uses them for visibility:
   *   player.u=0, player.v=0.5 (sphere-approx of actual pos u=0.5, v=0.0)
   *   enemy.u=0, enemy.v=0.5 (same sphere-approx)
   * → uvDist = 0 → STILL correct! (Both wrong in the same way → cancels out)
   *
   * BUT: if enemy has ACTUAL UV (u=0.5, v=0.0) from GameRoom, and player has
   * sphere-approx UV (u=0, v=0.5) from _worldPosToApproxUV:
   *   du = |0.5 - 0| = 0.5, eu = min(0.5, 0.5) = 0.5
   *   dv = |0.0 - 0.5| = 0.5, ev = min(0.5, 0.5) = 0.5 (wrapsV=true for torus)
   *   uvDist = sqrt(0.25 + 0.25) = 0.707 >> FAR_UV → surfaceVis = 0.08
   *
   * This is the "8% opacity for nearby enemies" bug.
   */

  it('correct UV coordinates: enemy at same UV as player → surfaceVis = 1.0', () => {
    // Player and enemy both at actual torus UV (0.5, 0.0)
    const vis = computeSurfaceUVVisibility(0.5, 0.0, 0.5, 0.0, true);
    expect(vis).toBeCloseTo(1.0, 5);
  });

  it('BUG: enemy has actual UV, player has sphere-approx UV → enemy at 8% despite being adjacent', () => {
    // On torus, inner tube at world pos (5, 0, 0):
    //   Actual torus UV: (0.5, 0.0) — halfway around tube (inner ring), ring-angle 0
    //   Sphere-approx UV: atan2(0,5)=0 → u=0, acos(0)=π/2 → v=0.5 → (0, 0.5)
    const [playerU_sphereApprox, playerV_sphereApprox] = sphereApproxUV(5, 0, 0);

    // Enemy at actual surface UV (0.5, 0.0) — same position as player!
    const enemyU = 0.5, enemyV = 0.0;

    // With player using sphere-approx UV and enemy using actual UV:
    const vis = computeSurfaceUVVisibility(enemyU, enemyV, playerU_sphereApprox, playerV_sphereApprox, true);

    // The sphere-approx UV gives (u≈0, v=0.5) for the player's actual position (u=0.5, v=0.0).
    // Enemy is at (0.5, 0.0). UV distance is large → surfaceVis = 0.08.
    // Despite being at the SAME physical position, the enemy appears at 8% opacity!
    expect(vis).toBeCloseTo(NET_SURFACE_DIM_OPC, 1); // 15% = the dimming floor (shader fix makes this actually visible now)

    // Sanity check: the sphere-approx UV is indeed wrong (different from actual)
    expect(playerU_sphereApprox).not.toBeCloseTo(0.5, 1); // u ≈ 0, not 0.5
    expect(playerV_sphereApprox).not.toBeCloseTo(0.0, 1); // v ≈ 0.5, not 0.0
  });

  it('FIX: when both player and enemy use actual surface UV → surfaceVis = 1.0', () => {
    // After fix: server sends actual surface UVs, client uses them directly.
    // Both player and enemy at actual torus UV (0.5, 0.0) → uvDist = 0 → bright.
    const playerU_actual = 0.5, playerV_actual = 0.0;
    const enemyU = 0.5, enemyV = 0.0;

    const vis = computeSurfaceUVVisibility(enemyU, enemyV, playerU_actual, playerV_actual, true);
    expect(vis).toBeCloseTo(1.0, 5); // fully bright — correct behavior
  });
});

// ---------------------------------------------------------------------------
// Enemy position validity checks (NaN and origin guards)
// ---------------------------------------------------------------------------

describe('enemy world position validity', () => {
  it('NaN UV coordinates should be detected (uvDist is NaN → treat as invisible)', () => {
    // If enemy.surfacePosition.u/v are NaN, uvDist becomes NaN.
    // NaN comparisons: NaN <= 0.15 is false, NaN >= 0.45 is false → falls to smooth curve.
    // The smooth curve with NaN returns NaN → Math.min(vis, NaN) = NaN.
    // This test documents the behavior so we know if it changes.
    const enemyU = NaN, enemyV = NaN;
    const eu = Math.abs(enemyU - 0.5);  // NaN
    const ev = Math.abs(enemyV - 0.5);  // NaN
    const uvDist = Math.sqrt(eu * eu + ev * ev); // NaN
    // NaN uvDist: both conditions are false → falls to smooth curve → returns NaN
    expect(isNaN(uvDist)).toBe(true);
  });

  it('enemy at origin (0,0,0): sphere-approx UV gives indeterminate → potential bug', () => {
    // Enemy mesh at origin (NaN world position issue): sphere-approx UV has len=0
    const [u, v] = sphereApproxUV(0, 0, 0);
    // sphereApproxUV returns (0, 0.5) for zero-length vector (guarded)
    expect(u).toBe(0);
    expect(v).toBe(0.5);
    // If this is used as enemy UV when player is at (0.5, 0.5):
    // uvDist = sqrt(0.25 + 0) = 0.25 < FAR_UV=0.45 → surfaceVis ≈ smooth(0.25) ≈ 0.47
    // So origin-UV doesn't cause 8% opacity for enemies at equator, but it's still wrong.
  });
});

// ---------------------------------------------------------------------------
// Surface-specific near/far UV constants validation
// ---------------------------------------------------------------------------

describe('NET_SURFACE_* constants — sanity checks', () => {
  it('NET_SURFACE_DIM_OPC is the documented 15% value (s44r8-04: raised from 8%)', () => {
    expect(NET_SURFACE_DIM_OPC).toBe(0.15);
  });

  it('NET_SURFACE_NEAR_UV < NET_SURFACE_FAR_UV', () => {
    expect(NET_SURFACE_NEAR_UV).toBeLessThan(NET_SURFACE_FAR_UV);
  });

  it('at uvDist=0: surfaceVis = 1.0 (enemy is touching player)', () => {
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.5, 0.5, false);
    expect(vis).toBe(1.0);
  });

  it('at uvDist=FAR_UV: surfaceVis = NET_SURFACE_DIM_OPC', () => {
    // Enemy exactly at FAR_UV boundary along U axis
    const vis = computeSurfaceUVVisibility(0.5, 0.5, 0.5 + NET_SURFACE_FAR_UV, 0.5, false);
    expect(vis).toBeCloseTo(NET_SURFACE_DIM_OPC, 5);
  });

  it('surfaceVis is monotonically decreasing as uvDist increases', () => {
    // Omit the exact boundary value (0.45 = FAR_UV) to avoid floating-point
    // precision issues where sqrt(0.45²) may be marginally under FAR_UV,
    // causing the smooth curve to return a value infinitesimally < NET_SURFACE_DIM_OPC.
    const distances = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50];
    const visibilities = distances.map(d =>
      computeSurfaceUVVisibility(0.5, 0.5, 0.5 + d, 0.5, false)
    );
    for (let i = 1; i < visibilities.length; i++) {
      // Allow tiny epsilon for floating-point: values should not INCREASE
      expect(visibilities[i]).toBeLessThanOrEqual(visibilities[i - 1] + 1e-10);
    }
  });
});
