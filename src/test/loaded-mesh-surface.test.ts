/**
 * LoadedMeshSurface Unit Tests
 *
 * Tests the UV-based surface wrapper for arbitrary loaded meshes.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LoadedMeshSurface } from '../surfaces/LoadedMeshSurface';
import type { LoadedMesh } from '../loaders/MeshLoader';

/**
 * Create a simple test mesh (sphere) in LoadedMesh format.
 */
function createTestMesh(radius = 8): LoadedMesh {
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    originalSize: new THREE.Vector3(radius * 2, radius * 2, radius * 2),
    scaleFactor: 1.0,
    triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
    animations: [],
  };
}

describe('LoadedMeshSurface', () => {
  describe('construction', () => {
    it('should create a surface from a loaded mesh', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      expect(surface).toBeDefined();
      expect(surface.loadedMesh).toBe(loadedMesh);
      expect(surface.mesh).toBeDefined();
      expect(surface.gridMesh).toBeDefined();
      expect(surface.group).toBeDefined();
      expect(surface.group.children.length).toBe(2); // mesh + grid
    });
  });

  describe('getPoint()', () => {
    it('should return valid surface points for UV coordinates', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const center = surface.getPoint(0.5, 0.5);
      expect(center.position).toBeInstanceOf(THREE.Vector3);
      expect(center.normal).toBeInstanceOf(THREE.Vector3);
      expect(center.tangentU).toBeInstanceOf(THREE.Vector3);
      expect(center.tangentV).toBeInstanceOf(THREE.Vector3);
    });

    it('should place points approximately on the sphere surface', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const point = surface.getPoint(0.5, 0.5);
      const distFromOrigin = point.position.length();

      // Should be close to radius 8 (within 0.5 tolerance)
      expect(distFromOrigin).toBeGreaterThan(7.5);
      expect(distFromOrigin).toBeLessThan(8.5);
    });

    it('should return normals pointing outward', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const point = surface.getPoint(0.5, 0.5);
      const normalizedPos = point.position.clone().normalize();
      const dot = point.normal.dot(normalizedPos);

      // Normal should point roughly same direction as position (outward)
      expect(dot).toBeGreaterThan(0.9);
    });

    it('should handle multiple UV positions without errors', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const testPoints = [
        { u: 0, v: 0.5 },
        { u: 0.25, v: 0.5 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.5 },
        { u: 0.5, v: 0.1 },
        { u: 0.5, v: 0.9 },
      ];

      for (const { u, v } of testPoints) {
        const point = surface.getPoint(u, v);
        const dist = point.position.length();
        expect(dist).toBeGreaterThan(7);
        expect(dist).toBeLessThan(9);
      }
    });
  });

  describe('worldToSurface()', () => {
    it('should perform inverse mapping from world to UV', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const testUV = { u: 0.3, v: 0.7 };
      const point = surface.getPoint(testUV.u, testUV.v);
      const recoveredUV = surface.worldToSurface(point.position);

      // Allow small error due to floating point and projection
      expect(Math.abs(recoveredUV.u - testUV.u)).toBeLessThan(0.05);
      expect(Math.abs(recoveredUV.v - testUV.v)).toBeLessThan(0.05);
    });

    it('should map U=0 and U=1 to similar positions', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const point0 = surface.getPoint(0, 0.5);
      const point1 = surface.getPoint(1, 0.5);
      const dist = point0.position.distanceTo(point1.position);

      // U wraps, so 0 and 1 should be the same longitude
      expect(dist).toBeLessThan(0.5);
    });
  });

  describe('moveOnSurface()', () => {
    it('should change UV coordinates when moving', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const startUV = { u: 0.25, v: 0.5 };
      const movedUV = surface.moveOnSurface(startUV.u, startUV.v, 0.15, 0.15);

      // Check that EITHER u or v changed (may not be exactly du/dv due to projection)
      const uChanged = Math.abs(movedUV.u - startUV.u) > 0.001;
      const vChanged = Math.abs(movedUV.v - startUV.v) > 0.001;
      expect(uChanged || vChanged).toBe(true);
    });

    it('should keep moved points on the surface', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const startUV = { u: 0.5, v: 0.5 };
      const movedUV = surface.moveOnSurface(startUV.u, startUV.v, 0.1, 0.1);
      const movedPoint = surface.getPoint(movedUV.u, movedUV.v);
      const dist = movedPoint.position.length();

      expect(dist).toBeGreaterThan(7.5);
      expect(dist).toBeLessThan(8.5);
    });

    it('should handle multiple sequential moves', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      let currentUV = { u: 0.5, v: 0.5 };
      for (let i = 0; i < 10; i++) {
        currentUV = surface.moveOnSurface(currentUV.u, currentUV.v, 0.01, 0.01);
      }

      const finalPoint = surface.getPoint(currentUV.u, currentUV.v);
      const finalDist = finalPoint.position.length();
      expect(finalDist).toBeGreaterThan(7);
      expect(finalDist).toBeLessThan(9);
    });

    it('should return unchanged UV for zero movement', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const startUV = { u: 0.5, v: 0.5 };
      const movedUV = surface.moveOnSurface(startUV.u, startUV.v, 0, 0);

      expect(movedUV.u).toBe(startUV.u);
      expect(movedUV.v).toBe(startUV.v);
    });
  });

  describe('UV wrapping', () => {
    it('should wrap U coordinates to [0, 1)', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const wrapped1 = surface.wrapUV(1.5, 0.5);
      expect(wrapped1.u).toBeGreaterThanOrEqual(0);
      expect(wrapped1.u).toBeLessThan(1);

      const wrapped2 = surface.wrapUV(-0.3, 0.5);
      expect(wrapped2.u).toBeGreaterThanOrEqual(0);
      expect(wrapped2.u).toBeLessThan(1);
    });

    it('should clamp V coordinates', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      const clamped1 = surface.wrapUV(0.5, 1.5);
      expect(clamped1.v).toBeLessThan(1);

      const clamped2 = surface.wrapUV(0.5, -0.1);
      expect(clamped2.v).toBeGreaterThan(0);
    });

    it('should report correct wrapping behavior', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      expect(surface.wrapsU).toBe(true);
      expect(surface.wrapsV).toBe(false);
    });
  });

  describe('no NaN values', () => {
    it('should not produce NaN in random queries', () => {
      const loadedMesh = createTestMesh(8);
      const surface = new LoadedMeshSurface(loadedMesh);

      function hasNaN(vec: THREE.Vector3): boolean {
        return isNaN(vec.x) || isNaN(vec.y) || isNaN(vec.z);
      }

      for (let i = 0; i < 100; i++) {
        const u = Math.random();
        const v = Math.random();
        const point = surface.getPoint(u, v);

        expect(hasNaN(point.position)).toBe(false);
        expect(hasNaN(point.normal)).toBe(false);
        expect(hasNaN(point.tangentU)).toBe(false);
        expect(hasNaN(point.tangentV)).toBe(false);
      }
    });
  });
});
