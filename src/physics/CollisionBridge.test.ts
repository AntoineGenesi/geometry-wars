/**
 * Tests for CollisionBridge: the high-level API that bridges
 * RapierWorld (WASM) and SpatialHash (JS fallback).
 *
 * These tests verify:
 * - Lazy initialization
 * - Automatic backend selection
 * - Fallback to SpatialHash
 * - Entity sync (add/update/remove)
 * - queryNearby with both backends
 * - getOverlaps with Rapier backend
 * - getNearbyEntities (always SpatialHash)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CollisionBridge, CollisionEntity } from './CollisionBridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  id: string,
  x: number, y: number, z: number,
  radius: number,
  category: string,
  active = true,
): CollisionEntity {
  return {
    id,
    position: { x, y, z },
    radius,
    category,
    active,
  };
}

function makeSphereEntities(count: number, sphereRadius: number = 10): CollisionEntity[] {
  const entities: CollisionEntity[] = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
    const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
    const z = sphereRadius * Math.cos(phi);

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

    entities.push(makeEntity(`e${i}`, x, y, z, r, cat));
  }
  return entities;
}

// ---------------------------------------------------------------------------
// SpatialHash fallback (before WASM loads)
// ---------------------------------------------------------------------------

describe('CollisionBridge: SpatialHash Fallback', () => {
  let bridge: CollisionBridge;

  beforeEach(() => {
    bridge = new CollisionBridge(2.5);
    // Do NOT call startInit() -- stay in fallback mode
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('should report spatialhash as active backend before init', () => {
    expect(bridge.activeBackend).toBe('spatialhash');
    expect(bridge.isRapierReady).toBe(false);
  });

  it('should handle update() with entities in fallback mode', () => {
    const entities = [
      makeEntity('p', 0, 0, 0, 0.5, 'player'),
      makeEntity('e1', 5, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);
    // Should not throw
  });

  it('should return nearby entities via getNearbyEntities', () => {
    const entities = [
      makeEntity('p', 0, 0, 0, 0.5, 'player'),
      makeEntity('e1', 1, 0, 0, 0.5, 'enemy'),
      makeEntity('e2', 100, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);

    const nearby = bridge.getNearbyEntities(0, 0, 0);
    const ids = Array.from(nearby).map(e => e.id);
    expect(ids).toContain('p');
    expect(ids).toContain('e1');
    expect(ids).not.toContain('e2');
  });

  it('should queryNearby using spatial hash fallback', () => {
    const entities = [
      makeEntity('e1', 0, 0, 0, 0.5, 'enemy'),
      makeEntity('e2', 1, 0, 0, 0.5, 'enemy'),
      makeEntity('e3', 50, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);

    const nearby = bridge.queryNearby({ x: 0, y: 0, z: 0 }, 3.0);
    expect(nearby).toContain('e1');
    expect(nearby).toContain('e2');
    expect(nearby).not.toContain('e3');
  });

  it('should skip inactive entities', () => {
    const entities = [
      makeEntity('e1', 0, 0, 0, 0.5, 'enemy', true),
      makeEntity('e2', 0.5, 0, 0, 0.5, 'enemy', false),
    ];
    bridge.update(entities);

    const nearby = bridge.getNearbyEntities(0, 0, 0);
    const ids = Array.from(nearby).map(e => e.id);
    expect(ids).toContain('e1');
    expect(ids).not.toContain('e2');
  });

  it('should return empty overlaps in fallback mode', () => {
    const entities = [
      makeEntity('p', 0, 0, 0, 0.5, 'player'),
      makeEntity('e', 0.3, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);

    // Fallback mode returns empty (pair detection requires Rapier)
    const overlaps = bridge.getOverlaps();
    expect(overlaps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rapier backend (after WASM loads)
// ---------------------------------------------------------------------------

describe('CollisionBridge: Rapier Backend', () => {
  let bridge: CollisionBridge;

  beforeEach(async () => {
    bridge = new CollisionBridge(2.5);
    bridge.startInit();
    await bridge.waitForInit();
  }, 30_000);

  afterEach(() => {
    bridge.destroy();
  });

  it('should report rapier as active backend after init', () => {
    expect(bridge.activeBackend).toBe('rapier');
    expect(bridge.isRapierReady).toBe(true);
  });

  it('should sync entities to Rapier', () => {
    const entities = [
      makeEntity('p', 0, 0, 0, 0.5, 'player'),
      makeEntity('e1', 5, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);
    // No crash means sync worked
  });

  it('should detect overlaps via Rapier', () => {
    const entities = [
      makeEntity('player1', 0, 0, 0, 1.0, 'player'),
      makeEntity('enemy1', 0.5, 0, 0, 1.0, 'enemy'),
    ];
    bridge.update(entities);

    const overlaps = bridge.getOverlaps();
    expect(overlaps.length).toBe(1);
    const ids = [overlaps[0].entityA, overlaps[0].entityB].sort();
    expect(ids).toEqual(['enemy1', 'player1']);
  });

  it('should handle entity removal between frames', () => {
    const frame1 = [
      makeEntity('p', 0, 0, 0, 1.0, 'player'),
      makeEntity('e1', 0.5, 0, 0, 1.0, 'enemy'),
      makeEntity('e2', 1.0, 0, 0, 1.0, 'enemy'),
    ];
    bridge.update(frame1);

    let overlaps = bridge.getOverlaps();
    expect(overlaps.length).toBe(2); // player-e1, player-e2

    // Frame 2: e2 removed
    const frame2 = [
      makeEntity('p', 0, 0, 0, 1.0, 'player'),
      makeEntity('e1', 0.5, 0, 0, 1.0, 'enemy'),
    ];
    bridge.update(frame2);

    overlaps = bridge.getOverlaps();
    expect(overlaps.length).toBe(1);
  });

  it('should handle entity position changes between frames', () => {
    const frame1 = [
      makeEntity('p', 0, 0, 0, 1.0, 'player'),
      makeEntity('e1', 0.5, 0, 0, 1.0, 'enemy'),
    ];
    bridge.update(frame1);

    let overlaps = bridge.getOverlaps();
    expect(overlaps.length).toBe(1);

    // Frame 2: enemy moves far away
    const frame2 = [
      makeEntity('p', 0, 0, 0, 1.0, 'player'),
      makeEntity('e1', 50, 0, 0, 1.0, 'enemy'),
    ];
    bridge.update(frame2);

    overlaps = bridge.getOverlaps();
    expect(overlaps.length).toBe(0);
  });

  it('should respect collision groups', () => {
    const entities = [
      makeEntity('b1', 0, 0, 0, 0.5, 'bullet'),
      makeEntity('b2', 0.3, 0, 0, 0.5, 'bullet'),
    ];
    bridge.update(entities);

    const overlaps = bridge.getOverlaps();
    // Bullets don't collide with bullets
    expect(overlaps.length).toBe(0);
  });

  it('should queryNearby using Rapier broadphase', () => {
    const entities = [
      makeEntity('e1', 0, 0, 0, 0.5, 'enemy'),
      makeEntity('e2', 2, 0, 0, 0.5, 'enemy'),
      makeEntity('e3', 50, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);

    // Step the world
    bridge.getOverlaps();

    const nearby = bridge.queryNearby({ x: 0, y: 0, z: 0 }, 3.0);
    expect(nearby).toContain('e1');
    expect(nearby).toContain('e2');
    expect(nearby).not.toContain('e3');
  });

  it('should handle rapid add/remove cycles', () => {
    for (let i = 0; i < 10; i++) {
      const entities = [
        makeEntity('p', 0, 0, 0, 0.5, 'player'),
        makeEntity(`e${i}`, 0.3, 0, 0, 0.5, 'enemy'),
      ];
      bridge.update(entities);
      bridge.getOverlaps();
    }
    // Should not crash or leak
  });
});

// ---------------------------------------------------------------------------
// Lazy initialization
// ---------------------------------------------------------------------------

describe('CollisionBridge: Lazy Init', () => {
  it('should work before WASM loads', async () => {
    const bridge = new CollisionBridge(2.5);

    // Start init but don't await
    bridge.startInit();

    // Use immediately (falls back to SpatialHash)
    const entities = [
      makeEntity('p', 0, 0, 0, 0.5, 'player'),
      makeEntity('e', 1, 0, 0, 0.5, 'enemy'),
    ];
    bridge.update(entities);

    const nearby = bridge.getNearbyEntities(0, 0, 0);
    expect(Array.from(nearby).length).toBeGreaterThan(0);

    // Now wait for WASM
    await bridge.waitForInit();
    expect(bridge.isRapierReady).toBe(true);

    // Should now use Rapier
    bridge.update(entities);
    const overlaps = bridge.getOverlaps();
    // With Rapier ready, we can get overlaps
    expect(overlaps).toBeDefined();

    bridge.destroy();
  }, 30_000);

  it('should handle startInit called multiple times', async () => {
    const bridge = new CollisionBridge();
    bridge.startInit();
    bridge.startInit(); // second call should be no-op
    await bridge.waitForInit();
    expect(bridge.isRapierReady).toBe(true);
    bridge.destroy();
  }, 30_000);

  it('should handle waitForInit without startInit', async () => {
    const bridge = new CollisionBridge();
    await bridge.waitForInit(); // should resolve immediately
    expect(bridge.isRapierReady).toBe(false); // never started
    bridge.destroy();
  });
});

// ---------------------------------------------------------------------------
// Mixed workload simulation
// ---------------------------------------------------------------------------

describe('CollisionBridge: Mixed Workload', () => {
  let bridge: CollisionBridge;

  beforeEach(async () => {
    bridge = new CollisionBridge(2.5);
    bridge.startInit();
    await bridge.waitForInit();
  }, 30_000);

  afterEach(() => {
    bridge.destroy();
  });

  it('should handle 100 entities over 10 frames', () => {
    for (let frame = 0; frame < 10; frame++) {
      const entities: CollisionEntity[] = [];

      // Player
      entities.push(makeEntity('player', frame * 0.1, 0, 0, 0.5, 'player'));

      // Enemies
      for (let i = 0; i < 80; i++) {
        const angle = (i / 80) * Math.PI * 2;
        const r = 2 + Math.random() * 8;
        entities.push(makeEntity(
          `enemy_${i}`,
          r * Math.cos(angle),
          r * Math.sin(angle),
          Math.random() - 0.5,
          0.5,
          'enemy',
        ));
      }

      // Bullets
      for (let i = 0; i < 15; i++) {
        entities.push(makeEntity(
          `bullet_${i}`,
          frame * 0.1 + (i + 1) * 0.3,
          0,
          0,
          0.15,
          'bullet',
        ));
      }

      // Geoms
      for (let i = 0; i < 5; i++) {
        entities.push(makeEntity(
          `geom_${i}`,
          Math.random() * 4 - 2,
          Math.random() * 4 - 2,
          0,
          0.3,
          'geom',
        ));
      }

      bridge.update(entities);
      const overlaps = bridge.getOverlaps();
      // Just ensure it doesn't crash and returns valid data
      expect(Array.isArray(overlaps)).toBe(true);
    }
  });
});
