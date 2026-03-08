/**
 * Regression test for s44r4-01: Cube top/bottom face tangent frame degeneracy.
 *
 * BUG: On cube top/bottom flat faces, tangentV was overridden to a consistent
 * world-axis direction (CONSISTENCY FIX), but tangentU was left as the per-face
 * faceRight. For face strips 1 and 3, faceRight is along the Z-axis — same
 * direction as the hardcoded tangentV — making tangentU parallel/antiparallel
 * to tangentV. This causes computeCameraRelativeAimAngle to collapse aim to
 * a single axis ("only shooting left or right" in MP).
 *
 * FIX: Also override tangentU to a consistent (1,0,0) on top/bottom faces.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from './CubeSurface';
import { computeCameraRelativeAimAngle } from '../utils/aimAngle';

describe('CubeSurface tangent frame — top/bottom face orthogonality (s44r4-01)', () => {
  const cube = new CubeSurface({ size: 18 });

  // Sample u values that land in each of the 4 face strips
  // Face 0 ≈ u=0.125, Face 1 ≈ u=0.375, Face 2 ≈ u=0.625, Face 3 ≈ u=0.875
  const faceUValues = [
    { face: 0, u: 0.125 },
    { face: 1, u: 0.375 },
    { face: 2, u: 0.625 },
    { face: 3, u: 0.875 },
  ];

  describe('top flat face (v ≈ 0.99)', () => {
    for (const { face, u } of faceUValues) {
      it(`face ${face} (u=${u}): tangentU and tangentV must be orthogonal`, () => {
        const sp = cube.getPoint(u, 0.99);
        const dot = sp.tangentU.dot(sp.tangentV);
        expect(Math.abs(dot)).toBeLessThan(0.01);
      });

      it(`face ${face} (u=${u}): tangentU and tangentV must both be orthogonal to normal`, () => {
        const sp = cube.getPoint(u, 0.99);
        expect(Math.abs(sp.tangentU.dot(sp.normal))).toBeLessThan(0.01);
        expect(Math.abs(sp.tangentV.dot(sp.normal))).toBeLessThan(0.01);
      });
    }
  });

  describe('bottom flat face (v ≈ 0.01)', () => {
    for (const { face, u } of faceUValues) {
      it(`face ${face} (u=${u}): tangentU and tangentV must be orthogonal`, () => {
        const sp = cube.getPoint(u, 0.01);
        const dot = sp.tangentU.dot(sp.tangentV);
        expect(Math.abs(dot)).toBeLessThan(0.01);
      });

      it(`face ${face} (u=${u}): tangentU and tangentV must both be orthogonal to normal`, () => {
        const sp = cube.getPoint(u, 0.01);
        expect(Math.abs(sp.tangentU.dot(sp.normal))).toBeLessThan(0.01);
        expect(Math.abs(sp.tangentV.dot(sp.normal))).toBeLessThan(0.01);
      });
    }
  });

  describe('MP aim angle does not collapse on cube top face (s44r4-01 regression)', () => {
    // Simulate the camera looking down at the top face from above.
    // Camera right ≈ (1,0,0), camera up ≈ (0,0,-1).
    const camRight = new THREE.Vector3(1, 0, 0);
    const camUp = new THREE.Vector3(0, 0, -1);

    for (const { face, u } of faceUValues) {
      it(`face ${face}: mouseX=1 (right) and mouseY=-1 (up) give DIFFERENT aimAngles`, () => {
        const sp = cube.getPoint(u, 0.99);
        const angleRight = computeCameraRelativeAimAngle(
          1, 0, camRight, camUp, sp.normal, sp.tangentU, sp.tangentV,
        );
        const angleUp = computeCameraRelativeAimAngle(
          0, -1, camRight, camUp, sp.normal, sp.tangentU, sp.tangentV,
        );
        // BUG (pre-fix): on face strips 1 and 3, both collapsed to the same angle
        // because tangentU ∥ tangentV → mouseX component was lost
        const diff = Math.abs(angleRight - angleUp);
        expect(diff).toBeGreaterThan(0.5); // should differ by ~π/2
      });

      it(`face ${face}: diagonal mouse input (1, -1) gives a diagonal aimAngle`, () => {
        const sp = cube.getPoint(u, 0.99);
        const angle = computeCameraRelativeAimAngle(
          1, -1, camRight, camUp, sp.normal, sp.tangentU, sp.tangentV,
        );
        // Should be roughly π/4 (45°) — NOT collapsed to 0 or ±π
        // Allow some tolerance for the world rotation of the surface
        const absSin = Math.abs(Math.sin(angle));
        const absCos = Math.abs(Math.cos(angle));
        // Both sin and cos should be non-zero for a diagonal direction
        expect(absSin).toBeGreaterThan(0.2);
        expect(absCos).toBeGreaterThan(0.2);
      });
    }
  });

  describe('tangent frame consistency across face strips (no 90° jumps)', () => {
    it('top face: tangentU is the same direction across all 4 face strips', () => {
      const tangents = faceUValues.map(({ u }) => cube.getPoint(u, 0.99).tangentU);
      for (let i = 1; i < tangents.length; i++) {
        const dot = tangents[0].dot(tangents[i]);
        expect(dot).toBeGreaterThan(0.9); // all should point in same direction
      }
    });

    it('bottom face: tangentU is the same direction across all 4 face strips', () => {
      const tangents = faceUValues.map(({ u }) => cube.getPoint(u, 0.01).tangentU);
      for (let i = 1; i < tangents.length; i++) {
        const dot = tangents[0].dot(tangents[i]);
        expect(dot).toBeGreaterThan(0.9);
      }
    });

    it('top face: tangentV is the same direction across all 4 face strips', () => {
      const tangents = faceUValues.map(({ u }) => cube.getPoint(u, 0.99).tangentV);
      for (let i = 1; i < tangents.length; i++) {
        const dot = tangents[0].dot(tangents[i]);
        expect(dot).toBeGreaterThan(0.9);
      }
    });
  });
});
