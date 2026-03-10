/**
 * PipeSurface geometry regression test
 *
 * Regression: createGrid() calls this.getRegion()/this.getProfile() which
 * access instance properties (innerFrac, radius, etc.) that are undefined
 * when called during super(config) in the constructor. This produces NaN
 * positions in the grid mesh, causing:
 *   THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN
 *
 * This test verifies the grid and surface mesh have no NaN positions.
 *
 * Bug discovered: s44r6-17 cross-surface verification
 * Fixed: s44r6-18
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PipeSurface } from './PipeSurface';

function hasNoNaN(attr: THREE.BufferAttribute, label: string): void {
  const arr = attr.array as Float32Array;
  for (let i = 0; i < arr.length; i++) {
    if (!isFinite(arr[i])) {
      throw new Error(`${label}: NaN/Inf at index ${i}, value=${arr[i]}`);
    }
  }
}

describe('PipeSurface geometry — NaN regression (s44r6-18)', () => {
  describe('with default config', () => {
    const surface = new PipeSurface();

    it('grid mesh has no NaN positions', () => {
      const posAttr = surface.gridMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      expect(posAttr).toBeTruthy();
      expect(posAttr.count).toBeGreaterThan(0);
      hasNoNaN(posAttr, 'grid position');
    });

    it('surface mesh has no NaN positions', () => {
      const posAttr = surface.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      expect(posAttr).toBeTruthy();
      expect(posAttr.count).toBeGreaterThan(0);
      hasNoNaN(posAttr, 'surface position');
    });

    it('grid mesh bounding sphere is finite', () => {
      surface.gridMesh.geometry.computeBoundingSphere();
      const bs = surface.gridMesh.geometry.boundingSphere;
      expect(bs).not.toBeNull();
      expect(isFinite(bs!.radius)).toBe(true);
      expect(bs!.radius).toBeGreaterThan(0);
    });

    it('surface mesh bounding sphere is finite', () => {
      surface.mesh.geometry.computeBoundingSphere();
      const bs = surface.mesh.geometry.boundingSphere;
      expect(bs).not.toBeNull();
      expect(isFinite(bs!.radius)).toBe(true);
      expect(bs!.radius).toBeGreaterThan(0);
    });
  });

  describe('with production config (scale=10, bevelRadius=0.6, gridSegmentsV=18)', () => {
    const surface = new PipeSurface({
      radius: 10,
      height: 20,
      bevelRadius: 0.6,
      gridSegmentsU: 24,
      gridSegmentsV: 18,
    });

    it('grid mesh has no NaN positions', () => {
      const posAttr = surface.gridMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      expect(posAttr).toBeTruthy();
      expect(posAttr.count).toBeGreaterThan(0);
      hasNoNaN(posAttr, 'grid position');
    });

    it('surface mesh bounding sphere is finite', () => {
      surface.mesh.geometry.computeBoundingSphere();
      const bs = surface.mesh.geometry.boundingSphere;
      expect(bs).not.toBeNull();
      expect(isFinite(bs!.radius)).toBe(true);
    });
  });
});
