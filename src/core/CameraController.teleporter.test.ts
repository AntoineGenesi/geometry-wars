/**
 * CameraController Teleporter Regression Test (s44r6b-04)
 *
 * Bug: After using a teleporter that moves the player to a surface region with
 * a normal >90° from the current _preferredNormal, CameraController's anti-flip
 * logic negates the new normal, placing the camera INSIDE the surface instead
 * of outside.
 *
 * Fix: Call resetFrameForNewSurface() before snapToFrame() after teleportation,
 * just as we do for respawn (s44r6-05 fix).
 *
 * Test verifies:
 * 1. (BUG) Without reset, snapToFrame with opposite normal places camera on
 *    wrong side (anti-flip negates the correct normal → camera inside surface)
 * 2. (FIX) With resetFrameForNewSurface() before snapToFrame, camera is
 *    correctly placed on the outside of the surface at the new position.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from './CameraController';

// ---------------------------------------------------------------------------
// Mock document for CameraController event listeners
// ---------------------------------------------------------------------------
const _noop = () => {};
const _noopEvent = (_e: string, _h: any, _opts?: any) => {};
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
} else if (!(globalThis.document as any).addEventListener) {
  (globalThis.document as any).addEventListener = _noopEvent;
  (globalThis.document as any).removeEventListener = _noopEvent;
}

function makeCamera(): THREE.Camera {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  cam.position.set(0, 15, 25);
  return cam;
}

function makeFrame(tangent: THREE.Vector3, bitangent: THREE.Vector3) {
  return { tangent, bitangent };
}

describe('CameraController — teleporter camera reset (s44r6b-04)', () => {
  it('demonstrates bug: without reset, camera goes to wrong side after teleport to opposite normal', () => {
    const camera = makeCamera();
    const ctrl = new CameraController(camera);

    const topNormal = new THREE.Vector3(0, 1, 0);
    const bottomNormal = new THREE.Vector3(0, -1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    // Player on top of peanut (normal pointing up).
    const topPos = new THREE.Vector3(0, 5, 0);
    ctrl.snapToFrame(topPos, topNormal, makeFrame(tangent, bitangent));
    // Camera should be above the player (positive Y offset)
    expect(camera.position.y).toBeGreaterThan(topPos.y);

    // Teleport player to bottom of peanut (normal pointing down).
    // WITHOUT resetFrameForNewSurface — this is the BUG.
    const bottomPos = new THREE.Vector3(0, -5, 0);
    ctrl.snapToFrame(bottomPos, bottomNormal, makeFrame(tangent, bitangent));

    // BUG: anti-flip negates bottomNormal → camera uses (0,+1,0) offset
    // → camera.y = -5 + 15 = +10, but player is at -5 with outward normal (0,-1,0)
    // → camera is ABOVE player, but should be BELOW (outside surface)
    // Camera is on the WRONG side: same Y-side as the preferred (top) normal.
    // In world space, camera.y > bottomPos.y means camera is above, which is INSIDE
    // the peanut surface when the player is on the bottom with downward normal.
    expect(camera.position.y).toBeGreaterThan(bottomPos.y); // camera above → wrong side (inside surface)
  });

  it('fix: resetFrameForNewSurface() before snapToFrame places camera on correct side after teleport', () => {
    const camera = makeCamera();
    const ctrl = new CameraController(camera);

    const topNormal = new THREE.Vector3(0, 1, 0);
    const bottomNormal = new THREE.Vector3(0, -1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    // Player on top of peanut
    const topPos = new THREE.Vector3(0, 5, 0);
    ctrl.snapToFrame(topPos, topNormal, makeFrame(tangent, bitangent));
    expect(camera.position.y).toBeGreaterThan(topPos.y); // camera above player ✓

    // Teleport player to bottom of peanut.
    // WITH resetFrameForNewSurface() — this is the FIX.
    ctrl.resetFrameForNewSurface();
    const bottomPos = new THREE.Vector3(0, -5, 0);
    ctrl.snapToFrame(bottomPos, bottomNormal, makeFrame(tangent, bitangent));

    // FIX: _cameraFrameInitialized=false → anti-flip check skipped
    // → camera uses bottomNormal (0,-1,0) directly → camera.y = -5 + (-15) = -20
    // → camera below player → OUTSIDE the peanut surface (correct!)
    expect(camera.position.y).toBeLessThan(bottomPos.y); // camera below → correct side ✓
  });
});
