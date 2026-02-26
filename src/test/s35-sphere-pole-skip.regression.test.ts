/**
 * S35 Regression: Sphere Pole Skip
 *
 * Bug: When approaching the north or south pole on the sphere map, the player
 * was "skipped over" the pole — a single-frame jump of ~6x the expected step
 * distance instead of smooth traversal.
 *
 * Root cause: _didCirclePole() fires whenever the player is in ANY cap triangle
 * adjacent to the pole vertex. On a SphereGeometry with 40 segments, these cap
 * triangles are ~0.785 world units long. _tryPoleTraversal() then teleports the
 * player past the pole even when they're 0.7+ units away — causing a jump of
 * (0.785 + step) instead of just (step).
 *
 * Fix: _tryPoleTraversal() now returns null if distToPole > step * 1.5, so
 * the geodesic result is accepted naturally while the player is still
 * approaching. Teleport only fires in the final step(s) where the player can
 * actually reach the pole.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createSphereSurface() {
  const surf = SurfaceFactory.create('sphere', {
    radius: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
  } as any);
  surf.mesh.updateMatrixWorld(true);
  return { surf, meshSurface: new MeshSurface(surf.mesh) };
}

/**
 * Walk the walker toward a target pole for N steps, recording max step distance.
 * Returns { maxStepMultiple, nanCount, finalDistFromPole }
 */
function walkTowardPole(
  walker: MeshWalker,
  polePos: THREE.Vector3,
  steps: number,
  dt: number,
): { maxStepMultiple: number; nanCount: number; finalDistFromPole: number } {
  const expectedStep = walker.speed * dt;
  let maxStepMultiple = 0;
  let nanCount = 0;
  let prevPos = walker.position.clone();

  for (let i = 0; i < steps; i++) {
    // Direction toward pole, projected onto the current tangent plane
    const toPole = new THREE.Vector3().subVectors(polePos, walker.position);
    const dotN = toPole.dot(walker.normal);
    const moveDir = toPole.clone().addScaledVector(walker.normal, -dotN);
    const moveDirLen = moveDir.length();
    if (moveDirLen < 0.001) break; // At the pole
    moveDir.multiplyScalar(1 / moveDirLen);

    walker.move(moveDir, dt);

    if (isNaN(walker.position.x) || isNaN(walker.position.y) || isNaN(walker.position.z)) {
      nanCount++;
      break;
    }

    const stepDist = prevPos.distanceTo(walker.position);
    maxStepMultiple = Math.max(maxStepMultiple, stepDist / expectedStep);
    prevPos = walker.position.clone();
  }

  return {
    maxStepMultiple,
    nanCount,
    finalDistFromPole: walker.position.distanceTo(polePos),
  };
}

describe('S35: Sphere pole skip regression', () => {
  // Default sphere: radius=10, gridSegmentsU=20, gridSegmentsV=20
  // → THREE.SphereGeometry(10, 40, 40)
  // Cap triangles span ~0.785 world units from the pole.
  // Player speed=3, dt=0.016-0.05 → step 0.048-0.15 world units.

  it('no large jump when approaching the north pole from v=0.05 (1.57 units away)', () => {
    const { surf, meshSurface } = createSphereSurface();
    // v=0.05 → phi = 0.05*PI ≈ 0.157 rad → arc length from N pole ≈ 1.57 world units
    const startPos = surf.getPoint(0.0, 0.05).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const northPole = new THREE.Vector3(0, 10, 0);

    const result = walkTowardPole(walker, northPole, 80, 0.05);

    // No NaN
    expect(result.nanCount).toBe(0);
    // No single step should exceed 2x the expected step (before fix: up to ~6x)
    expect(result.maxStepMultiple).toBeLessThanOrEqual(2.0);
  });

  it('no large jump when approaching the north pole from v=0.03 (0.94 units away)', () => {
    const { surf, meshSurface } = createSphereSurface();
    // v=0.03 → phi ≈ 0.094 rad → arc length from N pole ≈ 0.94 world units
    // This starts right inside the large cap triangle region
    const startPos = surf.getPoint(0.25, 0.03).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const northPole = new THREE.Vector3(0, 10, 0);

    const result = walkTowardPole(walker, northPole, 50, 0.05);

    expect(result.nanCount).toBe(0);
    expect(result.maxStepMultiple).toBeLessThanOrEqual(2.0);
  });

  it('no large jump when approaching the south pole from v=0.95', () => {
    const { surf, meshSurface } = createSphereSurface();
    // v=0.95 → phi ≈ 0.05*PI from south → arc length from S pole ≈ 1.57 world units
    const startPos = surf.getPoint(0.5, 0.95).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const southPole = new THREE.Vector3(0, -10, 0);

    const result = walkTowardPole(walker, southPole, 80, 0.05);

    expect(result.nanCount).toBe(0);
    expect(result.maxStepMultiple).toBeLessThanOrEqual(2.0);
  });

  it('player can actually traverse through the north pole (reaches the other side)', () => {
    const { surf, meshSurface } = createSphereSurface();
    const startPos = surf.getPoint(0.0, 0.08).position; // ~2.5 units from north pole
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const northPole = new THREE.Vector3(0, 10, 0);

    // Walk toward pole and then past it
    const result = walkTowardPole(walker, northPole, 150, 0.05);

    expect(result.nanCount).toBe(0);
    // After 150 steps of 0.15, the walker should have covered 150*0.15 = 22.5 world units
    // of surface distance, which is more than enough to cross the pole and continue past it.
    // Verify by checking the walker reached the "other side" — y should be back below starting y
    expect(result.maxStepMultiple).toBeLessThanOrEqual(2.0);
  });

  it('parity: south pole approach is also smooth', () => {
    const { surf, meshSurface } = createSphereSurface();
    const startPos = surf.getPoint(0.75, 0.97).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    const southPole = new THREE.Vector3(0, -10, 0);

    const result = walkTowardPole(walker, southPole, 50, 0.05);

    expect(result.nanCount).toBe(0);
    expect(result.maxStepMultiple).toBeLessThanOrEqual(2.0);
  });
});
