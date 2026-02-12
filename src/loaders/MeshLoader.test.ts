/**
 * Tests for MeshLoader - arbitrary mesh loading and processing.
 *
 * Tests the core geometry processing pipeline:
 * - Multi-mesh extraction and merging
 * - Size normalization
 * - BVH-readiness of output
 * - MeshSurface compatibility
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

/**
 * Simulate what MeshLoader.processLoadedObject does:
 * Extract geometries, merge, normalize, create walkable mesh.
 * We test the pipeline directly since OBJLoader/GLTFLoader need a DOM.
 */

function extractGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      if (geo.attributes.position) {
        geometries.push(geo);
      }
    }
  });
  return geometries;
}

function mergeAndClean(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) throw new Error('No meshes found');

  if (geometries.length === 1) {
    geometries[0].computeVertexNormals();
    return geometries[0];
  }

  // Strip to position-only before merge
  const stripped = geometries.map((geo) => {
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', geo.attributes.position);
    if (geo.index) newGeo.setIndex(geo.index);
    return newGeo;
  });

  // Manual merge since we can't import BufferGeometryUtils in vitest easily
  let totalVertices = 0;
  let totalIndices = 0;
  for (const geo of stripped) {
    totalVertices += geo.attributes.position.count;
    totalIndices += geo.index ? geo.index.count : geo.attributes.position.count;
  }

  const positions = new Float32Array(totalVertices * 3);
  const indices: number[] = [];
  let vertexOffset = 0;
  let posOffset = 0;

  for (const geo of stripped) {
    const posArr = geo.attributes.position.array as Float32Array;
    positions.set(posArr, posOffset);

    if (geo.index) {
      const idxArr = geo.index.array;
      for (let i = 0; i < idxArr.length; i++) {
        indices.push(idxArr[i] + vertexOffset);
      }
    } else {
      for (let i = 0; i < geo.attributes.position.count; i++) {
        indices.push(i + vertexOffset);
      }
    }

    vertexOffset += geo.attributes.position.count;
    posOffset += posArr.length;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

function normalizeSize(geometry: THREE.BufferGeometry, targetRadius: number): { scaleFactor: number; originalSize: THREE.Vector3 } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const originalSize = size.clone();
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scaleFactor = (targetRadius * 2) / maxDim;
  geometry.scale(scaleFactor, scaleFactor, scaleFactor);
  return { scaleFactor, originalSize };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeshLoader Pipeline', () => {

  describe('extractGeometries', () => {
    it('should extract geometry from a single mesh', () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
      const group = new THREE.Group();
      group.add(mesh);

      const geos = extractGeometries(group);
      expect(geos).toHaveLength(1);
      expect(geos[0].attributes.position).toBeDefined();
    });

    it('should extract geometries from nested hierarchy', () => {
      const group = new THREE.Group();
      const child1 = new THREE.Group();
      const child2 = new THREE.Group();
      group.add(child1);
      group.add(child2);

      child1.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
      child2.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6)));

      // Add a non-mesh child (should be ignored)
      child1.add(new THREE.PointLight(0xffffff));

      const geos = extractGeometries(group);
      expect(geos).toHaveLength(2);
    });

    it('should apply parent transforms to extracted geometry', () => {
      const group = new THREE.Group();
      const child = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
      child.position.set(10, 0, 0);
      group.add(child);

      const geos = extractGeometries(group);
      expect(geos).toHaveLength(1);

      // Check that the vertices are offset by the child's position
      const positions = geos[0].attributes.position;
      let maxX = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        maxX = Math.max(maxX, positions.getX(i));
      }
      // Box is 2x2x2 at position (10,0,0), so max X should be ~11
      expect(maxX).toBeGreaterThan(9);
    });

    it('should return empty array for scene with no meshes', () => {
      const group = new THREE.Group();
      group.add(new THREE.PointLight());
      group.add(new THREE.AmbientLight());

      const geos = extractGeometries(group);
      expect(geos).toHaveLength(0);
    });
  });

  describe('mergeAndClean', () => {
    it('should throw for empty geometry array', () => {
      expect(() => mergeAndClean([])).toThrow('No meshes found');
    });

    it('should pass through single geometry', () => {
      const geo = new THREE.BoxGeometry(2, 2, 2);
      const result = mergeAndClean([geo]);
      expect(result.attributes.position).toBeDefined();
      expect(result.attributes.normal).toBeDefined();
    });

    it('should merge multiple geometries', () => {
      const geo1 = new THREE.BoxGeometry(2, 2, 2, 1, 1, 1);
      const geo2 = new THREE.BoxGeometry(2, 2, 2, 1, 1, 1);

      const count1 = geo1.attributes.position.count;
      const count2 = geo2.attributes.position.count;

      const merged = mergeAndClean([geo1, geo2]);
      expect(merged.attributes.position.count).toBe(count1 + count2);
    });

    it('should compute normals on merged geometry', () => {
      const geo1 = new THREE.BoxGeometry(2, 2, 2);
      const geo2 = new THREE.SphereGeometry(1, 8, 6);

      const merged = mergeAndClean([geo1, geo2]);
      expect(merged.attributes.normal).toBeDefined();
      expect(merged.attributes.normal.count).toBe(merged.attributes.position.count);
    });
  });

  describe('normalizeSize', () => {
    it('should center geometry at origin', () => {
      const geo = new THREE.BoxGeometry(2, 2, 2);
      // Offset the geometry
      geo.translate(10, 20, 30);

      normalizeSize(geo, 8);

      geo.computeBoundingBox();
      const center = new THREE.Vector3();
      geo.boundingBox!.getCenter(center);
      expect(center.x).toBeCloseTo(0, 1);
      expect(center.y).toBeCloseTo(0, 1);
      expect(center.z).toBeCloseTo(0, 1);
    });

    it('should scale to target radius', () => {
      const geo = new THREE.BoxGeometry(100, 50, 25);

      normalizeSize(geo, 8);

      geo.computeBoundingBox();
      const size = new THREE.Vector3();
      geo.boundingBox!.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      expect(maxDim).toBeCloseTo(16, 0); // 2 * targetRadius
    });

    it('should return original size and scale factor', () => {
      const geo = new THREE.BoxGeometry(20, 10, 5);
      const { scaleFactor, originalSize } = normalizeSize(geo, 8);

      expect(originalSize.x).toBeCloseTo(20, 0);
      expect(originalSize.y).toBeCloseTo(10, 0);
      expect(originalSize.z).toBeCloseTo(5, 0);
      expect(scaleFactor).toBeCloseTo(16 / 20, 2); // targetDiameter / maxDim
    });
  });

  describe('Full pipeline: loaded mesh to MeshSurface', () => {
    /**
     * Simulate loading a multi-part object (like a teapot with body + lid + spout).
     * Verify the merged result works with MeshSurface and MeshWalker.
     */
    it('should create walkable surface from multi-part object', () => {
      // Simulate a "teapot" as body sphere + spout cylinder + lid disc
      const group = new THREE.Group();

      // Body
      const body = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12));
      group.add(body);

      // Spout (offset to the side)
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 3, 8));
      spout.position.set(5, 0, 0);
      spout.rotation.z = Math.PI / 2;
      group.add(spout);

      // Lid (on top)
      const lid = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2));
      lid.position.set(0, 5, 0);
      group.add(lid);

      // Extract, merge, normalize
      const geos = extractGeometries(group);
      expect(geos).toHaveLength(3);

      const merged = mergeAndClean(geos);
      normalizeSize(merged, 8);

      // Create mesh and verify MeshSurface works
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(merged, material);

      const surface = new MeshSurface(mesh);

      // Test closest point query
      const result = surface.closestPointOnSurface(new THREE.Vector3(0, 20, 0));
      expect(result).not.toBeNull();
      expect(result!.point).toBeDefined();
      expect(result!.normal).toBeDefined();

      // Test walker can move on the surface
      const walker = new MeshWalker(surface, new THREE.Vector3(0, 20, 0), 3.0);
      const initialPos = walker.position.clone();

      walker.move(new THREE.Vector3(1, 0, 0), 0.1);
      expect(walker.position.distanceTo(initialPos)).toBeGreaterThan(0);

      surface.dispose();
    });

    it('should handle object with scaled parent', () => {
      const group = new THREE.Group();
      group.scale.set(0.01, 0.01, 0.01); // Common in imported models (cm vs m)

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100, 4, 4, 4));
      group.add(mesh);

      const geos = extractGeometries(group);
      const merged = mergeAndClean(geos);
      normalizeSize(merged, 8);

      const surfaceMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      const surface = new MeshSurface(surfaceMesh);

      // Should work at normalized scale regardless of original
      const result = surface.closestPointOnSurface(new THREE.Vector3(0, 20, 0));
      expect(result).not.toBeNull();

      surface.dispose();
    });

    it('should maintain movement quality on merged mesh', () => {
      // Create a "dumbbell" shape: two spheres connected by a cylinder
      const group = new THREE.Group();

      const left = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12));
      left.position.set(-5, 0, 0);
      group.add(left);

      const right = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12));
      right.position.set(5, 0, 0);
      group.add(right);

      const bar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 12, 4));
      bar.rotation.z = Math.PI / 2;
      group.add(bar);

      const geos = extractGeometries(group);
      const merged = mergeAndClean(geos);
      normalizeSize(merged, 8);

      const surfaceMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      const surface = new MeshSurface(surfaceMesh);

      // Walk across the surface - should stay on it
      const walker = new MeshWalker(surface, new THREE.Vector3(0, 10, 0), 3.0);

      for (let i = 0; i < 50; i++) {
        walker.move(new THREE.Vector3(1, 0, 0), 0.05);

        // Verify still on surface
        const check = surface.closestPointOnSurface(walker.position);
        expect(check).not.toBeNull();
        expect(check!.distance).toBeLessThan(0.5);
      }

      surface.dispose();
    });

    it('should work with high-poly geometry', () => {
      // Simulate a detailed model (high triangle count)
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 48));
      group.add(mesh);

      const geos = extractGeometries(group);
      const merged = mergeAndClean(geos);
      normalizeSize(merged, 8);

      const surfaceMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      const surface = new MeshSurface(surfaceMesh);

      // High-poly should still be fast for queries
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const randomPoint = new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
        );
        surface.closestPointOnSurface(randomPoint);
      }
      const elapsed = performance.now() - start;

      // 100 queries should complete in under 100ms (BVH acceleration)
      expect(elapsed).toBeLessThan(100);

      surface.dispose();
    });
  });
});
