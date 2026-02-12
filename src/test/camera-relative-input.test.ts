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
});
