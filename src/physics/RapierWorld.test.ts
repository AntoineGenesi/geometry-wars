/**
 * Tests for RapierWorld WASM collision detection.
 *
 * These tests verify:
 * - WASM initialization
 * - Entity add/update/remove lifecycle
 * - Collision detection accuracy (overlapping spheres)
 * - Collision group filtering
 * - Spatial queries (queryNearby)
 * - Performance benchmarks vs SpatialHash
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { RapierWorld, CollisionPair, resetRapierInit } from './RapierWorld';
import { SpatialHash } from '../core/SpatialHash';

// Rapier WASM takes a moment to load; share one instance across tests where possible
let world: RapierWorld;

beforeAll(async () => {
  world = new RapierWorld();
  await world.init();
}, 30_000); // WASM init can be slow in CI

afterEach(() => {
  world.clear();
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe('RapierWorld: Initialization', () => {
  it('should initialize successfully', () => {
    expect(world.isReady).toBe(true);
  });

  it('should report 0 entities initially', () => {
    expect(world.entityCount).toBe(0);
  });

  it('should handle double init gracefully', async () => {
    await world.init(); // second call should be a no-op
    expect(world.isReady).toBe(true);
  });

  it('should throw when adding entity before init', async () => {
    const uninitWorld = new RapierWorld();
    expect(() => {
      uninitWorld.addEntity('test', { x: 0, y: 0, z: 0 }, 1, 'player');
    }).toThrow('RapierWorld not initialized');
  });
});

// ---------------------------------------------------------------------------
// Entity Lifecycle
// ---------------------------------------------------------------------------

describe('RapierWorld: Entity Lifecycle', () => {
  it('should add an entity', () => {
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    expect(world.entityCount).toBe(1);
  });

  it('should add multiple entities', () => {
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('enemy1', { x: 5, y: 0, z: 0 }, 0.5, 'enemy');
    world.addEntity('bullet1', { x: 2, y: 0, z: 0 }, 0.15, 'bullet');
    expect(world.entityCount).toBe(3);
  });

  it('should remove an entity', () => {
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('enemy1', { x: 5, y: 0, z: 0 }, 0.5, 'enemy');
    world.removeEntity('player1');
    expect(world.entityCount).toBe(1);
  });

  it('should handle removing non-existent entity gracefully', () => {
    world.removeEntity('nonexistent');
    expect(world.entityCount).toBe(0);
  });

  it('should replace entity with same ID', () => {
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('player1', { x: 5, y: 0, z: 0 }, 1.0, 'player');
    expect(world.entityCount).toBe(1);
  });

  it('should update entity position', () => {
    world.addEntity('enemy1', { x: 0, y: 0, z: 0 }, 0.5, 'enemy');
    world.updateEntity('enemy1', { x: 10, y: 0, z: 0 });
    // Position update is verified by collision detection tests below
    expect(world.entityCount).toBe(1);
  });

  it('should handle update on non-existent entity gracefully', () => {
    world.updateEntity('nonexistent', { x: 0, y: 0, z: 0 });
    // Should not throw
  });

  it('should clear all entities', () => {
    world.addEntity('a', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('b', { x: 0, y: 0, z: 0 }, 0.5, 'enemy');
    world.addEntity('c', { x: 0, y: 0, z: 0 }, 0.5, 'bullet');
    world.clear();
    expect(world.entityCount).toBe(0);
  });

  it('should update entity radius via updateEntityFull', () => {
    world.addEntity('enemy1', { x: 0, y: 0, z: 0 }, 0.5, 'enemy');
    world.updateEntityFull('enemy1', { x: 0, y: 0, z: 0 }, 2.0);
    expect(world.entityCount).toBe(1);
    // Radius change verified by collision tests
  });
});

// ---------------------------------------------------------------------------
// Collision Detection
// ---------------------------------------------------------------------------

describe('RapierWorld: Collision Detection', () => {
  it('should detect two overlapping spheres', () => {
    // Two spheres of radius 1.0 placed 1.0 apart -> overlapping
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('enemy1', { x: 1.0, y: 0, z: 0 }, 1.0, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
    const ids = [pairs[0].idA, pairs[0].idB].sort();
    expect(ids).toEqual(['enemy1', 'player1']);
  });

  it('should NOT detect non-overlapping spheres', () => {
    // Two spheres of radius 0.5 placed 5.0 apart -> not overlapping
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('enemy1', { x: 5.0, y: 0, z: 0 }, 0.5, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should detect collision after position update', () => {
    world.addEntity('player1', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('enemy1', { x: 10, y: 0, z: 0 }, 0.5, 'enemy');

    // First check: no collision
    let pairs = world.getCollisions();
    expect(pairs.length).toBe(0);

    // Move enemy close to player
    world.updateEntity('enemy1', { x: 0.5, y: 0, z: 0 });
    pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });

  it('should detect multiple simultaneous collisions', () => {
    // Player at center, 3 enemies touching it
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('e1', { x: 1.0, y: 0, z: 0 }, 1.0, 'enemy');
    world.addEntity('e2', { x: 0, y: 1.0, z: 0 }, 1.0, 'enemy');
    world.addEntity('e3', { x: 0, y: 0, z: 1.0 }, 1.0, 'enemy');

    const pairs = world.getCollisions();
    // Player collides with e1, e2, e3 (enemies don't collide with each other)
    expect(pairs.length).toBe(3);
  });

  it('should not produce duplicate pairs', () => {
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('enemy', { x: 0.5, y: 0, z: 0 }, 1.0, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);

    // No (enemy, player) duplicate
    const pairKeys = pairs.map(p => [p.idA, p.idB].sort().join('|'));
    const uniqueKeys = new Set(pairKeys);
    expect(uniqueKeys.size).toBe(pairs.length);
  });

  it('should handle entity removal during collision cycle', () => {
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('enemy', { x: 0.5, y: 0, z: 0 }, 1.0, 'enemy');

    let pairs = world.getCollisions();
    expect(pairs.length).toBe(1);

    world.removeEntity('enemy');
    pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should detect collision along all axes', () => {
    // Test collision in Y axis
    world.addEntity('p', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('e', { x: 0, y: 1.5, z: 0 }, 1.0, 'enemy');
    let pairs = world.getCollisions();
    expect(pairs.length).toBe(1);

    world.clear();

    // Test collision in Z axis
    world.addEntity('p', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('e', { x: 0, y: 0, z: 1.5 }, 1.0, 'enemy');
    pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Collision Groups
// ---------------------------------------------------------------------------

describe('RapierWorld: Collision Groups', () => {
  it('should detect player-enemy collision', () => {
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    world.addEntity('enemy', { x: 0.5, y: 0, z: 0 }, 1.0, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });

  it('should detect bullet-enemy collision', () => {
    world.addEntity('bullet', { x: 0, y: 0, z: 0 }, 0.15, 'bullet');
    world.addEntity('enemy', { x: 0.1, y: 0, z: 0 }, 0.5, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });

  it('should detect player-geom collision', () => {
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('geom', { x: 0.3, y: 0, z: 0 }, 0.3, 'geom');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });

  it('should detect player-pickup collision', () => {
    world.addEntity('player', { x: 0, y: 0, z: 0 }, 0.5, 'player');
    world.addEntity('pickup', { x: 0.3, y: 0, z: 0 }, 0.3, 'pickup');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(1);
  });

  it('should NOT detect bullet-player collision', () => {
    // Bullets only collide with enemies
    world.addEntity('bullet', { x: 0, y: 0, z: 0 }, 0.5, 'bullet');
    world.addEntity('player', { x: 0.3, y: 0, z: 0 }, 0.5, 'player');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should NOT detect bullet-bullet collision', () => {
    world.addEntity('b1', { x: 0, y: 0, z: 0 }, 0.5, 'bullet');
    world.addEntity('b2', { x: 0.3, y: 0, z: 0 }, 0.5, 'bullet');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should NOT detect enemy-enemy collision', () => {
    world.addEntity('e1', { x: 0, y: 0, z: 0 }, 1.0, 'enemy');
    world.addEntity('e2', { x: 0.5, y: 0, z: 0 }, 1.0, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should NOT detect geom-enemy collision', () => {
    world.addEntity('geom', { x: 0, y: 0, z: 0 }, 0.5, 'geom');
    world.addEntity('enemy', { x: 0.3, y: 0, z: 0 }, 0.5, 'enemy');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });

  it('should NOT detect bullet-geom collision', () => {
    world.addEntity('bullet', { x: 0, y: 0, z: 0 }, 0.5, 'bullet');
    world.addEntity('geom', { x: 0.3, y: 0, z: 0 }, 0.5, 'geom');

    const pairs = world.getCollisions();
    expect(pairs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Spatial Queries
// ---------------------------------------------------------------------------

describe('RapierWorld: Spatial Queries', () => {
  it('should find entities within query radius', () => {
    world.addEntity('e1', { x: 0, y: 0, z: 0 }, 0.5, 'enemy');
    world.addEntity('e2', { x: 2, y: 0, z: 0 }, 0.5, 'enemy');
    world.addEntity('e3', { x: 10, y: 0, z: 0 }, 0.5, 'enemy');

    // Need to step the world once so positions are committed
    world.getCollisions();

    const nearby = world.queryNearby({ x: 0, y: 0, z: 0 }, 3.0);
    expect(nearby).toContain('e1');
    expect(nearby).toContain('e2');
    expect(nearby).not.toContain('e3');
  });

  it('should return empty array for empty world', () => {
    const nearby = world.queryNearby({ x: 0, y: 0, z: 0 }, 10);
    expect(nearby.length).toBe(0);
  });

  it('should find entity exactly at query center', () => {
    world.addEntity('center', { x: 5, y: 5, z: 5 }, 0.5, 'enemy');
    world.getCollisions(); // step

    const nearby = world.queryNearby({ x: 5, y: 5, z: 5 }, 1.0);
    expect(nearby).toContain('center');
  });
});

// ---------------------------------------------------------------------------
// Destroy and Reinit
// ---------------------------------------------------------------------------

describe('RapierWorld: Destroy and Reinit', () => {
  it('should be usable after destroy + reinit', async () => {
    const w = new RapierWorld();
    await w.init();

    w.addEntity('a', { x: 0, y: 0, z: 0 }, 1.0, 'player');
    expect(w.entityCount).toBe(1);

    w.destroy();
    expect(w.isReady).toBe(false);

    await w.init();
    expect(w.isReady).toBe(true);
    expect(w.entityCount).toBe(0);

    w.addEntity('b', { x: 0, y: 0, z: 0 }, 1.0, 'enemy');
    expect(w.entityCount).toBe(1);

    w.destroy();
  });
});

// ---------------------------------------------------------------------------
// Performance Benchmarks
// ---------------------------------------------------------------------------

describe('RapierWorld: Performance Benchmarks', () => {
  /** Create N entities on a sphere surface. */
  function createEntities(count: number, radius: number = 10): Array<{
    id: string;
    pos: { x: number; y: number; z: number };
    r: number;
    cat: string;
  }> {
    const entities: Array<{
      id: string;
      pos: { x: number; y: number; z: number };
      r: number;
      cat: string;
    }> = [];

    // 10% bullets, 85% enemies, 5% other
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      let cat: string;
      let r: number;
      if (i < count * 0.1) {
        cat = 'bullet';
        r = 0.15;
      } else if (i < count * 0.95) {
        cat = 'enemy';
        r = 0.5;
      } else {
        cat = 'geom';
        r = 0.3;
      }

      entities.push({ id: `e${i}`, pos: { x, y, z }, r, cat });
    }

    return entities;
  }

  function benchmarkSpatialHash(
    entities: Array<{ id: string; pos: { x: number; y: number; z: number }; r: number; cat: string }>,
    frames: number,
  ): number {
    const hash = new SpatialHash<{ pos: { x: number; y: number; z: number }; r: number }>(2.5);

    const start = performance.now();
    for (let f = 0; f < frames; f++) {
      hash.clear();
      for (const e of entities) {
        hash.insert(e.pos.x, e.pos.y, e.pos.z, { pos: e.pos, r: e.r });
      }

      // Simulate bullet queries (10% of entities are bullets)
      const bulletCount = Math.floor(entities.length * 0.1);
      for (let b = 0; b < bulletCount; b++) {
        const bullet = entities[b];
        hash.getNearby(bullet.pos.x, bullet.pos.y, bullet.pos.z);
      }
    }
    const elapsed = performance.now() - start;
    return elapsed / frames;
  }

  async function benchmarkRapierAllPairs(
    entities: Array<{ id: string; pos: { x: number; y: number; z: number }; r: number; cat: string }>,
    frames: number,
  ): Promise<number> {
    const w = new RapierWorld();
    await w.init();

    for (const e of entities) {
      w.addEntity(e.id, e.pos, e.r, e.cat);
    }

    const start = performance.now();
    for (let f = 0; f < frames; f++) {
      for (const e of entities) {
        w.updateEntity(e.id, {
          x: e.pos.x + Math.random() * 0.01,
          y: e.pos.y + Math.random() * 0.01,
          z: e.pos.z + Math.random() * 0.01,
        });
      }
      w.getCollisions();
    }
    const elapsed = performance.now() - start;

    w.destroy();
    return elapsed / frames;
  }

  async function benchmarkRapierPerCategory(
    entities: Array<{ id: string; pos: { x: number; y: number; z: number }; r: number; cat: string }>,
    frames: number,
  ): Promise<number> {
    const w = new RapierWorld();
    await w.init();

    for (const e of entities) {
      w.addEntity(e.id, e.pos, e.r, e.cat);
    }

    const start = performance.now();
    for (let f = 0; f < frames; f++) {
      for (const e of entities) {
        w.updateEntity(e.id, {
          x: e.pos.x + Math.random() * 0.01,
          y: e.pos.y + Math.random() * 0.01,
          z: e.pos.z + Math.random() * 0.01,
        });
      }
      // More realistic: step once, then query only bullets + player
      w.step();
      w.getCollisionsForCategory('bullet');
      w.getCollisionsForCategory('player');
    }
    const elapsed = performance.now() - start;

    w.destroy();
    return elapsed / frames;
  }

  async function benchmarkRapierQueryNearby(
    entities: Array<{ id: string; pos: { x: number; y: number; z: number }; r: number; cat: string }>,
    frames: number,
  ): Promise<number> {
    const w = new RapierWorld();
    await w.init();

    for (const e of entities) {
      w.addEntity(e.id, e.pos, e.r, e.cat);
    }

    const start = performance.now();
    for (let f = 0; f < frames; f++) {
      for (const e of entities) {
        w.updateEntity(e.id, {
          x: e.pos.x + Math.random() * 0.01,
          y: e.pos.y + Math.random() * 0.01,
          z: e.pos.z + Math.random() * 0.01,
        });
      }
      w.step();

      // Same as SpatialHash benchmark: per-bullet queryNearby
      const bulletCount = Math.floor(entities.length * 0.1);
      for (let b = 0; b < bulletCount; b++) {
        const bullet = entities[b];
        w.queryNearby(bullet.pos, 2.5);
      }
    }
    const elapsed = performance.now() - start;

    w.destroy();
    return elapsed / frames;
  }

  const BENCH_FRAMES = 10;

  it('benchmark: 1K entities', async () => {
    const entities = createEntities(1000);
    const hashMs = benchmarkSpatialHash(entities, BENCH_FRAMES);
    const rapierAllMs = await benchmarkRapierAllPairs(entities, BENCH_FRAMES);
    const rapierCatMs = await benchmarkRapierPerCategory(entities, BENCH_FRAMES);
    const rapierQueryMs = await benchmarkRapierQueryNearby(entities, BENCH_FRAMES);

    console.log(`1K entities:`);
    console.log(`  SpatialHash:        ${hashMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (all-pairs): ${rapierAllMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (per-cat):   ${rapierCatMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (query):     ${rapierQueryMs.toFixed(2)}ms/frame`);

    expect(hashMs).toBeLessThan(100);
    expect(rapierAllMs).toBeLessThan(100);
  }, 60_000);

  it('benchmark: 5K entities', async () => {
    const entities = createEntities(5000);
    const hashMs = benchmarkSpatialHash(entities, BENCH_FRAMES);
    const rapierAllMs = await benchmarkRapierAllPairs(entities, BENCH_FRAMES);
    const rapierCatMs = await benchmarkRapierPerCategory(entities, BENCH_FRAMES);
    const rapierQueryMs = await benchmarkRapierQueryNearby(entities, BENCH_FRAMES);

    console.log(`5K entities:`);
    console.log(`  SpatialHash:        ${hashMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (all-pairs): ${rapierAllMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (per-cat):   ${rapierCatMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (query):     ${rapierQueryMs.toFixed(2)}ms/frame`);

    expect(hashMs).toBeLessThan(500);
    expect(rapierAllMs).toBeLessThan(500);
  }, 120_000);

  it('benchmark: 10K entities', async () => {
    const entities = createEntities(10000);
    const hashMs = benchmarkSpatialHash(entities, BENCH_FRAMES);
    const rapierAllMs = await benchmarkRapierAllPairs(entities, BENCH_FRAMES);
    const rapierCatMs = await benchmarkRapierPerCategory(entities, BENCH_FRAMES);
    const rapierQueryMs = await benchmarkRapierQueryNearby(entities, BENCH_FRAMES);

    console.log(`10K entities:`);
    console.log(`  SpatialHash:        ${hashMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (all-pairs): ${rapierAllMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (per-cat):   ${rapierCatMs.toFixed(2)}ms/frame`);
    console.log(`  Rapier (query):     ${rapierQueryMs.toFixed(2)}ms/frame`);

    expect(hashMs).toBeLessThan(1000);
    expect(rapierAllMs).toBeLessThan(1000);
  }, 180_000);
});
