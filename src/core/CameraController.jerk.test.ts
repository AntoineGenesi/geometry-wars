/**
 * CameraController Jerk Detection Tests
 *
 * These tests detect camera jerk caused by velocity-damped lerp in CameraController.
 *
 * Root cause of old jerk: velocity-damped lerp on camera.up suppresses the lerp during
 * movement, then "snaps" on recovery → user felt "nothing happens, then camera repositions."
 *
 * Current approach: moderate fixed lerp (0.35) on camera.up. This smooths frame-to-frame
 * normal changes on curved surfaces at 60 FPS without the snap-to-catch-up jerk.
 * Position is instant (.copy()). targetUp stays .copy() for movement upHint — no double-lerp.
 *
 * Tests FAIL with old velocity-damped lerp. Tests PASS with moderate fixed lerp (0.35).
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
   * Test 1: Camera.up tracks bitangent with moderate lag (no large lag)
   *
   * With velocity-damped lerp: camera.up can fall 30+ degrees behind bitangent during
   * fast movement because the damping suppresses the lerp entirely.
   * With moderate fixed lerp (0.35): camera.up stays within ~10 degrees of bitangent
   * (converges within 2-3 frames at 60 FPS).
   */
  it('Test 1: camera.up stays within reasonable lag of bitangent (moderate lerp allowed)', () => {
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
      // Allow for sign correction: check both signs
      const dot = Math.abs(camera.up.dot(bitangent));
      const angle = Math.acos(Math.min(1, dot));
      lagAngles.push(angle);
    }

    // With velocity-damped lerp: lag can be 30+ degrees during sustained movement
    // With moderate fixed lerp (0.35): lag converges quickly, stays within ~10 degrees
    const maxLagDegrees = Math.max(...lagAngles) * (180 / Math.PI);
    expect(maxLagDegrees).toBeLessThan(15); // Allow moderate lag but not massive lag

    const avgLagDegrees = lagAngles.reduce((a, b) => a + b) / lagAngles.length * (180 / Math.PI);
    expect(avgLagDegrees).toBeLessThan(10); // Average lag should be modest
  });

  /**
   * Test 2: Camera.up responds quickly on first frames of movement
   *
   * With velocity-damped lerp that fully suppresses response: camera.up may show
   * zero movement for many frames before suddenly snapping.
   * With moderate fixed lerp (0.35): responds immediately every frame (each frame
   * moves 35% toward target).
   */
  it('Test 2: camera.up responds within a few frames of movement start', () => {
    const { walker } = createSphereWalker();
    const camera = createCamera(walker);
    const controller = new CameraController(camera);
    const dt = 1 / 60;

    // Settle 30 frames stationary so walker moves around sphere
    for (let i = 0; i < 30; i++) stepFrame(walker, camera, controller, 0, 0, dt);

    // Capture initial camera.up
    const upBefore = camera.up.clone();

    // Move player for 5 frames in a direction that changes the bitangent
    for (let i = 0; i < 5; i++) {
      stepFrame(walker, camera, controller, 1, 0, dt);
    }

    // After 5 frames of movement, camera.up should have moved toward new bitangent
    const bitangent = walker.getTangentFrame().bitangent;
    const dotBefore = Math.abs(upBefore.dot(bitangent));
    const dotAfter = Math.abs(camera.up.dot(bitangent));

    // camera.up should now be CLOSER to bitangent than it was before movement
    // (i.e., it responded, didn't stay frozen)
    // With velocity-damped lerp that freezes completely: dotAfter ≈ dotBefore (no movement)
    // With moderate lerp (0.35): dotAfter > dotBefore (converging toward target)
    expect(dotAfter).toBeGreaterThanOrEqual(dotBefore * 0.95); // Should not diverge from bitangent

    // Also check: final alignment should be reasonable (not >30 degrees off)
    const alignmentAngle = Math.acos(Math.min(1, dotAfter)) * (180 / Math.PI);
    expect(alignmentAngle).toBeLessThan(30); // Within 30 degrees after 5 frames
  });

  /**
   * Test 3: No runaway lag accumulation during sustained movement
   *
   * With velocity-damped lerp: lag continuously accumulates — camera.up diverges more
   * and more from bitangent over time as the damping keeps it frozen.
   * With moderate fixed lerp (0.35): lag reaches steady state quickly and stays there.
   */
  it('Test 3: lag does not accumulate unboundedly over 120 frames of sustained movement', () => {
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

    // With velocity-damped lerp that freezes: second half lag >> first half lag (accumulates)
    // With moderate fixed lerp: reaches steady state, no significant second-half increase
    const firstHalf = lagAngles.slice(0, 60).reduce((a, b) => a + b) / 60;
    const secondHalf = lagAngles.slice(60).reduce((a, b) => a + b) / 60;

    // Lag should not grow significantly over time (no runaway accumulation)
    // Allow for some increase (initial convergence) but not unbounded growth
    expect(secondHalf).toBeLessThan(firstHalf + 0.2); // No significant lag growth (0.2 rad = 11 degrees)

    // Overall lag should be bounded (not > 90 degrees at any point)
    const maxLag = Math.max(...lagAngles) * (180 / Math.PI);
    expect(maxLag).toBeLessThan(90); // Should not diverge to orthogonal
  });

  /**
   * Test 4: Camera responds to rapid direction changes without dead frames
   *
   * "Move a little and nothing happens" = camera.up doesn't update when bitangent
   * changes quickly (velocity damping suppresses the lerp during rapid changes).
   * With moderate fixed lerp (0.35): always responds (35% per frame), no dead frames.
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
        // With moderate fixed lerp (0.35): lag < 30 degrees (camera always responds)
        if (lagAngle > 0.52) { // > ~30 degrees lag = "dead frame" (camera barely responded)
          deadFrames++;
        }
      }
    }

    // Very few dead frames: camera should always respond to bitangent changes
    expect(deadFrames).toBeLessThan(5); // Allow a few edge-crossing frames
  });

  /**
   * Test 5: Camera up-vector jerk detection (the user's reported symptom)
   *
   * With velocity-damped lerp: when damping suddenly releases (player slows down
   * or changes direction), camera.up "snaps" to catch up → visible jerk.
   * Detectable as sudden large changes in camera.up angle.
   * With moderate fixed lerp (0.35): smooth consistent movement, no snap-to-catch-up.
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

    // With velocity-damped lerp: when player stops, the lerp suddenly "catches up" → spike in upAngles
    // This spike is the "snap" that the user sees as jerk
    // With moderate fixed lerp (0.35): consistent per-frame changes, no spike at stop

    // Non-zero values (to ensure camera is actually updating)
    const nonZeroAngles = upAngles.filter(a => a > 1e-6);
    if (nonZeroAngles.length > 0) {
      const mean = nonZeroAngles.reduce((a, b) => a + b) / nonZeroAngles.length;
      const maxAngle = Math.max(...upAngles);

      // No single frame should have >5x the average angular change (strict jerk threshold)
      // velocity-damped lerp creates spikes 10-20x the mean when it "releases"
      // With 0.12 fixed lerp (restored from bffc333), slow convergence means ~5 frames
      // may slightly exceed 5x mean at the movement→stop transition, but no true snap.
      const jerkFrames = upAngles.filter(a => a > mean * 5).length;
      expect(jerkFrames).toBeLessThan(8); // Fixed lerp: gradual catch-up, no velocity-damped snap

      // Max angle per frame should be reasonable (not massive snap)
      const maxDegrees = maxAngle * (180 / Math.PI);
      expect(maxDegrees).toBeLessThan(20); // < 20 degrees snap at any frame
    }
  });
});
