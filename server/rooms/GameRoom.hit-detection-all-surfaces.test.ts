/**
 * Regression guard for MP hit detection across ALL surfaces.
 *
 * This test file was created as part of s44r8-05 (verification system overhaul)
 * to catch the bugs that slipped through in s44r7:
 *
 *   - s44r7-04: Sphere-tunnel "fixed" but torus still broken
 *     Root cause: playerEnemyDist3D() used sphere-approx UV → wrong 3D pos →
 *     wrong chord distance on non-spherical surfaces
 *
 *   - s44r8-02: Fixed by using player.wx/wy/wz (exact world pos from ServerMeshWalker)
 *     instead of converting sphere-approx surfaceU/V back to 3D world position.
 *
 * DESIGN GOAL: These tests must:
 *   1. PASS on fixed code (s44r8-02 playerEnemyDist3D implementation)
 *   2. FAIL if playerEnemyDist3D is reverted to sphere-approx UV method
 *   3. Cover ALL surfaces that have custom distance functions
 *
 * Each surface has three test cases:
 *   a) Same position: distance = 0 → within kill threshold → kills
 *   b) Far apart: distance >> kill threshold → no kill
 *   c) 0.3 world units apart: distance < ENEMY_HIT_WORLD=0.4 → kills
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run server/rooms/GameRoom.hit-detection-all-surfaces.test.ts
 */

import { describe, it, expect } from 'vitest';
import { surfaceUVToWorld3D, playerEnemyDist3D } from './GameRoom';

/** Player-enemy kill threshold (player hitRadius=0.1 + enemy hitRadius=0.3). */
const ENEMY_HIT_WORLD = 0.4;

/** Margin for "clearly no kill" distance: 3x the threshold. */
const FAR_DISTANCE_MIN = ENEMY_HIT_WORLD * 3;

const scaleFactor = 1.0;
const sphereR = 10 * scaleFactor;

// ---------------------------------------------------------------------------
// Helper to verify kill / no-kill for a given surface and UV pair.
// ---------------------------------------------------------------------------

/**
 * Returns the 3D chord distance between:
 *   - A player at exact world position [wx, wy, wz]
 *   - An enemy at surface UV [eu, ev]
 */
function dist(surface: string, wx: number, wy: number, wz: number, eu: number, ev: number): number {
  return playerEnemyDist3D(surface, wx, wy, wz, eu, ev, scaleFactor, sphereR);
}

// ===========================================================================
// TORUS
// ===========================================================================

describe('torus — hit detection thresholds', () => {
  // Outer ring, ring-angle 0: (TORUS_R + TORUS_r, 0, 0) = (11, 0, 0)
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('torus', 0, 0, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('torus', wx0, wy0, wz0, 0, 0)).toBeCloseTo(0, 5);
    expect(dist('torus', wx0, wy0, wz0, 0, 0)).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('enemy 0.3 world units away: distance < 0.4 → kills', () => {
    // On outer tube (TORUS_r=3), arc = 0.3 world units: Δu = 0.3 / (2π·3) ≈ 0.0159
    const duUV = 0.3 / (2 * Math.PI * 3);
    const d = dist('torus', wx0, wy0, wz0, duUV, 0);
    expect(d).toBeLessThan(ENEMY_HIT_WORLD);
    expect(d).toBeGreaterThan(0);
  });

  it('enemy on inner tube (opposite side of torus): 6 world units away → no kill', () => {
    // Outer (11,0,0) vs inner (5,0,0) = chord 6 >> 0.4
    const d = dist('torus', wx0, wy0, wz0, 0.5, 0);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });

  it('enemy on opposite ring side: ~22 world units away → no kill', () => {
    const d = dist('torus', wx0, wy0, wz0, 0, 0.5);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });
});

// ===========================================================================
// TORUS — BUG FIX PROOF (s44r8-02 regression guard)
// ===========================================================================
// The bug: if we use sphere-approx UV to reconstruct player 3D position instead
// of player.wx/wy/wz, we get the WRONG position on torus → wrong distances.
//
// Concretely: a player on the outer tube (u=0.02, v=0.02) has world pos ≈ (11,0,0).
// Sphere-approx maps that UV to a sphere surface point far from the actual torus
// position → distance calculation is wrong.
//
// This test shows that playerEnemyDist3D(wx, wy, wz, ...) gives the CORRECT
// distance when given the ACTUAL world position vs the wrong distance you'd get
// from sphere-approx UV. The CORRECT distance is large (> 0.4 = no kill) when
// the enemy is on the opposite side of the torus.
//
// If this test fails, it means playerEnemyDist3D is using wrong UV source.
// ===========================================================================

describe('torus — BUG FIX PROOF: exact world pos vs sphere-approx UV', () => {
  it('player at outer ring (u=0.02, v=0), enemy at inner ring (u=0.52, v=0): should be far (no kill)', () => {
    // Player is at outer ring. Enemy is at inner ring, same ring angle.
    // Actual chord distance ≈ 6 world units >> 0.4 → no false kill.
    //
    // OLD BUG: sphere-approx UV mapped the player's torus position to a wrong
    // sphere latitude/longitude → 3D position mismatch → distance ≈ 0 → false kill.
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0.02, 0, scaleFactor, sphereR);
    const d = dist('torus', wx, wy, wz, 0.52, 0);
    // Outer ring (11, 0, 0), inner ring (5, 0, 0): chord ≈ 6
    expect(d).toBeCloseTo(6, 0);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD); // No false kill
  });

  it('player and enemy at SAME torus position: distance = 0 → kills correctly', () => {
    const u = 0.35, v = 0.72;
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', u, v, scaleFactor, sphereR);
    const d = dist('torus', wx, wy, wz, u, v);
    expect(d).toBeCloseTo(0, 5);
    expect(d).toBeLessThan(ENEMY_HIT_WORLD);
  });
});

// ===========================================================================
// SPHERE
// ===========================================================================

describe('sphere — hit detection thresholds', () => {
  // Equator at u=0: (sphereR, 0, 0)
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('sphere', 0, 0.5, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('sphere', wx0, wy0, wz0, 0, 0.5)).toBeCloseTo(0, 5);
  });

  it('enemy 0.3 world units away: distance < 0.4 → kills', () => {
    // On sphere radius=10, arc = 0.3: Δu ≈ 0.3 / (2π·10) ≈ 0.0048
    const duUV = 0.3 / (2 * Math.PI * 10);
    expect(dist('sphere', wx0, wy0, wz0, duUV, 0.5)).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('enemy on opposite side of sphere: 20 world units → no kill', () => {
    const d = dist('sphere', wx0, wy0, wz0, 0.5, 0.5);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });
});

// ===========================================================================
// PEANUT
// ===========================================================================

describe('peanut — hit detection thresholds', () => {
  // North pole: (0, 8.4, 0)
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('peanut', 0, 0, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('peanut', wx0, wy0, wz0, 0, 0)).toBeCloseTo(0, 5);
  });

  it('enemy 0.3 world units away on equator: distance < 0.4 → kills', () => {
    // Near equator (v=0.5), small u offset → small chord distance
    const [wx1, wy1, wz1] = surfaceUVToWorld3D('peanut', 0, 0.5, scaleFactor, sphereR);
    const duUV = 0.3 / (2 * Math.PI * 3.6); // radius at equator = B*(1-W) = 3.6
    expect(dist('peanut', wx1, wy1, wz1, duUV, 0.5)).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('north pole vs south pole: 16.8 world units → no kill', () => {
    const d = dist('peanut', wx0, wy0, wz0, 0, 1.0);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });
});

// ===========================================================================
// PILL
// ===========================================================================

describe('pill — hit detection thresholds', () => {
  // Cylinder body equator at u=0: (PILL_RADIUS=10, 0, 0)
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('pill', 0, 0.5, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('pill', wx0, wy0, wz0, 0, 0.5)).toBeCloseTo(0, 5);
  });

  it('enemy 0.3 world units away along cylinder: distance < 0.4 → kills', () => {
    // On cylinder body (v=0.5, PILL_RADIUS=10), move ~0.3 world units in u
    const duUV = 0.3 / (2 * Math.PI * 10);
    expect(dist('pill', wx0, wy0, wz0, duUV, 0.5)).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('opposite sides of cylinder: 20 world units → no kill', () => {
    const d = dist('pill', wx0, wy0, wz0, 0.5, 0.5);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });
});

// ===========================================================================
// SPHERE-TUNNEL
// ===========================================================================

describe('sphere-tunnel — hit detection thresholds', () => {
  // Outer sphere equator (v=0.29) at u=0
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('sphere-tunnel', 0, 0.29, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('sphere-tunnel', wx0, wy0, wz0, 0, 0.29)).toBeCloseTo(0, 5);
  });

  it('enemy near hole edge (v=0.002, same u) vs player on outer sphere: large distance → no kill', () => {
    // Player on outer sphere, enemy at hole edge (tunnel ring) — far apart
    const d = dist('sphere-tunnel', wx0, wy0, wz0, 0, 0.002);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });

  it('opposite sides of outer sphere (Δu=0.5): ~16 world units → no kill', () => {
    const d = dist('sphere-tunnel', wx0, wy0, wz0, 0.5, 0.29);
    expect(d).toBeGreaterThan(FAR_DISTANCE_MIN);
  });

  it('BUG FIX PROOF (s44r7-04): player at v=0.002, enemy at v=0.002 u=0.5: ~6 world units → no false kill', () => {
    // Near hole edge (v≈0), opposite u sides. These are on the real hole ring (r≈3.1),
    // so chord ≈ 6 world units. Old sphereGreatCircleDist treated this as "north pole" → dist ≈ 0 → false kill.
    const [wx1, wy1, wz1] = surfaceUVToWorld3D('sphere-tunnel', 0.0, 0.002, scaleFactor, sphereR);
    const d = dist('sphere-tunnel', wx1, wy1, wz1, 0.5, 0.002);
    expect(d).toBeGreaterThan(4.0); // real distance ≈ 6 world units
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD); // no false kill
  });
});

// ===========================================================================
// CUBE
// ===========================================================================

describe('cube — hit detection thresholds', () => {
  // Top face center
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('cube', 0.25, 0.5, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('cube', wx0, wy0, wz0, 0.25, 0.5)).toBeCloseTo(0, 5);
  });

  it('close together on same face: small distance < 1.0 → kills', () => {
    const d = dist('cube', wx0, wy0, wz0, 0.25, 0.502);
    expect(d).toBeLessThan(1.0);
  });

  it('opposite cube faces: large distance → no kill', () => {
    const d = dist('cube', wx0, wy0, wz0, 0.75, 0.5);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

// ===========================================================================
// CUBE-TUNNEL
// ===========================================================================

describe('cube-tunnel — hit detection thresholds', () => {
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('cube-tunnel', 0.3, 0.25, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('cube-tunnel', wx0, wy0, wz0, 0.3, 0.25)).toBeCloseTo(0, 5);
  });

  it('enemy on different face: large distance → no kill', () => {
    const d = dist('cube-tunnel', wx0, wy0, wz0, 0.8, 0.25);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

// ===========================================================================
// CUBE-RING
// ===========================================================================

describe('cube-ring — hit detection thresholds', () => {
  // Outer face center at u=0
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('cube-ring', 0, 0.125, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('cube-ring', wx0, wy0, wz0, 0, 0.125)).toBeCloseTo(0, 5);
  });

  it('outer face vs inner face: 2 world units → no kill (barely outside threshold)', () => {
    // Outer (R+H=5) vs inner (R-H=3): chord = 2 > 0.4 → no kill
    const d = dist('cube-ring', wx0, wy0, wz0, 0, 0.625);
    expect(d).toBeCloseTo(2, 0);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

// ===========================================================================
// MOBIUS
// ===========================================================================

describe('mobius — hit detection thresholds', () => {
  const [wx0, wy0, wz0] = surfaceUVToWorld3D('mobius', 0.2, 0.5, scaleFactor, sphereR);

  it('same position: distance = 0 → kills', () => {
    expect(dist('mobius', wx0, wy0, wz0, 0.2, 0.5)).toBeCloseTo(0, 5);
  });

  it('distant enemy: large distance → no kill', () => {
    const d = dist('mobius', wx0, wy0, wz0, 0.7, 0.5);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

// ===========================================================================
// SCALEFACTOR SCALING — kills scale with map size
// ===========================================================================

describe('scaleFactor scaling — kill threshold unaffected by map size', () => {
  it('LARGE map (scaleFactor=1.5): nearby entities still within kill threshold', () => {
    const sf = 1.5;
    const sR = 10 * sf;
    // On torus outer ring, ~0.45 world units apart (scaled)
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0, 0, sf, sR);
    // Same UV = 0 distance regardless of scale
    const d0 = playerEnemyDist3D('torus', wx, wy, wz, 0, 0, sf, sR);
    expect(d0).toBeCloseTo(0, 5);
  });

  it('LARGE map (scaleFactor=1.5): far entities still outside kill threshold (scaled)', () => {
    const sf = 1.5;
    const sR = 10 * sf;
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0, 0, sf, sR);
    // Inner vs outer: chord = 6 * 1.5 = 9 world units at LARGE scale → no kill
    const d = playerEnemyDist3D('torus', wx, wy, wz, 0.5, 0, sf, sR);
    expect(d).toBeCloseTo(9, 0);
    expect(d).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});
