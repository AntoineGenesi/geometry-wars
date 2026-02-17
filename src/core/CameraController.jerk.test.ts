/**
 * CameraController Jerk Detection Tests
 *
 * These tests detect camera jerk caused by up-vector lerp lag in CameraController.
 *
 * Root cause: velocity-damped lerp on camera.up creates lag — camera.up lags
 * behind the actual bitangent (the correct up vector). lookAt with lagged up
 * gives wrong orientation. User sees: "move a little, nothing happens, then
 * camera repositions" = the lerp catch-up delay.
 *
 * Fix: camera.up.copy() directly from bitangent (no lerp, no damping).
 * Bitangent is stable after iteration 7 dual Gram-Schmidt fix.
 *
 * Tests FAIL with old velocity-damped lerp. Tests PASS with copy fix.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from './CameraController';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Mock document for CameraController's event listeners
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSphereWalker(radius = 10, speed = 3): { walker: MeshWalker } {
  const surf = SurfaceFactory.create('sphere', { radius });
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, speed);
  return { walker };
}

/** Create camera positioned above the walker, looking at it */
function createCamera(walker: MeshWalker, distance = 15): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, distance);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Move walker one step and update camera */
function stepFrame(
  walker: MeshWalker,
  camera: THREE.PerspectiveCamera,
  controller: CameraController,
  inputX: number,
  inputY: number,
  dt: number,
): void {
  const frame = walker.getTangentFrame();
  if (Math.abs(inputX) > 0.01 || Math.abs(inputY) > 0.01) {
    walker.moveFromInput(inputX, inputY, camera, dt, frame.bitangent);
  }
  controller.update(walker, dt);
  camera.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraController — Up-Vector Lag Detection', () => {
  /**
   * Test 1: Camera.up tracks bitangent immediately (no lag)
   *
   * With lerp: camera.up always lags behind bitangent. Angle between them
   * grows during movement and shrinks when stationary.
   * With copy: camera.up == bitangent every frame (zero lag).
   */
  it('Test 1: camera.up matches bitangent immediately after update (no lerp lag)', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Settle 10 frames stationary
    for (let i = 0; i < 10; i++) stepFrame(walker, camera, controller, 0, 0, dt);

    // Measure angle between camera.up and actual bitangent each frame during movement
    const lagAngles: number[] = [];

    for (let i = 0; i < 120; i++) {
      stepFrame(walker, camera, controller, 1, 0, dt);
      const bitangent = walker.getTangentFrame().bitangent;
      // After update, camera.up should match _camUp (which is bitangent or sign-corrected bitangent)
      // Allow for sign correction: check both signs
      const dot = Math.abs(camera.up.dot(bitangent));
      const angle = Math.acos(Math.min(1, dot));
      lagAngles.push(angle);
    }

    // With lerp: lag accumulates, angles can be 5-30 degrees during sustained movement
    // With copy: camera.up IS the bitangent — angle should be near zero (< 0.01 rad = 0.57°)
    const maxLagDegrees = Math.max(...lagAngles) * (180 / Math.PI);
    expect(maxLagDegrees).toBeLessThan(1); // Assert: camera.up is always current bitangent

    const avgLagDegrees = lagAngles.reduce((a, b) => a + b) / lagAngles.length * (180 / Math.PI);
    expect(avgLagDegrees).toBeLessThan(0.5); // Average lag < 0.5 degrees
  });

  /**
   * Test 2: No residual lag after rapid movement starts
   *
   * With lerp: first frame of movement, camera.up still points at old bitangent.
   * Camera "doesn't respond" on the first frame.
   * With copy: camera.up updates immediately on frame 1 of movement.
   */
  it('Test 2: camera.up responds immediately on first frame of movement', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Settle 30 frames stationary so walker moves around sphere
    for (let i = 0; i < 30; i++) stepFrame(walker, camera, controller, 0, 0, dt);

    // Move player for 5 frames in a direction that changes the bitangent
    for (let i = 0; i < 5; i++) {
      stepFrame(walker, camera, controller, 1, 0, dt);
    }

    // After movement starts, camera.up should already match bitangent
    // (not still at the "settled" bitangent from the stationary phase)
    const bitangent = walker.getTangentFrame().bitangent;

    // camera.up should align with current bitangent (or its sign-corrected version)
    const dot = Math.abs(camera.up.dot(bitangent));
    const alignmentAngle = Math.acos(Math.min(1, dot)) * (180 / Math.PI);

    // With lerp (0.15/frame): after 5 frames, camera.up has only moved 56% toward new bitangent
    // This means alignmentAngle could be significant (5-30 degrees) even after 5 frames
    // With copy: camera.up == bitangent immediately → angle ≈ 0 after 1 frame
    expect(alignmentAngle).toBeLessThan(1); // Assert: immediate response, not lerp lag
  });

  /**
   * Test 3: No lag accumulation during sustained movement
   *
   * With lerp: lag continuously accumulates if the bitangent changes faster
   * than the lerp rate catches up. On a sphere at constant speed, each frame
   * the bitangent rotates by some small angle. At lerp=0.15, if bitangent
   * rotates by more than 0.15 * (bitangent_delta) per frame, lag grows.
   * With copy: no accumulation — always zero lag.
   */
  it('Test 3: no lag accumulation over 120 frames of sustained movement', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Move for 120 frames, check lag at each frame
    const lagAngles: number[] = [];

    for (let i = 0; i < 120; i++) {
      stepFrame(walker, camera, controller, 1, 0, dt);
      const bitangent = walker.getTangentFrame().bitangent;
      const dot = Math.abs(camera.up.dot(bitangent));
      lagAngles.push(Math.acos(Math.min(1, dot)));
    }

    // With lerp: lag may grow during movement (if bitangent change rate > lerp rate)
    // Check that lag doesn't grow over time (slope of lag angles should be ≤ 0)
    const firstHalf = lagAngles.slice(0, 60).reduce((a, b) => a + b) / 60;
    const secondHalf = lagAngles.slice(60).reduce((a, b) => a + b) / 60;

    // Lag should not increase over time (no accumulation)
    // With copy: both halves ≈ 0 (trivially passes)
    // With lerp: second half may be >= first half (lag accumulating or sustained)
    expect(secondHalf).toBeLessThan(firstHalf + 0.01); // No significant lag growth

    // Overall lag should be near zero
    const maxLag = Math.max(...lagAngles) * (180 / Math.PI);
    expect(maxLag).toBeLessThan(1); // < 1 degree lag at any point
  });

  /**
   * Test 4: Camera responds to rapid direction changes without dead frames
   *
   * "Move a little and nothing happens" = camera.up doesn't update when bitangent
   * changes quickly (velocity damping suppresses the lerp during rapid changes).
   * With copy: always responds, no dead frames.
   */
  it('Test 4: camera.up updates after every player step — no dead frames', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Settle
    for (let i = 0; i < 10; i++) stepFrame(walker, camera, controller, 0, 0, dt);

    // Move in alternating directions to create rapid bitangent changes
    let deadFrames = 0;

    for (let i = 0; i < 60; i++) {
      const bitangentBefore = walker.getTangentFrame().bitangent.clone();
      const inputX = (i % 2 === 0) ? 1 : -1; // alternate left/right

      stepFrame(walker, camera, controller, inputX, 0, dt);

      const bitangentAfter = walker.getTangentFrame().bitangent.clone();
      const bitangentChange = bitangentBefore.angleTo(bitangentAfter);

      if (bitangentChange > 0.001) { // bitangent actually changed
        // camera.up should now match the new bitangent (or sign-corrected version)
        const dot = Math.abs(camera.up.dot(bitangentAfter));
        const lagAngle = Math.acos(Math.min(1, dot));

        // With velocity-damped lerp: lag can be large (damping suppresses response at rapid changes)
        // With copy: lag ≈ 0 (camera.up = bitangent immediately)
        if (lagAngle > 0.1) { // > ~6 degrees lag = "dead frame" (camera didn't respond)
          deadFrames++;
        }
      }
    }

    // No dead frames: camera always responds to bitangent changes
    expect(deadFrames).toBe(0);
  });

  /**
   * Test 5: Camera up-vector jerk detection (the user's reported symptom)
   *
   * With velocity-damped lerp: when damping suddenly releases (player slows down
   * or changes direction), camera.up "snaps" to catch up → visible jerk.
   * Detectable as sudden large changes in camera.up angle.
   * With copy: no snap-to-catch-up, no jerk.
   */
  it('Test 5: no sudden camera.up angle jumps during movement (no snap-to-catch-up jerk)', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Settle
    for (let i = 0; i < 10; i++) stepFrame(walker, camera, controller, 0, 0, dt);

    // Move at constant speed for 60 frames, then stop for 20 frames (triggers snap-to-catch-up)
    const upVectors: THREE.Vector3[] = [];

    for (let i = 0; i < 60; i++) {
      stepFrame(walker, camera, controller, 1, 0, dt);
      upVectors.push(camera.up.clone());
    }
    for (let i = 0; i < 20; i++) {
      stepFrame(walker, camera, controller, 0, 0, dt); // stop
      upVectors.push(camera.up.clone());
    }

    // Measure per-frame angular change of camera.up
    const upAngles: number[] = [];
    for (let i = 1; i < upVectors.length; i++) {
      const angle = upVectors[i].angleTo(upVectors[i - 1]);
      upAngles.push(angle);
    }

    // With lerp: when player stops, the lerp suddenly "catches up" → spike in upAngles
    // This spike is the "snap" that the user sees as jerk
    // With copy: no catch-up needed, no spike

    // Non-zero values (to ensure camera is actually updating)
    const nonZeroAngles = upAngles.filter(a => a > 1e-6);
    if (nonZeroAngles.length > 0) {
      const mean = nonZeroAngles.reduce((a, b) => a + b) / nonZeroAngles.length;
      const maxAngle = Math.max(...upAngles);

      // No single frame should have >3x the average angular change (jerk threshold)
      const jerkFrames = upAngles.filter(a => a > mean * 3).length;
      expect(jerkFrames).toBeLessThan(2); // At most 1 jerk frame (transition edge)

      // Max angle per frame should be small
      const maxDegrees = maxAngle * (180 / Math.PI);
      expect(maxDegrees).toBeLessThan(10); // < 10 degrees snap at any frame
    }
  });
});
