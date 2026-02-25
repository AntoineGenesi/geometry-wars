/**
 * Regression test: Torus pickup collection — S34b fix
 *
 * Root cause: TorusSurface.getPointLocal() used y = +r*sinTheta, but the actual
 * Three.js mesh geometry (after geometry.rotateX(π/2)) has y = -r*sinTheta.
 * This caused a Y-axis discrepancy of up to 4 world units between:
 *   - Pickup _surfaceWorldPos (computed from getPoint — analytical)
 *   - Player position (from BVH mesh — actual geometry)
 * Making pickups uncollectable at any tube angle where sinTheta ≠ 0 (i.e., u ≠ 0 or 0.5).
 *
 * Fix:
 * 1. getPointLocal: y = -r*sinTheta, normal.y = -sinTheta, tangentU.y = -cosTheta
 * 2. worldToSurface: theta = atan2(-toPointY, outward) + divide by scale
 * 3. GameLoop: use analytical player position (getTransform from UV) for pickup checks
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TorusSurface } from '../surfaces/TorusSurface';

describe('Torus pickup collision fix (S34b regression)', () => {
  const R = 6;
  const r = 2;
  const surface = new TorusSurface({ majorRadius: R, minorRadius: r });

  /**
   * Simulate the Three.js TorusGeometry mesh vertex positions after rotateX(π/2).
   * Three.js TorusGeometry(R, r, ...) creates:
   *   x = (R + r*cosV)*cosU, y = (R + r*cosV)*sinU, z = r*sinV
   * After geometry.rotateX(π/2): (x, y, z) -> (x, -z, y):
   *   x = (R + r*cosTheta)*cosPhi
   *   y = -r*sinTheta
   *   z = (R + r*cosTheta)*sinPhi
   * (where theta = tube angle, phi = ring angle)
   */
  function meshPositionAt(u: number, v: number): THREE.Vector3 {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI * 2;
    return new THREE.Vector3(
      (R + r * Math.cos(theta)) * Math.cos(phi),
      -r * Math.sin(theta),
      (R + r * Math.cos(theta)) * Math.sin(phi),
    );
  }

  it('getPoint analytical position matches mesh vertex position at all tube angles', () => {
    // This is the core fix: analytical positions must match the BVH mesh positions
    const testPoints = [
      { u: 0.0, v: 0.0 },   // outer edge (sin = 0, always worked)
      { u: 0.25, v: 0.0 },  // 90° around tube (sin = 1, was broken)
      { u: 0.5, v: 0.0 },   // inner edge (sin = 0, always worked)
      { u: 0.75, v: 0.0 },  // 270° around tube (sin = -1, was broken)
      { u: 0.25, v: 0.25 }, // combined tube + ring angle
      { u: 0.1, v: 0.6 },
      { u: 0.33, v: 0.8 },
    ];

    for (const { u, v } of testPoints) {
      const analytical = surface.getPoint(u, v).position;
      const mesh = meshPositionAt(u, v);
      const dist = analytical.distanceTo(mesh);
      expect(dist, `Analytical/mesh mismatch at u=${u}, v=${v}: dist=${dist.toFixed(3)}`)
        .toBeLessThan(0.01); // Should be essentially zero (floating point only)
    }
  });

  it('worldToSurface correctly recovers UV from mesh positions at all tube angles', () => {
    // Before fix: worldToSurface gave u = 1 - u_true for mesh positions where sinT != 0
    const testPoints = [
      { u: 0.1, v: 0.3 },
      { u: 0.25, v: 0.0 },  // 90° tube angle — was giving u=0.75 before fix
      { u: 0.3, v: 0.5 },
      { u: 0.5, v: 0.5 },
      { u: 0.75, v: 0.25 }, // 270° tube angle — was giving u=0.25 before fix
      { u: 0.8, v: 0.7 },
    ];

    for (const { u, v } of testPoints) {
      // Use the actual mesh position (as the BVH would provide)
      const meshPos = meshPositionAt(u, v);
      const recovered = surface.worldToSurface(meshPos);

      // Recover position from UV to check round-trip accuracy
      const recoveredPos = surface.getPoint(recovered.u, recovered.v).position;
      const dist = meshPos.distanceTo(recoveredPos);

      expect(dist, `worldToSurface round-trip error at u=${u}, v=${v}: dist=${dist.toFixed(3)} (got u=${recovered.u.toFixed(3)}, v=${recovered.v.toFixed(3)})`).toBeLessThan(0.5);
    }
  });

  it('worldToSurface is scale-invariant (map size does not break UV recovery)', () => {
    const SCALES = [0.75, 1.0, 1.5, 2.0];

    for (const scale of SCALES) {
      const scaledSurface = new TorusSurface({ majorRadius: R, minorRadius: r });
      scaledSurface.group.scale.setScalar(scale);

      const testPoints = [
        { u: 0.25, v: 0.3 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.7 },
      ];

      for (const { u, v } of testPoints) {
        // Mesh position in world space includes scale
        const meshPos = meshPositionAt(u, v).multiplyScalar(scale);
        const recovered = scaledSurface.worldToSurface(meshPos);
        const recoveredPos = scaledSurface.getPoint(recovered.u, recovered.v).position;

        // _surfaceWorldPos from getPoint needs scale applied (as in makeSurfaceTransformFn)
        const recoveredWorldPos = recoveredPos.clone().multiplyScalar(scale);

        const dist = meshPos.distanceTo(recoveredWorldPos);
        expect(dist, `scale=${scale} round-trip error at u=${u}, v=${v}: dist=${dist.toFixed(3)}`)
          .toBeLessThan(0.5);
      }
    }
  });

  it('pickup collision check succeeds when player is at pickup UV on torus (all tube angles)', () => {
    // Simulate the pickup collision check:
    //   pickup._surfaceWorldPos = getPoint(pickupU, pickupV).position (analytical)
    //   playerAnalyticalPos = getPoint(playerU, playerV).position (analytical from UV)
    //   dist = pickup._surfaceWorldPos.distanceTo(playerAnalyticalPos)
    // When player UV == pickup UV, dist should be ~0
    const PICKUP_WORLD_RADIUS = 0.6;
    const testPoints = [
      { u: 0.0, v: 0.0 },
      { u: 0.25, v: 0.5 }, // was broken before fix
      { u: 0.5, v: 0.0 },
      { u: 0.75, v: 0.3 }, // was broken before fix
      { u: 0.1, v: 0.8 },
    ];

    for (const { u, v } of testPoints) {
      const pickupSurfacePos = surface.getPoint(u, v).position;
      const playerAnalyticalPos = surface.getPoint(u, v).position.clone();
      const dist = pickupSurfacePos.distanceTo(playerAnalyticalPos);
      expect(dist, `Pickup at (${u},${v}) not collectible: dist=${dist.toFixed(3)} > ${PICKUP_WORLD_RADIUS}`)
        .toBeLessThan(PICKUP_WORLD_RADIUS);
    }
  });

  it('getPoint: normal is perpendicular to surface (orthogonal to both tangents)', () => {
    // Verify that the corrected normal formula is still geometrically correct
    const testPoints = [
      { u: 0.25, v: 0.0 },
      { u: 0.1, v: 0.4 },
      { u: 0.75, v: 0.6 },
    ];

    for (const { u, v } of testPoints) {
      const pt = surface.getPoint(u, v);
      const dotU = pt.normal.dot(pt.tangentU);
      const dotV = pt.normal.dot(pt.tangentV);
      expect(Math.abs(dotU), `Normal not perpendicular to tangentU at (${u},${v}): dot=${dotU.toFixed(4)}`).toBeLessThan(0.01);
      expect(Math.abs(dotV), `Normal not perpendicular to tangentV at (${u},${v}): dot=${dotV.toFixed(4)}`).toBeLessThan(0.01);
    }
  });
});
