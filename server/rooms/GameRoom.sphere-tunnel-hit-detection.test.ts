/**
 * Regression test for s44r7-04: Sphere-tunnel player hit detection — dying far from enemies
 *
 * Root cause: surfaceWorldDist() falls back to sphereGreatCircleDist() for 'sphere-tunnel'.
 * But sphere-tunnel UV is an arc-length parameterization of a compound profile (outer sphere +
 * bevel + inner tunnel), NOT a latitude/longitude sphere mapping.
 *
 * Near v=0 or v=1 (the hole-edge seam), sphereGreatCircleDist() treats all u values as
 * coincident (both mapped to the "north pole" / "south pole" of its sphere model). Two entities
 * at v≈0 but opposite u values (u=0 vs u=0.5) are actually ~6 world units apart on the hole
 * edge, but sphereGreatCircleDist reports ~0 distance — triggering ENEMY_HIT_WORLD=0.4.
 *
 * Fix: Implement sphereTunnelChordDist() that mirrors SphereWithTunnelSurface geometry and
 * returns accurate 3D chord distance.
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run server/rooms/GameRoom.sphere-tunnel-hit-detection.test.ts
 */

import { describe, it, expect } from 'vitest';
import { sphereGreatCircleDist, sphereTunnelChordDist } from './GameRoom';

// ─── Expected geometry constants (must match SphereWithTunnelSurface.ts defaults) ───
// radius=8, tunnelRadius=2, bevelRadius=0.8, scaleFactor=1.0
// At v≈0 (bottom hole edge): r≈3.11, y≈-7.37 — a real ring, NOT a pole

describe('s44r7-04: sphere-tunnel hit detection — sphereGreatCircleDist gives wrong results', () => {
  /**
   * THE BUG: At v≈0 (hole edge seam), sphereGreatCircleDist() maps to latitude≈0 on its sphere.
   * All u values map to the same "north pole" position → inter-entity distance ≈ 0.
   * But actual sphere-tunnel has a real hole ring of radius ~3.1 — entities at u=0 vs u=0.5
   * are ~6.2 world units apart.
   *
   * This test verifies sphereGreatCircleDist returns a WRONG (too small) distance.
   * It PASSES on current buggy code (confirming the bug exists).
   * After fix, we use sphereTunnelChordDist instead.
   */
  it('BUG: sphereGreatCircleDist returns near-zero for entities at v≈0, u=0 vs u=0.5 (6+ world units apart)', () => {
    // v=0.002 = near hole edge seam. Actual 3D chord ≈ 6.0+ world units (opposite sides of hole ring).
    // sphereGreatCircleDist treats this as latitude ≈ 0.36° from north pole → near-zero.
    const sphereR = 10; // scaleFactor=1
    const dist = sphereGreatCircleDist(0, 0.002, 0.5, 0.002, sphereR);
    // Bug: returns < 0.4 (ENEMY_HIT_WORLD threshold) despite actual distance being ~6 world units
    expect(dist).toBeLessThan(0.4);
  });
});

describe('s44r7-04: sphereTunnelChordDist — accurate 3D chord distance', () => {
  const scaleFactor = 1.0;

  /**
   * REGRESSION TEST: After fix, sphereTunnelChordDist must return accurate distances.
   * This test FAILS on current code (function doesn't exist yet).
   * After fix, this PASSES.
   */

  it('entities at v≈0, u=0 vs u=0.5 should be ~6 world units apart (NOT near-zero)', () => {
    // v=0.002 = near bottom hole edge. Sphere-tunnel hole ring has r≈3.11 at scale 1.
    // Opposite sides of the ring: chord ≈ 2 * 3.11 * sin(π * |Δu|) = 2 * 3.11 ≈ 6.2 units.
    const dist = sphereTunnelChordDist(0, 0.002, 0.5, 0.002, scaleFactor);
    expect(dist).toBeGreaterThan(4.0); // must be much larger than ENEMY_HIT_WORLD=0.4
    expect(dist).toBeLessThan(10.0);   // but still bounded
  });

  it('close entities on outer sphere (v≈0.3, same u, Δv=0.02) are < 2 world units', () => {
    // Small V separation on outer sphere (radius≈8): arc ≈ R * Δv * (2π * totalPerimeter / totalPerimeter)
    // Expected roughly: Δv=0.02 → arc ≈ 0.7 world units
    const dist = sphereTunnelChordDist(0.5, 0.3, 0.5, 0.32, scaleFactor);
    expect(dist).toBeLessThan(2.0);
    expect(dist).toBeGreaterThan(0.0);
  });

  it('player on outer sphere (v=0.29) vs enemy across sphere (v=0.29, Δu=0.5) is ~16 world units', () => {
    // Equator of outer sphere (max radius ≈ 8), opposite sides: chord ≈ 2*8 = 16
    const dist = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, scaleFactor);
    expect(dist).toBeGreaterThan(12.0);
    expect(dist).toBeLessThan(20.0);
  });

  it('entity on outer sphere (v=0.29) vs entity in tunnel (v=0.75, same u) is > 5 world units', () => {
    // Outer sphere equator (r≈8, y≈0) vs tunnel (r≈2, y≈0): chord ≈ 6 world units
    const dist = sphereTunnelChordDist(0.0, 0.29, 0.0, 0.75, scaleFactor);
    expect(dist).toBeGreaterThan(3.0);
    expect(dist).toBeLessThan(14.0);
  });

  it('entities close together in tunnel (same u, v=0.75 vs v=0.77) are < 3 world units', () => {
    // Inside tunnel: tiny V change → small world distance
    const dist = sphereTunnelChordDist(0.0, 0.75, 0.0, 0.77, scaleFactor);
    expect(dist).toBeLessThan(3.0);
    expect(dist).toBeGreaterThanOrEqual(0.0);
  });

  it('scaleFactor=1.5 scales distances proportionally', () => {
    const dist1 = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, 1.0);
    const dist15 = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, 1.5);
    // Should scale linearly with scaleFactor
    expect(dist15 / dist1).toBeCloseTo(1.5, 1);
  });

  it('distance is symmetric', () => {
    const d1 = sphereTunnelChordDist(0.1, 0.3, 0.6, 0.7, scaleFactor);
    const d2 = sphereTunnelChordDist(0.6, 0.7, 0.1, 0.3, scaleFactor);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('same point returns zero distance', () => {
    const dist = sphereTunnelChordDist(0.3, 0.5, 0.3, 0.5, scaleFactor);
    expect(dist).toBeCloseTo(0, 6);
  });
});
