/**
 * Regression test: Torus MP bullet direction fix — s44j-10
 *
 * Bug: In multiplayer on torus map, bullets from players on the far half (ring angle ≈ 0)
 * originate near the spawn area instead of the player's actual position.
 *
 * Root cause: network-main.ts used surface.getPoint(ownerPlayer.surfaceU, ownerPlayer.surfaceV)
 * to get tangent vectors for bullet direction. Server's surfaceU/V come from sphere-approx:
 *   u_sphere = atan2(wz, wx) / (2π) ≈ ring angle (= torus v)
 *   v_sphere = acos(wy/r) / π      ≈ something related to tube (= torus u)
 * So sphere-approx u/v are SWAPPED vs torus.getPoint(u, v) where u=tube, v=ring.
 *
 * For a player at far half (ring phi ≈ 0): u_sphere ≈ 0, v_sphere ≈ 0.5.
 * surface.getPoint(0, 0.5) → ring phi = 0.5*2π = π (SPAWN SIDE).
 * This gives tangentV pointing TOWARD spawn instead of away from it,
 * sending bullets toward the spawn area.
 *
 * Fix: Use surface.worldToSurface(ownerWorldPos) to recover correct torus UV,
 * then surface.getPoint(correctUV.u, correctUV.v) for tangent vectors.
 * worldToSurface() correctly identifies ring phi = atan2(z, x) regardless of tube angle.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TorusSurface } from '../surfaces/TorusSurface';

describe('Torus MP bullet direction — s44j-10 regression', () => {
  const R = 6;
  const r = 2;
  const surface = new TorusSurface({ majorRadius: R, minorRadius: r });

  /**
   * Simulate server's _worldPosToApproxUV: sphere parameterization of a world position.
   * This is what server stores as player.surfaceU/V.
   */
  function approxSphereUV(wx: number, wy: number, wz: number): { u: number; v: number } {
    const sphereRadius = 10; // DEFAULT_SURFACE_SCALE
    const u = ((Math.atan2(wz, wx) / (2 * Math.PI)) + 1) % 1; // ring angle → U
    const v = Math.acos(Math.max(-1, Math.min(1, wy / sphereRadius))) / Math.PI; // polar → V
    return { u, v };
  }

  it('sphere-approx UV gives wrong tangent vectors for far-half torus player (demonstrates bug)', () => {
    // Player at far half of torus: ring angle phi ≈ 0 (far from spawn at phi = π).
    // tube angle theta = 0 (equatorial). World position: (R+r, 0, 0) = (8, 0, 0).
    const playerU = 0.0; // tube angle = 0 (correct torus u)
    const playerV = 0.0; // ring angle = 0 (correct torus v) — FAR HALF
    const pt = surface.getPoint(playerU, playerV);
    const wx = pt.position.x;
    const wy = pt.position.y;
    const wz = pt.position.z;

    // Server sphere-approx UV for this position
    const sphereUV = approxSphereUV(wx, wy, wz);

    // getPoint() at sphere-approx UV (current buggy approach)
    const wrongSp = surface.getPoint(sphereUV.u, sphereUV.v);

    // getPoint() at correct UV via worldToSurface (fixed approach)
    const correctUV = surface.worldToSurface(pt.position);
    const correctSp = surface.getPoint(correctUV.u, correctUV.v);

    // Correct tangentV should point in +Z direction (away from spawn at phi=π)
    // tangentV = (-sinPhi, 0, cosPhi) at phi=0 → (0, 0, 1)
    expect(correctSp.tangentV.z).toBeGreaterThan(0.9);
    expect(correctSp.tangentV.z).toBeCloseTo(1.0, 2);

    // Buggy approach: sphere-approx u ≈ ring angle (v in torus), so it looks up
    // ring phi ≈ 0 mapped to sphere-approx u ≈ 0. Then torus.getPoint(u≈0, v≈?)
    // — the sphere-approx v corresponds to the ring angle, but gets used as tube.
    // For a point at (R+r, 0, 0): atan2(0, R+r) = 0, so sphere u ≈ 0;
    // acos(0/10) / π = 0.5, so sphere v ≈ 0.5.
    // getPoint(0, 0.5) → phi = 0.5*2π = π (spawn side!) → tangentV.z = cos(π) = -1
    expect(wrongSp.tangentV.z).toBeLessThan(-0.9); // Points toward spawn — BUG
  });

  it('worldToSurface recovers correct torus UV for far-half player (verifies fix)', () => {
    // Test multiple ring angles on the far half (phi near 0)
    const testCases = [
      { u: 0.0, v: 0.0, label: 'tube=0, ring=0 (far half)' },
      { u: 0.25, v: 0.0, label: 'tube=0.25, ring=0 (far half)' },
      { u: 0.5, v: 0.0, label: 'tube=0.5, ring=0 (far half)' },
      { u: 0.75, v: 0.0, label: 'tube=0.75, ring=0 (far half)' },
      { u: 0.0, v: 0.1, label: 'tube=0, ring=0.1' },
      { u: 0.0, v: 0.9, label: 'tube=0, ring=0.9 (near far half)' },
    ];

    for (const { u, v, label } of testCases) {
      const pt = surface.getPoint(u, v);
      const correctUV = surface.worldToSurface(pt.position);

      // UV should round-trip back to within 0.05 of original
      expect(
        Math.abs(correctUV.u - u),
        `worldToSurface u error at ${label}: got ${correctUV.u.toFixed(3)} expected ${u}`
      ).toBeLessThan(0.05);
      expect(
        Math.abs(correctUV.v - v),
        `worldToSurface v error at ${label}: got ${correctUV.v.toFixed(3)} expected ${v}`
      ).toBeLessThan(0.05);

      // tangentV from correct UV should point in expected ring direction
      const correctSp = surface.getPoint(correctUV.u, correctUV.v);
      const phi = v * Math.PI * 2;
      const expectedTangentVZ = Math.cos(phi);
      expect(
        Math.abs(correctSp.tangentV.z - expectedTangentVZ),
        `tangentV.z mismatch at ${label}: got ${correctSp.tangentV.z.toFixed(3)} expected ${expectedTangentVZ.toFixed(3)}`
      ).toBeLessThan(0.1);
    }
  });

  it('spawn-side player tangent vectors are also correct with worldToSurface', () => {
    // Player at spawn side: ring angle phi = π (v = 0.5)
    const playerU = 0.0;
    const playerV = 0.5; // ring = π (spawn side)
    const pt = surface.getPoint(playerU, playerV);

    const correctUV = surface.worldToSurface(pt.position);
    const correctSp = surface.getPoint(correctUV.u, correctUV.v);

    // tangentV at phi=π: (-sin(π), 0, cos(π)) = (0, 0, -1)
    expect(correctSp.tangentV.z).toBeCloseTo(-1.0, 2);
    expect(correctSp.tangentV.z).toBeLessThan(-0.9);
  });
});
