/**
 * Tests for camera-relative input mapping in MeshWalker.
 *
 * Verifies that moveFromInput() and getAimDirection() correctly project
 * camera axes onto the surface tangent plane, so WASD/aim matches what
 * the player sees on screen even with camera orbit.
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createWalkerOnSphere(radius = 10): { walker: MeshWalker; surface: MeshSurface } {
  const surf = SurfaceFactory.create('sphere', { radius });
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, 3);
  return { walker, surface: meshSurface };
}

/** Create a camera positioned above the walker, looking down at it */
function makeTopDownCamera(walker: MeshWalker, distance = 15): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, distance);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('Camera-Relative Input', () => {
  describe('moveFromInput with top-down camera', () => {
    it('should move right when pressing D (inputX=1)', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const startPos = walker.position.clone();

      walker.moveFromInput(1, 0, camera, 0.1);

      const moved = startPos.distanceTo(walker.position);
      expect(moved).toBeGreaterThan(0.01);
    });

    it('should move up when pressing W (inputY=1 after caller negation)', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const startPos = walker.position.clone();

      walker.moveFromInput(0, 1, camera, 0.1);

      const moved = startPos.distanceTo(walker.position);
      expect(moved).toBeGreaterThan(0.01);
    });

    it('should produce different directions for D vs W', () => {
      const { walker: walkerD } = createWalkerOnSphere();
      const { walker: walkerW } = createWalkerOnSphere();

      const cameraD = makeTopDownCamera(walkerD);
      const cameraW = makeTopDownCamera(walkerW);

      const startPos = walkerD.position.clone();

      walkerD.moveFromInput(1, 0, cameraD, 0.1);
      walkerW.moveFromInput(0, 1, cameraW, 0.1);

      const displacementD = walkerD.position.clone().sub(startPos);
      const displacementW = walkerW.position.clone().sub(startPos);

      // D and W should produce clearly different displacements (>45° apart)
      // On curved surfaces, they won't be exactly perpendicular
      const dot = displacementD.normalize().dot(displacementW.normalize());
      expect(Math.abs(dot)).toBeLessThan(0.7);
    });
  });

  describe('camera orbit changes movement direction', () => {
    it('should move in a different world direction after camera orbits 90°', () => {
      // First walker: camera at default orientation
      const { walker: w1 } = createWalkerOnSphere();
      const cam1 = makeTopDownCamera(w1);
      const start1 = w1.position.clone();
      w1.moveFromInput(1, 0, cam1, 0.1);
      const dir1 = w1.position.clone().sub(start1).normalize();

      // Second walker: camera rotated 90° around normal (yaw orbit)
      const { walker: w2 } = createWalkerOnSphere();
      const cam2 = makeTopDownCamera(w2);
      // Rotate camera 90° around the walker's normal
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(w2.normal, Math.PI / 2);
      const offset = cam2.position.clone().sub(w2.position);
      offset.applyQuaternion(yawQuat);
      cam2.position.copy(w2.position).add(offset);
      cam2.up.applyQuaternion(yawQuat);
      cam2.lookAt(w2.position);
      cam2.updateMatrixWorld(true);

      const start2 = w2.position.clone();
      w2.moveFromInput(1, 0, cam2, 0.1);
      const dir2 = w2.position.clone().sub(start2).normalize();

      // Pressing D with camera rotated 90° should produce clearly different direction
      const dot = dir1.dot(dir2);
      expect(Math.abs(dot)).toBeLessThan(0.7);
    });
  });

  describe('getAimDirection with top-down camera', () => {
    it('should return a direction in the tangent plane', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);

      const aimDir = walker.getAimDirection(1, 0, camera);

      // Should be approximately perpendicular to normal (in tangent plane)
      const dotNormal = Math.abs(aimDir.dot(walker.normal));
      expect(dotNormal).toBeLessThan(0.05);
      expect(aimDir.length()).toBeCloseTo(1.0, 1);
    });

    it('should produce different aim for aimX vs -aimY', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);

      const aimRight = walker.getAimDirection(1, 0, camera);
      const aimUp = walker.getAimDirection(0, -1, camera);

      // Right and Up should produce clearly different directions (>45° apart)
      const dot = aimRight.dot(aimUp);
      expect(Math.abs(dot)).toBeLessThan(0.7);
    });
  });

  describe('upHint stable camera axes', () => {
    it('should move right with upHint=bitangent (same as camera quaternion path)', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const frame = walker.getTangentFrame();

      // With upHint
      const { walker: w2 } = createWalkerOnSphere();
      const cam2 = makeTopDownCamera(w2);

      const start1 = walker.position.clone();
      walker.moveFromInput(1, 0, camera, 0.1, frame.bitangent);
      const dir1 = walker.position.clone().sub(start1).normalize();

      const start2 = w2.position.clone();
      w2.moveFromInput(1, 0, cam2, 0.1);
      const dir2 = w2.position.clone().sub(start2).normalize();

      // Both paths should produce very similar direction
      const dot = dir1.dot(dir2);
      expect(dot).toBeGreaterThan(0.95);
    });

    it('should produce stable direction over many frames even with camera up lerp lag', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const dt = 1 / 60;

      // Simulate camera.up lagging behind (lerp factor 0.12 like CameraController)
      // On a sphere, moving laterally changes the bitangent direction.
      // With the legacy path, the lerped camera.up would cause direction oscillation.
      // With upHint, it should be stable.
      const directions: THREE.Vector3[] = [];

      for (let i = 0; i < 30; i++) {
        const startPos = walker.position.clone();
        const frame = walker.getTangentFrame();

        // Move with upHint (stable path)
        walker.moveFromInput(1, 0, camera, dt, frame.bitangent);

        const displacement = walker.position.clone().sub(startPos);
        if (displacement.lengthSq() > 0.0001) {
          directions.push(displacement.normalize());
        }

        // Simulate camera following with lerp (like CameraController does)
        const targetCamPos = walker.normal.clone().multiplyScalar(15).add(walker.position);
        camera.position.lerp(targetCamPos, 0.12);
        const newFrame = walker.getTangentFrame();
        (camera as THREE.PerspectiveCamera).up.lerp(newFrame.bitangent, 0.12).normalize();
        camera.lookAt(walker.position);
        camera.updateMatrixWorld(true);
      }

      // Verify no direction sign flips (all should be roughly the same direction)
      expect(directions.length).toBeGreaterThan(10);
      let signFlips = 0;
      for (let i = 1; i < directions.length; i++) {
        const dot = directions[i].dot(directions[0]);
        if (dot < 0) signFlips++;
      }
      expect(signFlips).toBe(0);
    });

    it('should produce aim direction with upHint', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const frame = walker.getTangentFrame();

      const aimDir = walker.getAimDirection(1, 0, camera, frame.bitangent);

      expect(aimDir.length()).toBeCloseTo(1.0, 1);
      const dotNormal = Math.abs(aimDir.dot(walker.normal));
      expect(dotNormal).toBeLessThan(0.05);
    });
  });

  describe('fallback for default/test cameras', () => {
    it('should still move with a default camera (not positioned above surface)', () => {
      const { walker } = createWalkerOnSphere();
      const camera = new THREE.PerspectiveCamera(); // default: at origin, looking along -Z
      const startPos = walker.position.clone();

      walker.moveFromInput(1, 0, camera, 0.1);

      // Should still move (tangent frame fallback)
      const moved = startPos.distanceTo(walker.position);
      expect(moved).toBeGreaterThan(0.01);
    });

    it('should produce aim direction with a default camera', () => {
      const { walker } = createWalkerOnSphere();
      const camera = new THREE.PerspectiveCamera();

      const aimDir = walker.getAimDirection(1, 0.5, camera);

      // Should be normalized and in tangent plane
      expect(aimDir.length()).toBeCloseTo(1.0, 1);
      const dotNormal = Math.abs(aimDir.dot(walker.normal));
      expect(dotNormal).toBeLessThan(0.05);
    });
  });

  describe('tangent frame stability (anti-oscillation)', () => {
    it('should maintain stable bitangent over 120 frames of diagonal movement', () => {
      // This tests the hysteresis fix: moving at 45° to the tangent frame axes
      // used to cause the tangent/bitangent to swap every other frame, making
      // the bitangent oscillate and causing chevron spinning + map jumping.
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const dt = 1 / 60;

      const bitangents: THREE.Vector3[] = [];

      // Move diagonally (45° between tangent and bitangent)
      for (let i = 0; i < 120; i++) {
        const frame = walker.getTangentFrame();
        bitangents.push(frame.bitangent.clone());
        walker.moveFromInput(0.707, 0.707, camera, dt, frame.bitangent);
        // Update camera to follow
        camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
        camera.up.copy(frame.bitangent);
        camera.lookAt(walker.position);
        camera.updateMatrixWorld(true);
      }

      // Count how many times the bitangent flips sign (dot with previous < 0)
      let signFlips = 0;
      for (let i = 1; i < bitangents.length; i++) {
        if (bitangents[i].dot(bitangents[i - 1]) < 0) {
          signFlips++;
        }
      }

      // With hysteresis fix: should have 0 or very few sign flips
      // Without fix: would have ~60 flips (every other frame)
      expect(signFlips).toBeLessThan(3);
    });

    it('should maintain stable tangent frame on sphere equator during lateral movement', () => {
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const dt = 1 / 60;

      // Move purely right (D key) for 60 frames
      const tangentAngles: number[] = [];
      let prevTangent = walker.getTangentFrame().tangent.clone();

      for (let i = 0; i < 60; i++) {
        const frame = walker.getTangentFrame();
        walker.moveFromInput(1, 0, camera, dt, frame.bitangent);
        camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
        camera.up.copy(frame.bitangent);
        camera.lookAt(walker.position);
        camera.updateMatrixWorld(true);

        const angleDelta = frame.tangent.angleTo(prevTangent);
        tangentAngles.push(angleDelta);
        prevTangent.copy(frame.tangent);
      }

      // Maximum angle change between consecutive frames should be small
      // (smooth rotation, not abrupt flips)
      const maxAngleDelta = Math.max(...tangentAngles);
      // On a sphere with radius 10, moving at speed 3 for 1/60s covers ~0.05 units
      // The tangent should rotate by at most a few degrees per frame
      expect(maxAngleDelta).toBeLessThan(0.3); // ~17 degrees max per frame
    });

    it('should keep orientation stable when pressing D on sphere (no chevron spin)', () => {
      // Simulate the exact scenario that caused "chevron spinning super fast":
      // Press D, track the aim direction every frame, verify no oscillation.
      const { walker } = createWalkerOnSphere();
      const camera = makeTopDownCamera(walker);
      const dt = 1 / 60;

      const aimDirs: THREE.Vector3[] = [];

      for (let i = 0; i < 60; i++) {
        const frame = walker.getTangentFrame();
        walker.moveFromInput(1, 0, camera, dt, frame.bitangent);
        // Aim direction with no mouse input (aimX=0, aimY=0)
        const aim = walker.getAimDirection(0, 0, camera, frame.bitangent);
        aimDirs.push(aim.clone());

        camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
        camera.up.copy(frame.bitangent);
        camera.lookAt(walker.position);
        camera.updateMatrixWorld(true);
      }

      // Count direction reversals (sign flips in dot product with previous)
      let reversals = 0;
      for (let i = 1; i < aimDirs.length; i++) {
        if (aimDirs[i].dot(aimDirs[i - 1]) < 0) {
          reversals++;
        }
      }

      // Should have 0 direction reversals (no spinning)
      expect(reversals).toBe(0);
    });
  });
});
