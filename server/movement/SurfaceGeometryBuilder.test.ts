/**
 * SurfaceGeometryBuilder tests.
 *
 * Verifies that each surface type produces valid indexed geometry that:
 * 1. Has a position attribute with vertices
 * 2. Has an index (no non-indexed geometry)
 * 3. Is usable by MeshSurface (BVH + GeodesicSurface can be constructed)
 * 4. closestPointOnSurface() returns a non-null result
 *
 * NOTE: vitest cannot run in git worktrees — run these tests from the main
 * project root after merging.
 */

import * as THREE from 'three';
import { describe, test, expect } from 'vitest';
import { buildSurfaceGeometry, type SupportedSurface } from './SurfaceGeometryBuilder';
import { MeshSurface } from '../../src/surfaces/MeshSurface';

const ALL_SURFACES: SupportedSurface[] = [
  'sphere',
  'torus',
  'peanut',
  'cube',
  'pill',
  'capsule',
  'mobius',
  'icosahedron',
  'sphere-tunnel',
  'cube-ring',
  'cube-tunnel',
  'pipe',
  'mobius-bevel',
];

describe('SurfaceGeometryBuilder', () => {
  describe('buildSurfaceGeometry — geometry validity', () => {
    test.each(ALL_SURFACES)('builds valid %s geometry', (type) => {
      const mesh = buildSurfaceGeometry(type, 1.0);
      const geo = mesh.geometry;

      // Must have position attribute
      expect(geo.getAttribute('position')).toBeTruthy();
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      expect(pos.count).toBeGreaterThan(3);

      // Must have indices (non-indexed geometry wastes memory)
      expect(geo.getIndex()).not.toBeNull();
      expect(geo.getIndex()!.count).toBeGreaterThan(3);

      // No NaN vertices
      for (let i = 0; i < Math.min(pos.count, 100); i++) {
        expect(isNaN(pos.getX(i))).toBe(false);
        expect(isNaN(pos.getY(i))).toBe(false);
        expect(isNaN(pos.getZ(i))).toBe(false);
      }
    });
  });

  describe('buildSurfaceGeometry — scale factor', () => {
    test('sphere with scaleFactor=1.5 has vertices at radius ~15', () => {
      const mesh = buildSurfaceGeometry('sphere', 1.5);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;

      // Find the extreme vertex (should be near the pole, radius ~15)
      let maxDist = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2);
        maxDist = Math.max(maxDist, d);
      }
      expect(maxDist).toBeGreaterThan(14.9);
      expect(maxDist).toBeLessThan(16);
    });

    test('sphere with scaleFactor=1.0 has vertices at radius ~10', () => {
      const mesh = buildSurfaceGeometry('sphere', 1.0);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;

      let maxDist = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2);
        maxDist = Math.max(maxDist, d);
      }
      expect(maxDist).toBeGreaterThan(9.9);
      expect(maxDist).toBeLessThan(11);
    });

    test('torus majorRadius is ~8 (unscaled, matches client config)', () => {
      const mesh = buildSurfaceGeometry('torus', 1.0);
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;

      // Max distance from origin should be ~11 (majorR=8, minorR=3 → max = 11)
      let maxDist = 0;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2); // radial in XZ plane
        maxDist = Math.max(maxDist, d);
      }
      expect(maxDist).toBeGreaterThan(10);
      expect(maxDist).toBeLessThan(12);
    });
  });

  describe('buildSurfaceGeometry — MeshSurface integration', () => {
    // Core surfaces — must construct MeshSurface and return closest point
    test.each(['sphere', 'torus', 'peanut', 'cube', 'pill'] as SupportedSurface[])(
      'MeshSurface(%s) closestPointOnSurface returns non-null',
      (type) => {
        const mesh = buildSurfaceGeometry(type, 1.0);
        const surface = new MeshSurface(mesh);
        const result = surface.closestPointOnSurface(new THREE.Vector3(100, 0, 0));
        expect(result).not.toBeNull();
      },
    );

    // All surfaces should work
    test.each(ALL_SURFACES)(
      'MeshSurface(%s) constructs without throwing',
      (type) => {
        const mesh = buildSurfaceGeometry(type, 1.0);
        expect(() => new MeshSurface(mesh)).not.toThrow();
      },
    );
  });

  describe('buildSurfaceGeometry — mesh matrix', () => {
    test('returned mesh has identity world matrix', () => {
      const mesh = buildSurfaceGeometry('sphere', 1.0);
      const identity = new THREE.Matrix4().identity();
      expect(mesh.matrixWorld.equals(identity)).toBe(true);
    });
  });
});
