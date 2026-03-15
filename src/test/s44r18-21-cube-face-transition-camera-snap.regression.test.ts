/**
 * Regression test for s44r18-21: cube face transition camera snap (MP).
 *
 * Root cause: When a cube edge transition causes a large UV jump (errSq > threshold),
 * network-main.ts calls `resetFrameForNewSurface()` but NOT `snapToFrame()`.
 * On the next render frame, `updateFromFrame()` sets _cameraFrameInitialized=true,
 * preventing the !hasBeenPositioned snap path from firing on subsequent server updates.
 * Camera lerps from the wrong position (through cube geometry) for 5-15 frames,
 * causing the "inside cube" view. The same frames have wrong camera axes, corrupting
 * computeCameraRelativeAimAngle() → bullets snap to degenerate directions.
 *
 * Fix: Call snapToFrame() immediately after resetFrameForNewSurface() for
 * non-death, non-respawn position snaps (e.g. face transitions, portal teleports).
 * This mirrors the behavior of the respawn snap added in s44r8-03.
 *
 * REGRESSION GUARD: If this test fails, the cube face transition camera snap is broken.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../core/CameraController';

// Minimal document stub for CameraController constructor
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 15, 25); // default initial position
  cam.updateMatrixWorld();
  return cam;
}

// Cube face normals (the 6 faces)
const FACE_TOP     = { pos: new THREE.Vector3(0, 9.15, 0), normal: new THREE.Vector3(0, 1, 0), tangent: new THREE.Vector3(1, 0, 0), bitangent: new THREE.Vector3(0, 0, 1) };
const FACE_FRONT   = { pos: new THREE.Vector3(0, 0, 9.15), normal: new THREE.Vector3(0, 0, 1), tangent: new THREE.Vector3(1, 0, 0), bitangent: new THREE.Vector3(0, 1, 0) };
const FACE_RIGHT   = { pos: new THREE.Vector3(9.15, 0, 0), normal: new THREE.Vector3(1, 0, 0), tangent: new THREE.Vector3(0, 0, -1), bitangent: new THREE.Vector3(0, 1, 0) };

describe('s44r18-21 cube face transition camera snap (REGRESSION GUARD)', () => {

  it('resetFrameForNewSurface causes hasBeenPositioned=false, blocking further snaps', () => {
    // This test documents the PROBLEM that existed before the fix.
    // The fix adds snapToFrame() IMMEDIATELY after resetFrameForNewSurface(),
    // so this sequence (reset without snap) should no longer happen in production.
    const cam = makeCamera();
    const ctrl = new CameraController(cam);

    // Start on front face
    ctrl.snapToFrame(FACE_FRONT.pos, FACE_FRONT.normal, { tangent: FACE_FRONT.tangent, bitangent: FACE_FRONT.bitangent });
    expect(ctrl.hasBeenPositioned).toBe(true);

    // Face transition: reset without snap (OLD broken behavior)
    ctrl.resetFrameForNewSurface();
    expect(ctrl.hasBeenPositioned).toBe(false);

    // On next render frame, updateFromFrame sets hasBeenPositioned=true
    ctrl.updateFromFrame(FACE_TOP.pos, FACE_TOP.normal, { tangent: FACE_TOP.tangent, bitangent: FACE_TOP.bitangent }, 1/60);
    expect(ctrl.hasBeenPositioned).toBe(true);

    // Now camera is NOT snapped to top face — it's lerping from front face position
    // Camera should NOT be directly above top face position
    const expectedTopY = FACE_TOP.pos.y + ctrl.getCameraDistance();
    // Camera is far from correct position — was lerping from front face
    // (front face camera was at (0, 0, 9.15 + 15) = (0,0,24.15), not (0, 24.15, 0))
    expect(cam.position.y).not.toBeCloseTo(expectedTopY, 0);
  });

  it('FIX: snapToFrame immediately after reset positions camera correctly on new face', () => {
    // This test verifies the FIX: calling snapToFrame AFTER resetFrameForNewSurface.
    const cam = makeCamera();
    const ctrl = new CameraController(cam);

    // Start on front face, snap correctly
    ctrl.snapToFrame(FACE_FRONT.pos, FACE_FRONT.normal, { tangent: FACE_FRONT.tangent, bitangent: FACE_FRONT.bitangent });

    // Face transition: reset AND snap (NEW fix behavior)
    ctrl.resetFrameForNewSurface();
    ctrl.snapToFrame(FACE_TOP.pos, FACE_TOP.normal, { tangent: FACE_TOP.tangent, bitangent: FACE_TOP.bitangent });

    // Camera should now be directly above the top face
    const expectedTopY = FACE_TOP.pos.y + ctrl.getCameraDistance();
    expect(cam.position.y).toBeCloseTo(expectedTopY, 0); // within 1 unit
    expect(Math.abs(cam.position.x)).toBeLessThan(1);
    expect(Math.abs(cam.position.z)).toBeLessThan(1);
  });

  it('FIX: after face transition snap, camera axes are correct for aim computation', () => {
    // Verifies that after reset+snap, camera right/up align with the new face's tangent frame.
    // This is what computeCameraRelativeAimAngle() needs to compute correct bullet direction.
    const cam = makeCamera();
    const ctrl = new CameraController(cam);

    // Start on front face
    ctrl.snapToFrame(FACE_FRONT.pos, FACE_FRONT.normal, { tangent: FACE_FRONT.tangent, bitangent: FACE_FRONT.bitangent });

    // Transition to top face (same as cube face transition in network-main.ts)
    ctrl.resetFrameForNewSurface();
    ctrl.snapToFrame(FACE_TOP.pos, FACE_TOP.normal, { tangent: FACE_TOP.tangent, bitangent: FACE_TOP.bitangent });

    // Camera should be above player, looking down along face_top normal (0,1,0)
    // Camera right should align with face_top tangent (1,0,0)
    // Camera up (screen-up) should align with face_top bitangent (0,0,1)
    const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const camUp    = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);

    // Project onto top face tangent plane (remove normal component)
    const projRight = camRight.clone().addScaledVector(FACE_TOP.normal, -camRight.dot(FACE_TOP.normal)).normalize();
    const projUp    = camUp.clone().addScaledVector(FACE_TOP.normal, -camUp.dot(FACE_TOP.normal)).normalize();

    // projRight should align with tangent (1,0,0) — X ≈ ±1
    expect(Math.abs(projRight.x)).toBeGreaterThan(0.9);
    // projUp should align with bitangent (0,0,1) — Z ≈ ±1
    expect(Math.abs(projUp.z)).toBeGreaterThan(0.9);
  });

  it('REGRESSION: multiple face transitions all produce correct camera positions', () => {
    // Simulates walking from face to face: front → top → right → front
    const cam = makeCamera();
    const ctrl = new CameraController(cam);

    const faces = [FACE_FRONT, FACE_TOP, FACE_RIGHT, FACE_FRONT];
    for (const face of faces) {
      ctrl.resetFrameForNewSurface();
      ctrl.snapToFrame(face.pos, face.normal, { tangent: face.tangent, bitangent: face.bitangent });

      // After each snap, camera should be on the correct side (normal direction from face pos)
      const camToPos = face.pos.clone().sub(cam.position).normalize();
      // Camera is outside the face (at face.pos + normal * cameraDistance).
      // The vector from camera TO player (face.pos) points IN THE NEGATIVE normal direction.
      // So camToPos.dot(face.normal) should be < -0.5 (camera is on the positive-normal side).
      expect(camToPos.dot(face.normal)).toBeLessThan(-0.5);
    }
  });

  it('sign-flip protection: transitioning from front (+Z) face to back (-Z) face', () => {
    // When going to opposite face (dot(normal_old, normal_new) < 0), the sign-flip
    // protection in CameraController should fire. With reset+snap, this is handled correctly.
    const cam = makeCamera();
    const ctrl = new CameraController(cam);

    const FACE_BACK = { pos: new THREE.Vector3(0, 0, -9.15), normal: new THREE.Vector3(0, 0, -1), tangent: new THREE.Vector3(-1, 0, 0), bitangent: new THREE.Vector3(0, 1, 0) };

    // Start on front face
    ctrl.snapToFrame(FACE_FRONT.pos, FACE_FRONT.normal, { tangent: FACE_FRONT.tangent, bitangent: FACE_FRONT.bitangent });

    // Transition to back face (opposite normal — could trigger sign-flip protection)
    ctrl.resetFrameForNewSurface();
    ctrl.snapToFrame(FACE_BACK.pos, FACE_BACK.normal, { tangent: FACE_BACK.tangent, bitangent: FACE_BACK.bitangent });

    // Camera should be in front of the back face (along -Z direction from face)
    // i.e. camera.position.z should be LESS than the back face position (which is at z=-9.15)
    // Camera offset = back_normal * cameraDistance = (0,0,-1)*15 => camera at z = -9.15 - 15 = -24.15
    expect(cam.position.z).toBeCloseTo(-9.15 - ctrl.getCameraDistance(), 0);
  });
});
