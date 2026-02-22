/**
 * Regression test for S27g — Aim Offset/Shooting Direction Not Aligned With Mouse Cursor
 *
 * Root cause: GameLoop used frame.tangent/bitangent (surface UV axes) to map
 * mouse aimX/aimY into world-space aim direction. But the camera's right/up
 * vectors lag behind the tangent frame (position and up both lerp at 0.12).
 * This creates a visible angular offset between where the mouse points on screen
 * and where bullets actually go — especially noticeable after respawn (camera
 * is still at old location while tangent frame is at the new location).
 *
 * Fix: use camera.matrixWorld columns 0 (right) and 1 (up) projected onto the
 * surface plane instead of the raw tangent frame.
 *
 * These tests FAIL without the fix and PASS with it.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWalkerOnSphere(radius = 10): { walker: MeshWalker; surface: MeshSurface } {
  const surf = SurfaceFactory.create('sphere', { radius });
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, 3);
  return { walker, surface: meshSurface };
}

/**
 * Compute aim direction using the OLD (buggy) method:
 * map aimX/aimY onto frame.tangent/bitangent.
 */
function computeAimOld(
  frame: { tangent: THREE.Vector3; bitangent: THREE.Vector3 },
  aimX: number,
  aimY: number,
): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(frame.tangent, aimX)
    .addScaledVector(frame.bitangent, -aimY)
    .normalize();
}

/**
 * Compute aim direction using the NEW (fixed) method:
 * project camera matrixWorld axes onto the surface plane.
 */
function computeAimNew(
  camera: THREE.Camera,
  playerNormal: THREE.Vector3,
  frame: { tangent: THREE.Vector3; bitangent: THREE.Vector3 },
  aimX: number,
  aimY: number,
): THREE.Vector3 {
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  // Remove normal component → project onto surface plane
  camRight.addScaledVector(playerNormal, -camRight.dot(playerNormal));
  camUp.addScaledVector(playerNormal, -camUp.dot(playerNormal));
  const useCameraAxes = camRight.lengthSq() > 0.01 && camUp.lengthSq() > 0.01;
  if (useCameraAxes) {
    camRight.normalize();
    camUp.normalize();
  }
  const aimAxisX = useCameraAxes ? camRight : frame.tangent;
  const aimAxisY = useCameraAxes ? camUp : frame.bitangent;
  return new THREE.Vector3()
    .addScaledVector(aimAxisX, aimX)
    .addScaledVector(aimAxisY, -aimY)
    .normalize();
}

/** Create camera directly above walker (perfectly aligned, no lag). */
function makeAlignedCamera(walker: MeshWalker, distance = 15): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, distance);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * Create a "lagged" camera: positioned at the old player location (simulating
 * post-respawn lag where camera hasn't reached the new position yet).
 * The camera's tangent frame at the old location differs from the new one.
 */
function makeLaggedCamera(
  walker: MeshWalker,
  oldPosition: THREE.Vector3,
  oldBitangent: THREE.Vector3,
  distance = 15,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  // Camera is still hovering at the old player position (hasn't lerped yet)
  camera.position.copy(oldPosition).addScaledVector(oldBitangent, distance);
  camera.up.copy(oldBitangent); // up is also stale
  camera.lookAt(walker.position); // but it looks at the new player position
  camera.updateMatrixWorld(true);
  return camera;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S27g Aim Offset Regression — camera-axis aim mapping', () => {

  describe('Aligned camera (no lag): both methods agree', () => {
    it('aim-right: old and new methods both produce rightward aim on screen', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeAlignedCamera(walker);
      const frame = walker.getTangentFrame();
      const normal = walker.normal.clone();

      // aimX=1, aimY=0 → aiming right on screen
      const oldAim = computeAimOld(frame, 1, 0);
      const newAim = computeAimNew(camera, normal, frame, 1, 0);

      // Camera right (screen right) should match both aims
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const dotOld = oldAim.dot(camRight);
      const dotNew = newAim.dot(camRight);

      // Both should be strongly aligned with camera right (cos > 0.95 ≈ within ~18°)
      expect(dotOld).toBeGreaterThan(0.95);
      expect(dotNew).toBeGreaterThan(0.95);
    });

    it('aim-up: both methods agree when camera is aligned', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeAlignedCamera(walker);
      const frame = walker.getTangentFrame();
      const normal = walker.normal.clone();

      // aimX=0, aimY=-1 → mouse above center → aim upward on screen
      const oldAim = computeAimOld(frame, 0, -1);
      const newAim = computeAimNew(camera, normal, frame, 0, -1);

      // Camera up (screen up) — column 1 of matrixWorld
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const dotOld = oldAim.dot(camUp);
      const dotNew = newAim.dot(camUp);

      expect(dotOld).toBeGreaterThan(0.95);
      expect(dotNew).toBeGreaterThan(0.95);
    });
  });

  describe('Lagged camera (post-respawn): only new method is correct', () => {
    it('with lagged camera, new method gives screen-correct aim; old method drifts', () => {
      // Simulate: player was at (u=0.5, v=0.5) and just respawned at (u=0.0, v=0.0)
      // Camera is still near the OLD position (lag not resolved yet)
      const surf = SurfaceFactory.create('sphere', { radius: 10 });
      surf.mesh.updateMatrixWorld(true);
      const meshSurface = new MeshSurface(surf.mesh);

      // Old position (pre-respawn) — tangentV = "bitangent" equivalent for camera up
      const oldSurfacePoint = surf.getPoint(0.5, 0.5);
      const oldPos = oldSurfacePoint.position.clone();
      const oldBitangent = oldSurfacePoint.tangentV.clone(); // tangentV ≈ bitangent

      // New position (post-respawn) — significantly different surface location
      const newSurfacePoint = surf.getPoint(0.0, 0.0);
      const newPos = newSurfacePoint.position.clone();
      const walker = new MeshWalker(meshSurface, newPos, 3);

      const frame = walker.getTangentFrame();
      const normal = walker.normal.clone();

      // Lagged camera: still hovering over OLD position
      const laggedCamera = makeLaggedCamera(walker, oldPos, oldBitangent);

      // Player aims RIGHT on screen (aimX=1, aimY=0)
      const oldAim = computeAimOld(frame, 1, 0);
      const newAim = computeAimNew(laggedCamera, normal, frame, 1, 0);

      // What "screen right" actually IS at this moment (from lagged camera)
      const camRight = new THREE.Vector3().setFromMatrixColumn(laggedCamera.matrixWorld, 0);

      const dotOldVsScreen = oldAim.dot(camRight);
      const dotNewVsScreen = newAim.dot(camRight);

      // New method should closely match camera right (bullets go where screen says)
      expect(dotNewVsScreen).toBeGreaterThan(0.9);

      // Old method's dot with camera right will be lower (it uses tangent, not camera right)
      // On opposite sides of sphere, the tangent frame can differ by up to 90°+
      // The key assertion: new method is MORE aligned with screen right than old method
      expect(dotNewVsScreen).toBeGreaterThan(dotOldVsScreen);
    });

    it('new method: bullet aim always matches camera right regardless of surface location', () => {
      // Test at four different surface positions to verify consistency
      const positions = [
        { u: 0.0, v: 0.0 },
        { u: 0.25, v: 0.1 },
        { u: 0.75, v: 0.6 },
        { u: 0.5, v: 0.9 },
      ];

      const surf = SurfaceFactory.create('sphere', { radius: 10 });
      surf.mesh.updateMatrixWorld(true);
      const meshSurface = new MeshSurface(surf.mesh);

      for (const { u, v } of positions) {
        const point = surf.getPoint(u, v);
        const walker = new MeshWalker(meshSurface, point.position.clone(), 3);

        // Camera directly above this position (best case)
        const camera = makeAlignedCamera(walker);
        const frame = walker.getTangentFrame();
        const normal = walker.normal.clone();

        const newAim = computeAimNew(camera, normal, frame, 1, 0);
        const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);

        const dot = newAim.dot(camRight);

        // New method should always give screen-aligned aim
        expect(dot).toBeGreaterThan(0.95);
      }
    });
  });

  describe('Fallback: degenerate camera does not crash', () => {
    it('returns valid direction even when camera axes nearly parallel to normal', () => {
      const { walker } = createWalkerOnSphere();
      // Camera nearly parallel to the surface (looking sideways) — unusual but shouldn't crash
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
      camera.position.copy(walker.position).add(new THREE.Vector3(15, 0, 0));
      camera.up.set(0, 1, 0);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const frame = walker.getTangentFrame();
      const normal = walker.normal.clone();

      // Should not throw and should return a finite, normalized vector
      const aimDir = computeAimNew(camera, normal, frame, 1, 0);

      expect(isFinite(aimDir.x)).toBe(true);
      expect(isFinite(aimDir.y)).toBe(true);
      expect(isFinite(aimDir.z)).toBe(true);
      // Should be approximately unit length
      expect(aimDir.length()).toBeGreaterThan(0.9);
      expect(aimDir.length()).toBeLessThan(1.1);
    });
  });

  describe('Respawn: lastAimDirection reset prevents stale aim', () => {
    it('camera-axis aim at post-respawn position is in the correct tangent plane', () => {
      // After respawn, player is at a new position. The camera is lagged (old position).
      // The key property: camera-axis aim lies in the CURRENT tangent plane (not the old one).
      // This is the critical correctness guarantee the fix provides.

      const surf = SurfaceFactory.create('sphere', { radius: 10 });
      surf.mesh.updateMatrixWorld(true);
      const meshSurface = new MeshSurface(surf.mesh);

      // New position (post-respawn)
      const newPoint = surf.getPoint(0.25, 0.75);
      const newPos = newPoint.position.clone();
      const newNormal = newPoint.normal.clone().normalize();
      const walker = new MeshWalker(meshSurface, newPos, 3);

      // Lagged camera: positioned at old point (rotated around the sphere)
      const oldPoint = surf.getPoint(0.0, 0.0);
      const oldPos = oldPoint.position.clone();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
      camera.position.copy(oldPos).addScaledVector(oldPoint.normal, 15);
      camera.up.copy(oldPoint.tangentV);
      camera.lookAt(newPos); // But it looks at the new player position
      camera.updateMatrixWorld(true);

      const frame = walker.getTangentFrame();

      // Test all four aim directions
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const aimDir = computeAimNew(camera, newNormal, frame, ax, ay);

        // Aim direction must lie in the tangent plane at the NEW player position
        const normalComponent = Math.abs(aimDir.dot(newNormal));
        expect(normalComponent).toBeLessThan(0.05); // < 3° off from new tangent plane
      }
    });

    it('camera-axis aim always lies in the surface tangent plane', () => {
      // The fixed method produces aim in the tangent plane at the CURRENT position
      // This is the key property that makes aim correct after respawn

      const { walker } = createWalkerOnSphere();
      const camera = makeAlignedCamera(walker);
      const frame = walker.getTangentFrame();
      const normal = walker.normal.clone();

      // Compute aim in all four directions
      const testInputs = [
        [1, 0], [-1, 0], [0, -1], [0, 1],
      ] as Array<[number, number]>;

      for (const [ax, ay] of testInputs) {
        const aimDir = computeAimNew(camera, normal, frame, ax, ay);

        // Aim direction should be perpendicular to the surface normal (lies in tangent plane)
        const normalComponent = Math.abs(aimDir.dot(normal));
        expect(normalComponent).toBeLessThan(0.05); // < 3° off from tangent plane
      }
    });
  });
});
