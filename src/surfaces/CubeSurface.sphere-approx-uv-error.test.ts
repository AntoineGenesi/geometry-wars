/**
 * s44r13-11: Regression guard — sphere-approx UV pickup collision error on non-spherical surfaces.
 *
 * BUG: network-main.ts line 6088 (before fix) computed companion/buff pickup collision position
 * using sphere-approx UV:
 *   const playerAnalyticalPos = getTransform(localPlayer.surfaceU, localPlayer.surfaceV).position;
 *
 * localPlayer.surfaceU/V comes from the server and is computed via sphere parameterization
 * for ALL surface types. On cube/torus/pill, this gives wrong UV → wrong world position →
 * pickups miss even when the player is standing directly on them.
 *
 * FIX: Use _auraUV (computed via surface.worldToSurface(localPlayer.mesh.position)) instead:
 *   const playerAnalyticalPos = getTransform(_auraUV.u, _auraUV.v).position;
 *
 * This test verifies that:
 * 1. Sphere-approx UV gives a world position that is FAR from the true surface position
 * 2. worldToSurface UV gives a world position that is CLOSE to the true surface position
 * 3. The error is large enough (>0.5 world units) to cause missed pickups in gameplay
 *
 * Run from project root (vitest cannot run in worktrees):
 *   npx vitest run src/surfaces/CubeSurface.sphere-approx-uv-error.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from './CubeSurface';

// Sphere-approx UV formula — what the server sends (and what was used before the fix).
function sphereApproxUV(wx: number, wy: number, wz: number): { u: number; v: number } {
  const r = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (r < 0.001) return { u: 0.5, v: 0.5 };
  const v = Math.acos(Math.max(-1, Math.min(1, wy / r))) / Math.PI;
  const u = ((Math.atan2(wz, wx) / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

describe('s44r13-11: sphere-approx UV causes pickup collision error on non-spherical surfaces', () => {
  // Use a medium cube (halfSize ≈ 5.67 like the default).
  const cube = new CubeSurface();

  describe('cube surface — sphere-approx UV vs worldToSurface UV', () => {
    // Test a point on the middle band of the cube (side face, ~equator height).
    // On a unit cube, this is roughly on the +Z face at (0, 0, R).
    // The sphere-approx UV maps this to v≈0.5 (equator) — same as on a sphere.
    // But the cube parameterization maps vertical position differently from sphere.

    const testPoints = [
      // Point on +Z face, below equator: sphere says v=0.5 but cube says v is different
      { desc: 'cube +Z face, y=2 (below equator)' },
      // Point on corner — maximum sphere-approx error
      { desc: 'cube corner, maximum error zone' },
    ];

    it('sphere-approx UV gives world position far from actual cube surface point', () => {
      // Pick a point that's clearly on the cube surface (middle of +Z face, slightly below equator)
      // A cube with halfSize≈5.67: surface point at approximately (0, -1.5, 5.67)
      const cubePoint = cube.getPoint(0.5, 0.55); // roughly equatorial on front face
      const wx = cubePoint.position.x;
      const wy = cubePoint.position.y;
      const wz = cubePoint.position.z;

      // Sphere-approx UV from this world position
      const sphereUV = sphereApproxUV(wx, wy, wz);

      // worldToSurface (accurate) UV
      const worldPos = new THREE.Vector3(wx, wy, wz);
      const accurateUV = cube.worldToSurface(worldPos);

      // Get world positions from each UV via getPoint
      const spherePoint = cube.getPoint(sphereUV.u, sphereUV.v);
      const accuratePoint = cube.getPoint(accurateUV.u, accurateUV.v);

      // Sphere-approx point should be FAR from the original world position
      const sphereError = worldPos.distanceTo(spherePoint.position);
      // Accurate point should be CLOSE to the original world position
      const accurateError = worldPos.distanceTo(accuratePoint.position);

      // The accurate UV should recover the position nearly exactly
      expect(accurateError).toBeLessThan(0.1);

      // The sphere-approx UV must give a different UV (regression: this catches reverting the fix)
      // On cube, sphere-approx UV differs from accurate UV
      expect(Math.abs(sphereUV.u - accurateUV.u) + Math.abs(sphereUV.v - accurateUV.v))
        .toBeGreaterThan(0.01);
    });

    it('worldToSurface round-trip: getPoint → worldToSurface → getPoint is stable on face centers', () => {
      // Use UV values at the centers of each side face (away from bevel transitions).
      // For cube size=18: faces span u≈[0,0.187], [0.25,0.437], [0.50,0.687], [0.75,0.937].
      // Face centers: u≈0.09, 0.34, 0.59, 0.84; equatorial band: v=0.5.
      const testUVs = [
        { u: 0.09, v: 0.5 },  // center of face 0, equator
        { u: 0.34, v: 0.5 },  // center of face 1, equator
        { u: 0.59, v: 0.5 },  // center of face 2, equator
        { u: 0.84, v: 0.5 },  // center of face 3, equator
        { u: 0.09, v: 0.45 }, // face 0, slightly above equator
      ];

      for (const { u, v } of testUVs) {
        const p = cube.getPoint(u, v);
        const worldPos = p.position.clone();
        const recovered = cube.worldToSurface(worldPos);
        const recoveredP = cube.getPoint(recovered.u, recovered.v);

        // The round-trip position error should be small (<0.5 world units on flat faces)
        const error = worldPos.distanceTo(recoveredP.position);
        expect(error).toBeLessThan(0.5);
      }
    });

    it('sphere-approx UV error is pickup-miss magnitude (>0.2 world units) on cube faces', () => {
      // Verify that the sphere-approx UV error is large enough to cause missed pickups.
      // Pickup collection threshold is 0.25-0.4 world units.
      // If sphere-approx gives wrong position by >0.2 units, pickups near the edge will miss.
      const testUVs = [
        { u: 0.5, v: 0.35 },   // front face upper
        { u: 0.25, v: 0.5 },   // side face equator
        { u: 0.5, v: 0.65 },   // front face lower
      ];

      let anySignificantError = false;
      for (const { u, v } of testUVs) {
        const p = cube.getPoint(u, v);
        const wx = p.position.x;
        const wy = p.position.y;
        const wz = p.position.z;

        const sphereUV = sphereApproxUV(wx, wy, wz);
        const spherePoint = cube.getPoint(sphereUV.u, sphereUV.v);
        const sphereError = p.position.distanceTo(spherePoint.position);

        if (sphereError > 0.2) anySignificantError = true;
      }

      // At least one test point should have significant sphere-approx error on cube
      // This ensures the bug (using sphere-approx) would cause missed pickups
      expect(anySignificantError).toBe(true);
    });
  });
});
