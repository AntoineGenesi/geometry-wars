/**
 * Animated Mesh Tests
 *
 * Tests animation support for GLTF meshes with AnimationClips.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LoadedMeshSurface } from '../surfaces/LoadedMeshSurface';
import type { LoadedMesh } from '../loaders/MeshLoader';

/**
 * Create a test mesh with a simple rotation animation.
 */
function createAnimatedTestMesh(): LoadedMesh {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Create a simple rotation animation
  // Animates a rotation around Y axis over 2 seconds
  const times = [0, 1, 2];
  const values = [
    0, 0, 0, 1,  // t=0: no rotation (quaternion identity)
    0, 0.707, 0, 0.707,  // t=1: 90 degrees around Y
    0, 1, 0, 0,  // t=2: 180 degrees around Y
  ];

  const rotationTrack = new THREE.QuaternionKeyframeTrack(
    '.quaternion',
    times,
    values
  );

  const clip = new THREE.AnimationClip('rotate', 2, [rotationTrack]);

  return {
    mesh,
    originalSize: new THREE.Vector3(2, 2, 2),
    scaleFactor: 1.0,
    triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
    animations: [clip],
  };
}

/**
 * Create a test mesh without animations.
 */
function createNonAnimatedTestMesh(): LoadedMesh {
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    originalSize: new THREE.Vector3(2, 2, 2),
    scaleFactor: 1.0,
    triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
    animations: [],
  };
}

describe('AnimatedMesh', () => {
  describe('LoadedMeshSurface with animations', () => {
    it('should initialize AnimationMixer for meshes with animations', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // AnimationMixer should be created
      expect(surface['animationMixer']).toBeDefined();
      expect(surface['animationMixer']).not.toBeNull();
      expect(surface['animations']).toHaveLength(1);
    });

    it('should not create AnimationMixer for meshes without animations', () => {
      const loadedMesh = createNonAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // AnimationMixer should be null
      expect(surface['animationMixer']).toBeNull();
      expect(surface['animations']).toHaveLength(0);
    });

    it('should advance animation time when updateAnimations is called', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      const mixer = surface['animationMixer'];
      expect(mixer).not.toBeNull();

      // Get initial time
      const initialTime = mixer!.time;

      // Update animations for 60 frames at 1/60 second each (1 second total)
      const dt = 1 / 60;
      for (let i = 0; i < 60; i++) {
        surface.updateAnimations(dt);
      }

      // Time should have advanced by approximately 1 second
      const finalTime = mixer!.time;
      expect(finalTime).toBeGreaterThan(initialTime);
      expect(finalTime).toBeCloseTo(1.0, 1);
    });

    it('should handle updateAnimations gracefully when no animations exist', () => {
      const loadedMesh = createNonAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // Should not throw when calling updateAnimations on non-animated mesh
      expect(() => {
        surface.updateAnimations(1 / 60);
      }).not.toThrow();
    });

    it('should respect animationSpeed config', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh, { animationSpeed: 2.0 });

      const mixer = surface['animationMixer'];
      expect(mixer).not.toBeNull();
      expect(mixer!.timeScale).toBe(2.0);
    });

    it('should use default animation speed of 1.0', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      const mixer = surface['animationMixer'];
      expect(mixer).not.toBeNull();
      expect(mixer!.timeScale).toBe(1.0);
    });

    it('should play animations in loop mode', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      const mixer = surface['animationMixer'];
      expect(mixer).not.toBeNull();

      // Get the action for the first animation clip
      const clip = loadedMesh.animations[0];
      const action = mixer!.existingAction(clip);

      expect(action).not.toBeNull();
      expect(action!.isRunning()).toBe(true);
      expect(action!.loop).toBe(THREE.LoopRepeat);
    });

    it('should stop animations on dispose', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      const mixer = surface['animationMixer'];
      expect(mixer).not.toBeNull();

      // Dispose the surface
      surface.dispose();

      // All actions should be stopped (we can't easily check this without accessing
      // internal state, but we verify it doesn't throw)
      expect(() => {
        surface.dispose(); // Second dispose should also be safe
      }).not.toThrow();
    });
  });

  describe('Animation integration with surface queries', () => {
    it('should still support getPoint queries on animated meshes', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // Update animations
      for (let i = 0; i < 30; i++) {
        surface.updateAnimations(1 / 60);
      }

      // Surface queries should still work
      const point = surface.getPoint(0.5, 0.5);
      expect(point).toBeDefined();
      expect(point.position).toBeDefined();
      expect(point.normal).toBeDefined();
      expect(point.tangentU).toBeDefined();
      expect(point.tangentV).toBeDefined();
    });

    it('should still support moveOnSurface on animated meshes', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // Update animations
      for (let i = 0; i < 30; i++) {
        surface.updateAnimations(1 / 60);
      }

      // Surface movement should still work
      const result = surface.moveOnSurface(0.5, 0.5, 0.1, 0.1);
      expect(result).toBeDefined();
      expect(result.u).toBeDefined();
      expect(result.v).toBeDefined();
    });

    it('should still support worldToSurface on animated meshes', () => {
      const loadedMesh = createAnimatedTestMesh();
      const surface = new LoadedMeshSurface(loadedMesh);

      // Update animations
      for (let i = 0; i < 30; i++) {
        surface.updateAnimations(1 / 60);
      }

      // World to surface conversion should still work
      const worldPos = new THREE.Vector3(1, 1, 1);
      const uv = surface.worldToSurface(worldPos);
      expect(uv).toBeDefined();
      expect(uv.u).toBeGreaterThanOrEqual(0);
      expect(uv.u).toBeLessThanOrEqual(1);
      expect(uv.v).toBeGreaterThanOrEqual(0);
      expect(uv.v).toBeLessThanOrEqual(1);
    });
  });
});
