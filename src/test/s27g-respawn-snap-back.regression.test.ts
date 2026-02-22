/**
 * Regression test: S27g — Respawn teleport snap-back bug.
 *
 * BUG: Player dies at position A. Respawn logic moves playerWalker to position B
 * by directly assigning `.position`, `.normal`, `.faceIndex`. BUT the internal
 * `_facePos` (geodesic state used by moveFromInput) was never updated.
 * On first movement input after respawn, `moveGeodesic(_facePos, ...)` starts
 * from the old death position, snapping the player back to position A.
 *
 * FIX: Added `MeshWalker.teleportTo(point, faceIndex, normal)` which properly
 * reinitializes `_facePos` via `initGeodesicPosition`. GameLoop.ts and
 * GameInstance.ts now call `teleportTo` instead of direct assignment.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createWalkerOnSphere(u: number, v: number, speed = 3): {
  walker: MeshWalker;
  meshSurface: MeshSurface;
  surface: ReturnType<typeof SurfaceFactory.create>;
} {
  const surface = SurfaceFactory.create('sphere' as any);
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.mesh);
  const startPos = surface.getPoint(u, v).position;
  const walker = new MeshWalker(meshSurface, startPos, speed);
  return { walker, meshSurface, surface };
}

function makeDummyCamera(walker: MeshWalker): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const offset = walker.normal.clone().multiplyScalar(15);
  camera.position.copy(walker.position).add(offset);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('S27g — Respawn snap-back regression', () => {
  it('REGRESSION: after teleportTo(), moveFromInput starts from respawn position not death position', () => {
    // Player at death position (0.1, 0.1) on sphere
    const { walker, meshSurface, surface } = createWalkerOnSphere(0.1, 0.1);

    // Simulate movement to establish _facePos at "death location"
    const deathPos = walker.position.clone();
    const camera = makeDummyCamera(walker);

    // Move a little to settle _facePos at the death area
    walker.moveFromInput(0.5, 0, camera, 0.016);
    const actualDeathPos = walker.position.clone();

    // Now simulate respawn: compute opposite side of surface (0.6, 0.6)
    const respawnPoint = surface.getPoint(0.6, 0.6);
    const projected = meshSurface.closestPointOnSurface(respawnPoint.position);
    expect(projected).not.toBeNull();

    // Use teleportTo (the FIX) to move walker to respawn position
    walker.teleportTo(projected!.point, projected!.faceIndex, projected!.normal);

    const respawnPos = walker.position.clone();

    // Verify the walker is now at the respawn position (far from death)
    const distAfterTeleport = respawnPos.distanceTo(actualDeathPos);
    expect(distAfterTeleport).toBeGreaterThan(2); // Sphere radius ~5, opposite side is ~10 units

    // Now simulate the user pressing movement immediately after respawn
    // BUG: before fix, this would snap back to death position
    // FIX: this should move from respawn position
    const cameraAtRespawn = makeDummyCamera(walker);
    walker.moveFromInput(1, 0, cameraAtRespawn, 0.016);

    const posAfterFirstMove = walker.position.clone();

    // After moving, should still be near respawn position (not snapped back to death)
    const distFromRespawn = posAfterFirstMove.distanceTo(respawnPos);
    const distFromDeath = posAfterFirstMove.distanceTo(actualDeathPos);

    // Should be close to respawn position (just moved a little from it)
    expect(distFromRespawn).toBeLessThan(1); // Small movement from respawn point
    // Should still be far from death position
    expect(distFromDeath).toBeGreaterThan(2);
  });

  it('teleportTo() updates position, normal, faceIndex, and tangent frame', () => {
    const { walker, meshSurface, surface } = createWalkerOnSphere(0.1, 0.1);

    const initialPos = walker.position.clone();
    const initialNormal = walker.normal.clone();

    // Teleport to opposite side
    const targetPoint = surface.getPoint(0.6, 0.6);
    const projected = meshSurface.closestPointOnSurface(targetPoint.position);
    expect(projected).not.toBeNull();

    walker.teleportTo(projected!.point, projected!.faceIndex, projected!.normal);

    // Position should have moved
    expect(walker.position.distanceTo(initialPos)).toBeGreaterThan(2);

    // Normal should point away from sphere center (outward)
    const normalDotPos = walker.normal.dot(walker.position.clone().normalize());
    expect(normalDotPos).toBeGreaterThan(0.9); // Normal points outward on sphere

    // Normal should differ from initial
    expect(walker.normal.dot(initialNormal)).toBeLessThan(0.9); // Different location, different normal

    // faceIndex should be updated
    expect(walker.faceIndex).toBe(projected!.faceIndex);
  });

  it('teleportTo() without fix would cause snap-back (demonstrates the bug would exist)', () => {
    // This test demonstrates what WOULD happen with direct assignment (the bug).
    // We can't directly test private _facePos, but we verify that after teleportTo,
    // movement stays near the new position — if _facePos were stale, movement would
    // snap to the old position.

    const { walker, meshSurface, surface } = createWalkerOnSphere(0.5, 0.5);

    // Start at one position
    const camera1 = makeDummyCamera(walker);
    walker.moveFromInput(0.1, 0, camera1, 0.016);
    const beforeTeleportPos = walker.position.clone();

    // Teleport to far location
    const farPoint = surface.getPoint(0.0, 0.0);
    const projected = meshSurface.closestPointOnSurface(farPoint.position);
    expect(projected).not.toBeNull();
    walker.teleportTo(projected!.point, projected!.faceIndex, projected!.normal);

    const afterTeleportPos = walker.position.clone();
    expect(afterTeleportPos.distanceTo(beforeTeleportPos)).toBeGreaterThan(3);

    // Move from new position - should stay near teleport target
    const camera2 = makeDummyCamera(walker);
    walker.moveFromInput(0.1, 0, camera2, 0.016);
    const afterMovePos = walker.position.clone();

    // Must remain near the teleport destination, NOT snap back
    expect(afterMovePos.distanceTo(afterTeleportPos)).toBeLessThan(0.5);
    expect(afterMovePos.distanceTo(beforeTeleportPos)).toBeGreaterThan(2);
  });
});
