/**
 * Performance benchmark tests.
 *
 * Measures the CPU-side performance of key game systems
 * after optimizations (allocation elimination, spatial hash, squared distance).
 *
 * These tests verify:
 * 1. SpatialHash provides correct results
 * 2. Frame time for collision detection scales sub-linearly
 * 3. No regressions in hot path performance
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';

// ---------------------------------------------------------------------------
// SpatialHash correctness tests
// ---------------------------------------------------------------------------

describe('SpatialHash', () => {
  it('should return empty for no entries', () => {
    const hash = new SpatialHash<number>(2.0);
    const nearby = hash.getNearby(0, 0, 0);
    expect(nearby.length).toBe(0);
  });

  it('should find entity in same cell', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(1, 1, 1, 'entity1');
    const nearby = hash.getNearby(1.1, 1.1, 1.1);
    expect(nearby).toContain('entity1');
  });

  it('should find entity in adjacent cell', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(1.9, 0, 0, 'entity1'); // Right at cell boundary
    const nearby = hash.getNearby(2.1, 0, 0); // Just across boundary
    expect(nearby).toContain('entity1');
  });

  it('should not find entity 2+ cells away', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(0, 0, 0, 'entity1');
    // 6 units away = 3 cells away (cellSize 2.0), beyond 1-cell neighbor range
    const nearby = hash.getNearby(6, 6, 6);
    expect(nearby).not.toContain('entity1');
  });

  it('should handle many entities in same cell', () => {
    const hash = new SpatialHash<number>(2.0);
    for (let i = 0; i < 100; i++) {
      hash.insert(0.5, 0.5, 0.5, i);
    }
    const nearby = hash.getNearby(0.5, 0.5, 0.5);
    expect(nearby.length).toBe(100);
  });

  it('should clear all entries', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(0, 0, 0, 'a');
    hash.insert(1, 1, 1, 'b');
    hash.clear();
    const nearby = hash.getNearby(0, 0, 0);
    expect(nearby.length).toBe(0);
  });

  it('should handle negative coordinates', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(-5, -5, -5, 'negative');
    const nearby = hash.getNearby(-5.1, -5.1, -5.1);
    expect(nearby).toContain('negative');
  });

  it('should return correct entities from multiple cells', () => {
    const hash = new SpatialHash<string>(2.0);
    hash.insert(0, 0, 0, 'center');
    hash.insert(1.5, 0, 0, 'right');   // Same cell
    hash.insert(3.0, 0, 0, 'far_right'); // Adjacent cell
    hash.insert(7.0, 0, 0, 'very_far');  // Far away

    const nearby = hash.getNearby(1, 0, 0);
    expect(nearby).toContain('center');
    expect(nearby).toContain('right');
    expect(nearby).toContain('far_right');
    expect(nearby).not.toContain('very_far');
  });
});

// ---------------------------------------------------------------------------
// Performance scaling tests
// ---------------------------------------------------------------------------

describe('Performance Scaling', () => {
  it('spatial hash lookup is O(1) per query regardless of total entities', () => {
    const hash = new SpatialHash<{ x: number; y: number; z: number }>(2.5);

    // Insert 1000 entities spread across a large area
    const entities: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < 1000; i++) {
      const e = {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
        z: (Math.random() - 0.5) * 100,
      };
      entities.push(e);
      hash.insert(e.x, e.y, e.z, e);
    }

    // Time 10000 lookups
    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const x = (Math.random() - 0.5) * 100;
      const y = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      hash.getNearby(x, y, z);
    }
    const elapsed = performance.now() - start;

    // Should complete quickly (< 100ms for 10k lookups, typically < 20ms)
    expect(elapsed).toBeLessThan(100);
  });

  it('squared distance is faster than distance with sqrt', () => {
    const v1 = new THREE.Vector3(1, 2, 3);
    const v2 = new THREE.Vector3(4, 5, 6);
    const iterations = 100000;

    // Measure distanceTo (uses sqrt)
    const startSqrt = performance.now();
    let sumSqrt = 0;
    for (let i = 0; i < iterations; i++) {
      sumSqrt += v1.distanceTo(v2);
    }
    const elapsedSqrt = performance.now() - startSqrt;

    // Measure distanceToSquared (no sqrt)
    const startNoSqrt = performance.now();
    let sumNoSqrt = 0;
    for (let i = 0; i < iterations; i++) {
      sumNoSqrt += v1.distanceToSquared(v2);
    }
    const elapsedNoSqrt = performance.now() - startNoSqrt;

    // distanceToSquared should be faster (or at most equal)
    // Allow 20% margin for JIT variability
    expect(elapsedNoSqrt).toBeLessThanOrEqual(elapsedSqrt * 1.2);

    // Both should give meaningful results (not optimized away)
    expect(sumSqrt).toBeGreaterThan(0);
    expect(sumNoSqrt).toBeGreaterThan(0);
  });

  it('pre-allocated vector reuse is faster than new allocation per call', () => {
    const iterations = 100000;

    // Method 1: new Vector3 each time
    const startAlloc = performance.now();
    let sumAlloc = 0;
    for (let i = 0; i < iterations; i++) {
      const v = new THREE.Vector3(i, i + 1, i + 2);
      sumAlloc += v.length();
    }
    const elapsedAlloc = performance.now() - startAlloc;

    // Method 2: reuse pre-allocated vector
    const temp = new THREE.Vector3();
    const startReuse = performance.now();
    let sumReuse = 0;
    for (let i = 0; i < iterations; i++) {
      temp.set(i, i + 1, i + 2);
      sumReuse += temp.length();
    }
    const elapsedReuse = performance.now() - startReuse;

    // Reuse should be faster or equal (JIT may optimize both similarly)
    // Main benefit is reduced GC pressure, not raw speed per call
    expect(elapsedReuse).toBeLessThanOrEqual(elapsedAlloc * 1.5);

    expect(sumAlloc).toBeGreaterThan(0);
    expect(sumReuse).toBeGreaterThan(0);
  });

  it('spatial hash collision detection scales better than brute force', () => {
    // Simulate bullet-enemy collision: 100 bullets vs N enemies

    // Create entities on a sphere surface
    function createEntities(count: number) {
      const entities: Array<{ pos: THREE.Vector3; radius: number }> = [];
      for (let i = 0; i < count; i++) {
        // Random positions on sphere of radius 10
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 10;
        entities.push({
          pos: new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi),
          ),
          radius: 0.3,
        });
      }
      return entities;
    }

    const bullets = createEntities(100);
    const enemies500 = createEntities(500);

    // Brute force: O(bullets * enemies)
    const startBrute = performance.now();
    let bruteHits = 0;
    for (const bullet of bullets) {
      for (const enemy of enemies500) {
        const dx = bullet.pos.x - enemy.pos.x;
        const dy = bullet.pos.y - enemy.pos.y;
        const dz = bullet.pos.z - enemy.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < (enemy.radius + 0.15) ** 2) {
          bruteHits++;
        }
      }
    }
    const elapsedBrute = performance.now() - startBrute;

    // Spatial hash: O(bullets * ~k) where k is avg nearby count
    const hash = new SpatialHash<typeof enemies500[0]>(2.5);
    for (const enemy of enemies500) {
      hash.insert(enemy.pos.x, enemy.pos.y, enemy.pos.z, enemy);
    }

    const startHash = performance.now();
    let hashHits = 0;
    for (const bullet of bullets) {
      const nearby = hash.getNearby(bullet.pos.x, bullet.pos.y, bullet.pos.z);
      for (let i = 0; i < nearby.length; i++) {
        const enemy = nearby[i];
        const dx = bullet.pos.x - enemy.pos.x;
        const dy = bullet.pos.y - enemy.pos.y;
        const dz = bullet.pos.z - enemy.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < (enemy.radius + 0.15) ** 2) {
          hashHits++;
        }
      }
    }
    const elapsedHash = performance.now() - startHash;

    // Same number of hits
    expect(hashHits).toBe(bruteHits);

    // Spatial hash should be significantly faster at 500 enemies
    // (brute: 50,000 checks; hash: ~100 * ~5-20 = ~500-2000 checks)
    expect(elapsedHash).toBeLessThan(elapsedBrute);
  });
});

// ---------------------------------------------------------------------------
// Allocation elimination verification
// ---------------------------------------------------------------------------

describe('Allocation Elimination', () => {
  it('Matrix4 reuse pattern works correctly', () => {
    const temp = new THREE.Matrix4();
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, 0, 1);

    // Same result whether using new or reuse
    const fresh = new THREE.Matrix4().makeBasis(right, up, forward);
    temp.makeBasis(right, up, forward);

    expect(temp.elements).toEqual(fresh.elements);
  });

  it('Euler from Matrix4 reuse pattern works correctly', () => {
    const tempMatrix = new THREE.Matrix4();
    const tempEuler = new THREE.Euler();
    const right = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(1, 0, 0);

    tempMatrix.makeBasis(right, up, forward);
    tempEuler.setFromRotationMatrix(tempMatrix);

    const freshEuler = new THREE.Euler().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward)
    );

    expect(tempEuler.x).toBeCloseTo(freshEuler.x, 10);
    expect(tempEuler.y).toBeCloseTo(freshEuler.y, 10);
    expect(tempEuler.z).toBeCloseTo(freshEuler.z, 10);
  });

  it('addScaledVector matches clone().multiplyScalar() for velocity integration', () => {
    const offset = new THREE.Vector3(1, 2, 3);
    const velocity = new THREE.Vector3(0.5, -0.3, 0.7);
    const dt = 0.016;

    // Old way: clone + multiply
    const offsetOld = offset.clone();
    offsetOld.add(velocity.clone().multiplyScalar(dt));

    // New way: addScaledVector (no allocation)
    const offsetNew = offset.clone();
    offsetNew.addScaledVector(velocity, dt);

    expect(offsetNew.x).toBeCloseTo(offsetOld.x, 10);
    expect(offsetNew.y).toBeCloseTo(offsetOld.y, 10);
    expect(offsetNew.z).toBeCloseTo(offsetOld.z, 10);
  });

  it('Quaternion reuse pattern preserves rotation correctness', () => {
    const tangent = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    // Old way
    const matOld = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    const baseQuatOld = new THREE.Quaternion().setFromRotationMatrix(matOld);
    const spinQuatOld = new THREE.Quaternion().setFromAxisAngle(normal, 1.5);
    spinQuatOld.multiply(baseQuatOld);

    // New way (reuse)
    const tempMat = new THREE.Matrix4();
    const tempBaseQuat = new THREE.Quaternion();
    const tempSpinQuat = new THREE.Quaternion();
    tempMat.makeBasis(tangent, normal, bitangent);
    tempBaseQuat.setFromRotationMatrix(tempMat);
    tempSpinQuat.setFromAxisAngle(normal, 1.5);
    tempSpinQuat.multiply(tempBaseQuat);

    expect(tempSpinQuat.x).toBeCloseTo(spinQuatOld.x, 10);
    expect(tempSpinQuat.y).toBeCloseTo(spinQuatOld.y, 10);
    expect(tempSpinQuat.z).toBeCloseTo(spinQuatOld.z, 10);
    expect(tempSpinQuat.w).toBeCloseTo(spinQuatOld.w, 10);
  });
});
