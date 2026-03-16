/**
 * SpatialHash unit tests
 *
 * Run with: cd distributed-compute-experiment && npx vitest tests/SpatialHash.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialHash } from '../server/SpatialHash';

describe('SpatialHash', () => {
  let hash: SpatialHash;

  beforeEach(() => {
    hash = new SpatialHash(0.1);
  });

  it('returns empty results when hash is empty', () => {
    const results = hash.queryRadius(0.5, 0.5, 0.05);
    expect(results).toHaveLength(0);
  });

  it('finds an entity within radius', () => {
    hash.insert('e1', 0.5, 0.5);
    const results = hash.queryRadius(0.5, 0.5, 0.05);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e1');
  });

  it('does not find an entity outside radius', () => {
    hash.insert('e1', 0.9, 0.9);
    const results = hash.queryRadius(0.1, 0.1, 0.05);
    expect(results).toHaveLength(0);
  });

  it('finds entity clearly within radius', () => {
    // Entity at 0.04 distance, query radius 0.05 — clearly inside
    // (Exact boundary testing is avoided due to IEEE 754 floating-point edge cases)
    hash.insert('e1', 0.5 + 0.04, 0.5);
    const results = hash.queryRadius(0.5, 0.5, 0.05);
    expect(results).toHaveLength(1);
  });

  it('handles toroidal wrapping — entity near 1.0 found when querying near 0.0', () => {
    // Entity at u=0.98 should be found when querying from u=0.02 with radius=0.05
    hash.insert('e_wrap', 0.98, 0.5);
    const results = hash.queryRadius(0.02, 0.5, 0.05);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e_wrap');
  });

  it('handles toroidal wrapping — entity at 0.0 found from 0.98', () => {
    hash.insert('e_wrap', 0.01, 0.5);
    const results = hash.queryRadius(0.99, 0.5, 0.05);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e_wrap');
  });

  it('returns multiple entities in radius', () => {
    hash.insert('e1', 0.5, 0.5);
    hash.insert('e2', 0.52, 0.5);
    hash.insert('e3', 0.9, 0.9); // outside
    const results = hash.queryRadius(0.5, 0.5, 0.05);
    expect(results).toHaveLength(2);
    const ids = results.map(r => r.id).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('clear() removes all entities', () => {
    hash.insert('e1', 0.5, 0.5);
    hash.clear();
    const results = hash.queryRadius(0.5, 0.5, 0.1);
    expect(results).toHaveLength(0);
  });

  it('correctly tracks cellCount and entityCount', () => {
    hash.insert('e1', 0.1, 0.1);
    hash.insert('e2', 0.9, 0.9);
    hash.insert('e3', 0.1, 0.1); // same cell as e1
    expect(hash.entityCount).toBe(3);
    // At least 2 cells (e1+e3 in one, e2 in another)
    expect(hash.cellCount).toBeGreaterThanOrEqual(2);
  });

  it('handles 100 random entities without performance regression', () => {
    const entities = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`,
      u: Math.random(),
      v: Math.random(),
    }));

    const start = Date.now();
    for (const e of entities) hash.insert(e.id, e.u, e.v);
    const queries = 200;
    for (let i = 0; i < queries; i++) {
      hash.queryRadius(Math.random(), Math.random(), 0.05);
    }
    const elapsed = Date.now() - start;

    // 100 inserts + 200 queries should complete in under 5ms on any modern hardware
    expect(elapsed).toBeLessThan(5);
  });

  it('brute force vs spatial hash: same results at various positions', () => {
    // Insert 50 enemies at random positions
    const enemies = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      u: Math.random(),
      v: Math.random(),
    }));

    for (const e of enemies) hash.insert(e.id, e.u, e.v);

    // Test 20 query positions
    for (let q = 0; q < 20; q++) {
      const qu = Math.random();
      const qv = Math.random();
      const radius = 0.08;

      // Brute-force
      const bruteForce = enemies.filter(e => {
        let du = Math.abs(e.u - qu);
        if (du > 0.5) du = 1 - du;
        let dv = Math.abs(e.v - qv);
        if (dv > 0.5) dv = 1 - dv;
        return Math.sqrt(du * du + dv * dv) <= radius;
      }).map(e => e.id).sort();

      const hashResult = hash.queryRadius(qu, qv, radius).map(r => r.id).sort();
      expect(hashResult).toEqual(bruteForce);
    }
  });
});
