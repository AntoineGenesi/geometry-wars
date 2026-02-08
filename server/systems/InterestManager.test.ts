/**
 * Tests for Interest Management System.
 *
 * Covers:
 * - UV distance calculation with wrapping
 * - Priority classification
 * - Tick-based sync filtering
 * - PriorityQueue batch classification
 * - InterestManager per-player AOI filtering
 * - Surface-specific wrapping (sphere, torus, cube)
 * - Bandwidth savings estimation
 * - Edge cases (empty state, single player, boundary entities)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  uvDistance,
  classifyPriority,
  shouldSyncOnTick,
  PriorityQueue,
  SyncPriority,
  DEFAULT_THRESHOLDS,
  DEFAULT_INTERVALS,
  type UVPosition,
  type PriorityThresholds,
} from './PriorityQueue';
import {
  InterestManager,
  type SyncableEntity,
} from './InterestManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(id: string, u: number, v: number): SyncableEntity {
  return { id, u, v };
}

function makeEntities(count: number, spreadFn: (i: number) => { u: number; v: number }): SyncableEntity[] {
  return Array.from({ length: count }, (_, i) => {
    const pos = spreadFn(i);
    return makeEntity(`e${i}`, pos.u, pos.v);
  });
}

function makePlayers(positions: Array<{ id: string; u: number; v: number }>): Map<string, UVPosition> {
  const map = new Map<string, UVPosition>();
  for (const p of positions) {
    map.set(p.id, { u: p.u, v: p.v });
  }
  return map;
}

// ---------------------------------------------------------------------------
// UV Distance Tests
// ---------------------------------------------------------------------------

describe('uvDistance', () => {
  it('should compute direct distance without wrapping', () => {
    const a: UVPosition = { u: 0.2, v: 0.3 };
    const b: UVPosition = { u: 0.5, v: 0.7 };
    const dist = uvDistance(a, b, false, false);
    expect(dist).toBeCloseTo(0.5, 4); // sqrt(0.3^2 + 0.4^2) = 0.5
  });

  it('should return 0 for same position', () => {
    const pos: UVPosition = { u: 0.5, v: 0.5 };
    expect(uvDistance(pos, pos, false, false)).toBe(0);
    expect(uvDistance(pos, pos, true, true)).toBe(0);
  });

  it('should wrap U when enabled', () => {
    const a: UVPosition = { u: 0.05, v: 0.5 };
    const b: UVPosition = { u: 0.95, v: 0.5 };
    // Without wrap: |0.05 - 0.95| = 0.9
    const distNoWrap = uvDistance(a, b, false, false);
    expect(distNoWrap).toBeCloseTo(0.9, 4);
    // With U wrap: min(0.9, 0.1) = 0.1
    const distWrap = uvDistance(a, b, true, false);
    expect(distWrap).toBeCloseTo(0.1, 4);
  });

  it('should wrap V when enabled', () => {
    const a: UVPosition = { u: 0.5, v: 0.02 };
    const b: UVPosition = { u: 0.5, v: 0.98 };
    // Without wrap: 0.96
    expect(uvDistance(a, b, false, false)).toBeCloseTo(0.96, 4);
    // With V wrap: min(0.96, 0.04) = 0.04
    expect(uvDistance(a, b, false, true)).toBeCloseTo(0.04, 4);
  });

  it('should wrap both U and V for torus', () => {
    const a: UVPosition = { u: 0.02, v: 0.02 };
    const b: UVPosition = { u: 0.98, v: 0.98 };
    // Both axes wrap: du=0.04, dv=0.04
    const dist = uvDistance(a, b, true, true);
    expect(dist).toBeCloseTo(Math.sqrt(0.04 * 0.04 + 0.04 * 0.04), 4);
  });

  it('should handle exact boundary positions', () => {
    const a: UVPosition = { u: 0.0, v: 0.5 };
    const b: UVPosition = { u: 1.0, v: 0.5 };
    // With wrap: distance should be 0 (0 and 1 are same position)
    expect(uvDistance(a, b, true, false)).toBeCloseTo(0, 4);
  });
});

// ---------------------------------------------------------------------------
// Priority Classification Tests
// ---------------------------------------------------------------------------

describe('classifyPriority', () => {
  it('should classify HIGH for distances <= 0.1', () => {
    expect(classifyPriority(0)).toBe(SyncPriority.HIGH);
    expect(classifyPriority(0.05)).toBe(SyncPriority.HIGH);
    expect(classifyPriority(0.1)).toBe(SyncPriority.HIGH);
  });

  it('should classify MEDIUM for distances 0.1-0.2', () => {
    expect(classifyPriority(0.11)).toBe(SyncPriority.MEDIUM);
    expect(classifyPriority(0.15)).toBe(SyncPriority.MEDIUM);
    expect(classifyPriority(0.2)).toBe(SyncPriority.MEDIUM);
  });

  it('should classify LOW for distances 0.2-0.3', () => {
    expect(classifyPriority(0.21)).toBe(SyncPriority.LOW);
    expect(classifyPriority(0.25)).toBe(SyncPriority.LOW);
    expect(classifyPriority(0.3)).toBe(SyncPriority.LOW);
  });

  it('should classify NONE for distances > 0.3', () => {
    expect(classifyPriority(0.31)).toBe(SyncPriority.NONE);
    expect(classifyPriority(0.5)).toBe(SyncPriority.NONE);
    expect(classifyPriority(1.0)).toBe(SyncPriority.NONE);
  });

  it('should respect custom thresholds', () => {
    const custom: PriorityThresholds = { high: 0.05, medium: 0.1, low: 0.2 };
    expect(classifyPriority(0.04, custom)).toBe(SyncPriority.HIGH);
    expect(classifyPriority(0.06, custom)).toBe(SyncPriority.MEDIUM);
    expect(classifyPriority(0.15, custom)).toBe(SyncPriority.LOW);
    expect(classifyPriority(0.25, custom)).toBe(SyncPriority.NONE);
  });
});

// ---------------------------------------------------------------------------
// Tick-based Sync Tests
// ---------------------------------------------------------------------------

describe('shouldSyncOnTick', () => {
  it('HIGH syncs every tick', () => {
    for (let tick = 0; tick < 10; tick++) {
      expect(shouldSyncOnTick(SyncPriority.HIGH, tick)).toBe(true);
    }
  });

  it('MEDIUM syncs every 3rd tick', () => {
    expect(shouldSyncOnTick(SyncPriority.MEDIUM, 0)).toBe(true);
    expect(shouldSyncOnTick(SyncPriority.MEDIUM, 1)).toBe(false);
    expect(shouldSyncOnTick(SyncPriority.MEDIUM, 2)).toBe(false);
    expect(shouldSyncOnTick(SyncPriority.MEDIUM, 3)).toBe(true);
    expect(shouldSyncOnTick(SyncPriority.MEDIUM, 6)).toBe(true);
  });

  it('LOW syncs every 6th tick', () => {
    expect(shouldSyncOnTick(SyncPriority.LOW, 0)).toBe(true);
    expect(shouldSyncOnTick(SyncPriority.LOW, 1)).toBe(false);
    expect(shouldSyncOnTick(SyncPriority.LOW, 5)).toBe(false);
    expect(shouldSyncOnTick(SyncPriority.LOW, 6)).toBe(true);
    expect(shouldSyncOnTick(SyncPriority.LOW, 12)).toBe(true);
  });

  it('NONE never syncs', () => {
    for (let tick = 0; tick < 100; tick++) {
      expect(shouldSyncOnTick(SyncPriority.NONE, tick)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// PriorityQueue Tests
// ---------------------------------------------------------------------------

describe('PriorityQueue', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('should classify entities by distance from player', () => {
    const player: UVPosition = { u: 0.5, v: 0.5 };
    const entities = [
      { id: 'close', u: 0.52, v: 0.5 },    // ~0.02 -> HIGH
      { id: 'medium', u: 0.65, v: 0.5 },    // ~0.15 -> MEDIUM
      { id: 'far', u: 0.75, v: 0.5 },       // ~0.25 -> LOW
      { id: 'outside', u: 0.0, v: 0.0 },    // ~0.707 -> NONE
    ];

    const entries = queue.classify(player, entities, false, false);
    expect(entries).toHaveLength(4);

    // Sorted by distance ascending
    expect(entries[0].entityId).toBe('close');
    expect(entries[0].priority).toBe(SyncPriority.HIGH);

    expect(entries[1].entityId).toBe('medium');
    expect(entries[1].priority).toBe(SyncPriority.MEDIUM);

    expect(entries[2].entityId).toBe('far');
    expect(entries[2].priority).toBe(SyncPriority.LOW);

    expect(entries[3].entityId).toBe('outside');
    expect(entries[3].priority).toBe(SyncPriority.NONE);
  });

  it('should filter entries for tick correctly', () => {
    const player: UVPosition = { u: 0.5, v: 0.5 };
    const entities = [
      { id: 'high', u: 0.52, v: 0.5 },    // HIGH
      { id: 'med', u: 0.65, v: 0.5 },     // MEDIUM
      { id: 'low', u: 0.75, v: 0.5 },     // LOW
      { id: 'none', u: 0.0, v: 0.0 },     // NONE
    ];

    const entries = queue.classify(player, entities, false, false);

    // Tick 0: HIGH + MEDIUM (0%3==0) + LOW (0%6==0)
    const tick0 = queue.filterForTick(entries, 0);
    expect(tick0.has('high')).toBe(true);
    expect(tick0.has('med')).toBe(true);
    expect(tick0.has('low')).toBe(true);
    expect(tick0.has('none')).toBe(false);

    // Tick 1: only HIGH
    const tick1 = queue.filterForTick(entries, 1);
    expect(tick1.has('high')).toBe(true);
    expect(tick1.has('med')).toBe(false);
    expect(tick1.has('low')).toBe(false);

    // Tick 3: HIGH + MEDIUM
    const tick3 = queue.filterForTick(entries, 3);
    expect(tick3.has('high')).toBe(true);
    expect(tick3.has('med')).toBe(true);
    expect(tick3.has('low')).toBe(false);

    // Tick 6: HIGH + MEDIUM + LOW
    const tick6 = queue.filterForTick(entries, 6);
    expect(tick6.has('high')).toBe(true);
    expect(tick6.has('med')).toBe(true);
    expect(tick6.has('low')).toBe(true);
  });

  it('should handle empty entity list', () => {
    const player: UVPosition = { u: 0.5, v: 0.5 };
    const entries = queue.classify(player, [], false, false);
    expect(entries).toHaveLength(0);
    const synced = queue.filterForTick(entries, 0);
    expect(synced.size).toBe(0);
  });

  it('should handle wrapping in classification', () => {
    const player: UVPosition = { u: 0.02, v: 0.5 };
    const entity = { id: 'wrapped', u: 0.98, v: 0.5 };

    // Without wrap: distance ~0.96 -> NONE
    const noWrap = queue.classify(player, [entity], false, false);
    expect(noWrap[0].priority).toBe(SyncPriority.NONE);

    // With U wrap: distance ~0.04 -> HIGH
    const withWrap = queue.classify(player, [entity], true, false);
    expect(withWrap[0].priority).toBe(SyncPriority.HIGH);
  });

  it('should return sorted entries (closest first)', () => {
    const player: UVPosition = { u: 0.5, v: 0.5 };
    const entities = [
      { id: 'far', u: 0.0, v: 0.0 },
      { id: 'close', u: 0.51, v: 0.5 },
      { id: 'mid', u: 0.65, v: 0.5 },
    ];

    const entries = queue.classify(player, entities, false, false);
    expect(entries[0].entityId).toBe('close');
    expect(entries[1].entityId).toBe('mid');
    expect(entries[2].entityId).toBe('far');

    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].distance).toBeGreaterThanOrEqual(entries[i - 1].distance);
    }
  });

  it('should expose thresholds and intervals', () => {
    expect(queue.getThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(queue.getIntervals()).toEqual(DEFAULT_INTERVALS);
  });
});

// ---------------------------------------------------------------------------
// InterestManager Tests
// ---------------------------------------------------------------------------

describe('InterestManager', () => {
  describe('sphere surface (U wraps, V does not)', () => {
    let im: InterestManager;

    beforeEach(() => {
      im = new InterestManager('sphere');
    });

    it('should create with correct surface wrapping', () => {
      const wrap = im.getSurfaceWrap();
      expect(wrap.wrapU).toBe(true);
      expect(wrap.wrapV).toBe(false);
    });

    it('should have default AOI radius of 0.3', () => {
      expect(im.getAoiRadius()).toBe(0.3);
    });

    it('should filter entities per player', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [
        makeEntity('e1', 0.52, 0.5),  // close -> HIGH
        makeEntity('e2', 0.0, 0.0),   // far -> NONE
      ];

      const results = im.update(players, enemies, [], [], []);
      const p1 = results.get('p1');
      expect(p1).toBeDefined();
      expect(p1!.enemyIds.has('e1')).toBe(true);
      expect(p1!.enemyIds.has('e2')).toBe(false);
    });

    it('should handle UV wrapping on sphere U axis', () => {
      const players = makePlayers([{ id: 'p1', u: 0.02, v: 0.5 }]);
      // Enemy at u=0.98 should be close via wrapping (distance ~0.04)
      const enemies = [makeEntity('e1', 0.98, 0.5)];

      const results = im.update(players, enemies, [], [], []);
      const p1 = results.get('p1');
      expect(p1!.enemyIds.has('e1')).toBe(true);
    });

    it('should NOT wrap V on sphere', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.02 }]);
      // Enemy at v=0.98 is far without V wrap
      const enemies = [makeEntity('e1', 0.5, 0.98)];

      const results = im.update(players, enemies, [], [], []);
      const p1 = results.get('p1');
      expect(p1!.enemyIds.has('e1')).toBe(false); // distance 0.96 > AOI
    });

    it('should filter bullets, geoms, and pickups independently', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.52, 0.5)];
      const bullets = [makeEntity('b1', 0.52, 0.52), makeEntity('b2', 0.0, 0.0)];
      const geoms = [makeEntity('g1', 0.55, 0.5)];
      const pickups = [makeEntity('wp1', 0.0, 0.5)];

      const results = im.update(players, enemies, bullets, geoms, pickups);
      const p1 = results.get('p1');

      expect(p1!.enemyIds.has('e1')).toBe(true);
      expect(p1!.bulletIds.has('b1')).toBe(true);
      expect(p1!.bulletIds.has('b2')).toBe(false);
      expect(p1!.geomIds.has('g1')).toBe(true);
      expect(p1!.pickupIds.has('wp1')).toBe(false); // distance 0.5 > AOI
    });

    it('should support multiple players with different AOIs', () => {
      const players = makePlayers([
        { id: 'p1', u: 0.2, v: 0.5 },
        { id: 'p2', u: 0.8, v: 0.5 },
      ]);
      const enemies = [
        makeEntity('e1', 0.22, 0.5),  // near p1, far from p2
        makeEntity('e2', 0.78, 0.5),  // near p2, far from p1
        makeEntity('e3', 0.5, 0.5),   // far from both (0.3 from each)
      ];

      const results = im.update(players, enemies, [], [], []);

      const p1 = results.get('p1')!;
      const p2 = results.get('p2')!;

      expect(p1.enemyIds.has('e1')).toBe(true);
      expect(p1.enemyIds.has('e2')).toBe(false);

      expect(p2.enemyIds.has('e2')).toBe(true);
      expect(p2.enemyIds.has('e1')).toBe(false);
    });
  });

  describe('torus surface (both U and V wrap)', () => {
    let im: InterestManager;

    beforeEach(() => {
      im = new InterestManager('torus');
    });

    it('should wrap both U and V', () => {
      const wrap = im.getSurfaceWrap();
      expect(wrap.wrapU).toBe(true);
      expect(wrap.wrapV).toBe(true);
    });

    it('should detect entities near boundary via V wrapping', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.02 }]);
      const enemies = [makeEntity('e1', 0.5, 0.98)]; // Near via V wrap

      const results = im.update(players, enemies, [], [], []);
      expect(results.get('p1')!.enemyIds.has('e1')).toBe(true);
    });

    it('should detect entities near corner via both axes wrapping', () => {
      const players = makePlayers([{ id: 'p1', u: 0.01, v: 0.01 }]);
      const enemies = [makeEntity('e1', 0.99, 0.99)];

      const results = im.update(players, enemies, [], [], []);
      expect(results.get('p1')!.enemyIds.has('e1')).toBe(true);
    });
  });

  describe('cube surface (no wrapping)', () => {
    let im: InterestManager;

    beforeEach(() => {
      im = new InterestManager('cube');
    });

    it('should not wrap either axis', () => {
      const wrap = im.getSurfaceWrap();
      expect(wrap.wrapU).toBe(false);
      expect(wrap.wrapV).toBe(false);
    });

    it('should NOT see entity at opposite boundary', () => {
      const players = makePlayers([{ id: 'p1', u: 0.02, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.98, 0.5)];

      const results = im.update(players, enemies, [], [], []);
      expect(results.get('p1')!.enemyIds.has('e1')).toBe(false);
    });
  });

  describe('priority-based throttling across ticks', () => {
    let im: InterestManager;

    beforeEach(() => {
      im = new InterestManager('sphere');
    });

    it('HIGH priority entities sync every tick', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.52, 0.5)]; // HIGH

      for (let i = 0; i < 10; i++) {
        const results = im.update(players, enemies, [], [], []);
        expect(results.get('p1')!.enemyIds.has('e1')).toBe(true);
      }
    });

    it('MEDIUM priority entities sync every 3rd tick', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.65, 0.5)]; // ~0.15 -> MEDIUM

      const synced: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        const results = im.update(players, enemies, [], [], []);
        synced.push(results.get('p1')!.enemyIds.has('e1'));
      }

      // InterestManager increments tick BEFORE filtering.
      // Tick 1,2,3,4,5,6,7,8,9,10,11,12
      // Medium syncs when tickNumber % 3 === 0: ticks 3, 6, 9, 12
      const syncCount = synced.filter(Boolean).length;
      expect(syncCount).toBe(4); // 4 out of 12
    });

    it('LOW priority entities sync every 6th tick', () => {
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.75, 0.5)]; // ~0.25 -> LOW

      const synced: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        const results = im.update(players, enemies, [], [], []);
        synced.push(results.get('p1')!.enemyIds.has('e1'));
      }

      // Low syncs when tickNumber % 6 === 0: ticks 6, 12
      const syncCount = synced.filter(Boolean).length;
      expect(syncCount).toBe(2); // 2 out of 12
    });
  });

  describe('shouldSync per-entity query', () => {
    it('should return true for in-AOI entity on correct tick', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.52, 0.5)]; // HIGH

      im.update(players, enemies, [], [], []);
      expect(im.shouldSync('p1', 'e1', 'enemy')).toBe(true);
    });

    it('should return false for out-of-AOI entity', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [makeEntity('e1', 0.0, 0.0)]; // NONE

      im.update(players, enemies, [], [], []);
      expect(im.shouldSync('p1', 'e1', 'enemy')).toBe(false);
    });

    it('should return true when no data exists (safe default)', () => {
      const im = new InterestManager('sphere');
      // No update() called yet
      expect(im.shouldSync('p1', 'e1', 'enemy')).toBe(true);
    });
  });

  describe('getPriorities', () => {
    it('should return priority entries for a player', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      const enemies = [
        makeEntity('e1', 0.52, 0.5),
        makeEntity('e2', 0.65, 0.5),
      ];

      im.update(players, enemies, [], [], []);
      const priorities = im.getPriorities('p1', 'enemy');

      expect(priorities.length).toBe(2);
      expect(priorities[0].entityId).toBe('e1');
      expect(priorities[0].priority).toBe(SyncPriority.HIGH);
      expect(priorities[1].entityId).toBe('e2');
      expect(priorities[1].priority).toBe(SyncPriority.MEDIUM);
    });

    it('should return empty array for unknown player', () => {
      const im = new InterestManager('sphere');
      expect(im.getPriorities('nobody', 'enemy')).toEqual([]);
    });
  });

  describe('metrics', () => {
    it('should compute correct metrics', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([
        { id: 'p1', u: 0.5, v: 0.5 },
        { id: 'p2', u: 0.2, v: 0.5 },
      ]);
      const enemies = [
        makeEntity('e1', 0.52, 0.5),  // near p1
        makeEntity('e2', 0.22, 0.5),  // near p2
        makeEntity('e3', 0.0, 0.0),   // far from both
      ];

      im.update(players, enemies, [], [], []);
      const metrics = im.getMetrics();

      expect(metrics.totalEntities).toBe(3);
      expect(metrics.perPlayer.size).toBe(2);

      // p1 should see e1 (close), not e3 (far)
      const p1m = metrics.perPlayer.get('p1')!;
      expect(p1m.enemies).toBeGreaterThanOrEqual(1);

      // Savings ratio should be > 0 since not all entities synced to all players
      expect(metrics.bandwidthSavingsRatio).toBeGreaterThan(0);
    });

    it('should report 0 savings with 0 entities', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);

      im.update(players, [], [], [], []);
      const metrics = im.getMetrics();

      expect(metrics.totalEntities).toBe(0);
      expect(metrics.bandwidthSavingsRatio).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty player map', () => {
      const im = new InterestManager('sphere');
      const enemies = [makeEntity('e1', 0.5, 0.5)];

      const results = im.update(new Map(), enemies, [], [], []);
      expect(results.size).toBe(0);
    });

    it('should handle single player with many entities', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);

      // Create 100 enemies scattered uniformly
      const enemies = makeEntities(100, (i) => ({
        u: (i % 10) / 10 + 0.05,
        v: Math.floor(i / 10) / 10 + 0.05,
      }));

      const results = im.update(players, enemies, [], [], []);
      const p1 = results.get('p1')!;

      // Should NOT sync all 100 (many are outside AOI)
      expect(p1.enemyIds.size).toBeLessThan(100);
      // Should sync at least some (those near center)
      expect(p1.enemyIds.size).toBeGreaterThan(0);
    });

    it('should handle entity exactly at AOI boundary', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      // Entity just inside AOI radius (0.29 < 0.3)
      const enemies = [makeEntity('e1', 0.79, 0.5)]; // distance = 0.29

      const results = im.update(players, enemies, [], [], []);
      const priorities = im.getPriorities('p1', 'enemy');
      expect(priorities[0].priority).toBe(SyncPriority.LOW);

      // Entity just outside AOI (0.31 > 0.3)
      const im2 = new InterestManager('sphere');
      const enemies2 = [makeEntity('e2', 0.81, 0.5)]; // distance = 0.31
      im2.update(players, enemies2, [], [], []);
      const priorities2 = im2.getPriorities('p1', 'enemy');
      expect(priorities2[0].priority).toBe(SyncPriority.NONE);
    });

    it('should handle unknown surface type gracefully', () => {
      const im = new InterestManager('alien_blob');
      const wrap = im.getSurfaceWrap();
      // Falls back to no wrapping
      expect(wrap.wrapU).toBe(false);
      expect(wrap.wrapV).toBe(false);
    });

    it('should support custom AOI radius', () => {
      const im = new InterestManager('sphere', { aoiRadius: 0.5 });
      expect(im.getAoiRadius()).toBe(0.5);

      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);
      // Entity at distance 0.4 - outside default 0.3 but inside custom 0.5
      const enemies = [makeEntity('e1', 0.9, 0.5)]; // distance 0.4

      const results = im.update(players, enemies, [], [], []);
      const priorities = im.getPriorities('p1', 'enemy');
      // Should be classified as LOW (within expanded AOI)
      expect(priorities[0].priority).not.toBe(SyncPriority.NONE);
    });
  });

  describe('bandwidth estimation', () => {
    it('should estimate savings for 100 entities / 4 players', () => {
      const result = InterestManager.estimateBandwidthSavings(100, 4, 0.3, 60);

      expect(result.withoutIM).toBeGreaterThan(0);
      expect(result.withIM).toBeLessThan(result.withoutIM);
      expect(result.savedBytes).toBeGreaterThan(0);
      expect(result.savingsPercent).toBeGreaterThan(0);
      expect(result.savingsPercent).toBeLessThanOrEqual(100);
    });

    it('should estimate savings for 500 entities / 4 players', () => {
      const result = InterestManager.estimateBandwidthSavings(500, 4, 0.3, 60);
      expect(result.savingsPercent).toBeGreaterThan(50);
    });

    it('should estimate savings for 1000 entities / 4 players', () => {
      const result = InterestManager.estimateBandwidthSavings(1000, 4, 0.3, 60);
      expect(result.savingsPercent).toBeGreaterThan(50);
    });

    it('should handle 0 entities', () => {
      const result = InterestManager.estimateBandwidthSavings(0, 4, 0.3, 60);
      expect(result.withoutIM).toBe(0);
      expect(result.withIM).toBe(0);
      expect(result.savedBytes).toBe(0);
      expect(result.savingsPercent).toBe(0);
    });

    it('should produce higher savings with smaller AOI', () => {
      const smallAOI = InterestManager.estimateBandwidthSavings(100, 4, 0.1, 60);
      const largeAOI = InterestManager.estimateBandwidthSavings(100, 4, 0.5, 60);
      expect(smallAOI.savingsPercent).toBeGreaterThan(largeAOI.savingsPercent);
    });
  });

  describe('tick number tracking', () => {
    it('should increment tick number on each update', () => {
      const im = new InterestManager('sphere');
      const players = makePlayers([{ id: 'p1', u: 0.5, v: 0.5 }]);

      expect(im.getTickNumber()).toBe(0);
      im.update(players, [], [], [], []);
      expect(im.getTickNumber()).toBe(1);
      im.update(players, [], [], [], []);
      expect(im.getTickNumber()).toBe(2);
    });
  });
});
