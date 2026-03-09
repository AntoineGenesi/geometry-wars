/**
 * Regression test: Cube MP aim must use worldToSurface-corrected UV
 *
 * Bug (s44r5-02): Server sends surfaceU/V as sphere-approximation
 * (u=atan2(z,x)/2π, v=acos(y/r)/π). For cube, this maps top-face
 * positions to wrong UV regions, producing incorrect tangent frames.
 *
 * Fix: use surface.worldToSurface() for all surfaces in the aim pipeline.
 *
 * This test verifies that the aim angle computed via worldToSurface path
 * is correct on all 6 cube faces, while the sphere-approx path is wrong.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { computeCameraRelativeAimAngle } from '../utils/aimAngle';

describe('Cube MP aim: worldToSurface vs sphere-approx UV', () => {
  const cube = new CubeSurface({ size: 18 });

  /** Sphere-approximation UV (what the server sends) */
  function sphereApproxUV(pos: THREE.Vector3): { u: number; v: number } {
    const r = Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2);
    if (r < 0.001) return { u: 0.5, v: 0.5 };
    const v = Math.acos(Math.max(-1, Math.min(1, pos.y / r))) / Math.PI;
    const u = ((Math.atan2(pos.z, pos.x) / (2 * Math.PI)) + 1) % 1;
    return { u, v };
  }

  /** Simulate camera for a given surface normal */
  function makeCamera(normal: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
    const lookDir = normal.clone().negate();
    const worldUp = Math.abs(normal.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(worldUp, lookDir).normalize();
    const up = new THREE.Vector3().crossVectors(lookDir.negate(), right).normalize();
    return { right, up };
  }

  const facePositions = [
    { name: 'top (+Y)', pos: new THREE.Vector3(2, 9, 2) },
    { name: 'bottom (-Y)', pos: new THREE.Vector3(2, -9, 2) },
    { name: 'front (+Z)', pos: new THREE.Vector3(2, 2, 9) },
    { name: 'right (+X)', pos: new THREE.Vector3(9, 2, 0) },
    { name: 'back (-Z)', pos: new THREE.Vector3(0, 2, -9) },
    { name: 'left (-X)', pos: new THREE.Vector3(-9, 2, 0) },
  ];

  for (const { name, pos } of facePositions) {
    it(`${name}: worldToSurface aim produces 4 distinct directions`, () => {
      const uv = cube.worldToSurface(pos);
      const sp = cube.getPoint(uv.u, uv.v);
      const cam = makeCamera(sp.normal);

      const mouseInputs = [
        { mx: 1, my: 0, label: 'right' },
        { mx: 0, my: -1, label: 'up' },
        { mx: -1, my: 0, label: 'left' },
        { mx: 0, my: 1, label: 'down' },
      ];

      const angles = mouseInputs.map(({ mx, my }) =>
        computeCameraRelativeAimAngle(
          mx, my,
          cam.right.clone(), cam.up.clone(),
          sp.normal.clone(), sp.tangentU.clone(), sp.tangentV.clone(),
        ),
      );

      // All 4 directions should produce ~90° separation
      for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
          let diff = Math.abs(angles[i] - angles[j]);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          expect(diff).toBeGreaterThan(Math.PI / 4); // > 45°
        }
      }
    });
  }

  it('sphere-approx UV gives wrong tangent frame on top face (proves the bug)', () => {
    const topPos = new THREE.Vector3(2, 9, 2);

    // Correct path: worldToSurface
    const correctUV = cube.worldToSurface(topPos);
    const correctSP = cube.getPoint(correctUV.u, correctUV.v);

    // Buggy path: sphere-approximation
    const buggyUV = sphereApproxUV(topPos);
    const buggySP = cube.getPoint(buggyUV.u, buggyUV.v);

    // The sphere-approx UV should map to a completely different region of the cube
    // Top face is v ≈ 0.9-1.0 in cube UV, but sphere-approx gives v ≈ 0.1
    expect(Math.abs(correctUV.v - buggyUV.v)).toBeGreaterThan(0.3);

    // The normals should be different (correct = +Y, buggy = something else)
    const normalDot = correctSP.normal.dot(buggySP.normal);
    expect(normalDot).toBeLessThan(0.5); // Very different normals
  });

  it('worldToSurface roundtrip is accurate for all 6 cube faces', () => {
    for (const { name, pos } of facePositions) {
      const uv = cube.worldToSurface(pos);
      const sp = cube.getPoint(uv.u, uv.v);

      // The recovered position should be close to the input position
      // (allowing for projection onto surface)
      const dist = sp.position.distanceTo(pos);
      expect(
        dist,
        `${name}: worldToSurface roundtrip error = ${dist.toFixed(4)}`,
      ).toBeLessThan(2.0); // Normal offset and face-edge proximity may cause small differences
    }
  });
});
