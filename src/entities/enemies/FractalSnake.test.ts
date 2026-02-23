/**
 * FractalSnake enemy unit tests
 *
 * Tests: construction, follower model, formation, die callbacks, movement,
 * position-history-driven follower positions, destroy cleanup.
 *
 * TDD — these were written before the implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FractalSnake } from './FractalSnake';

// Minimal mock surface transform — same pattern as Snake.test.ts
const mockTransform = {
  position: { x: 0, y: 0, z: 0, clone: () => mockTransform.position, copy: () => mockTransform.position, addScaledVector: () => mockTransform.position },
  normal: { x: 0, y: 1, z: 0 },
  tangent: { x: 1, y: 0, z: 0 },
  bitangent: { x: 0, y: 0, z: 1 },
};
const mockGetTransform = () => mockTransform as any;

describe('FractalSnake enemy', () => {
  let snake: FractalSnake;

  beforeEach(() => {
    FractalSnake.onFollowerFreed = null;
    FractalSnake.onHeadDeath = null;
    snake = new FractalSnake(0.5, 0.5);
  });

  afterEach(() => {
    FractalSnake.onFollowerFreed = null;
    FractalSnake.onHeadDeath = null;
  });

  // ──────────────────── construction ────────────────────

  it('creates a head mesh (mesh is not null)', () => {
    expect(snake.mesh).not.toBeNull();
  });

  it('creates a followerRoot group', () => {
    expect(snake.followerRoot).toBeDefined();
  });

  it('adds followerRoot to auxiliaryObjects', () => {
    expect(snake.auxiliaryObjects).toContain(snake.followerRoot);
  });

  it('starts alive', () => {
    expect(snake.alive).toBe(true);
    expect(snake.active).toBe(true);
  });

  it('head mesh has 2 inner spinning triangles', () => {
    // innerTriangles are added to the head mesh group as children
    expect(snake.innerTriangles.length).toBe(2);
    // They should all be children of the head mesh group
    for (const inner of snake.innerTriangles) {
      expect(snake.mesh!.children).toContain(inner);
    }
  });

  // ──────────────────── follower config ────────────────────

  it('default config creates 2 * 4 = 8 followers', () => {
    const data = snake.getFollowerData();
    expect(data.length).toBe(8);
  });

  it('single-row config creates 1 * 4 = 4 followers', () => {
    const singleRow = new FractalSnake(0.5, 0.5, { numRows: 1, followersPerRow: 4 });
    const data = singleRow.getFollowerData();
    expect(data.length).toBe(4);
    singleRow.destroy();
  });

  it('custom followersPerRow creates correct follower count', () => {
    const custom = new FractalSnake(0.5, 0.5, { numRows: 2, followersPerRow: 3 });
    expect(custom.getFollowerData().length).toBe(6);
    custom.destroy();
  });

  it('follower root has same number of children as followers', () => {
    expect(snake.followerRoot.children.length).toBe(snake.getFollowerData().length);
  });

  it('follower data has correct row assignments', () => {
    const data = snake.getFollowerData();
    const row0 = data.filter(f => f.row === 0);
    const row1 = data.filter(f => f.row === 1);
    expect(row0.length).toBe(4);
    expect(row1.length).toBe(4);
  });

  it('follower data has correct rowIndex sequence per row', () => {
    const data = snake.getFollowerData();
    const row0 = data.filter(f => f.row === 0).sort((a, b) => a.rowIndex - b.rowIndex);
    expect(row0.map(f => f.rowIndex)).toEqual([0, 1, 2, 3]);
  });

  it('all followers start alive', () => {
    const data = snake.getFollowerData();
    expect(data.every(f => f.alive)).toBe(true);
  });

  it('getFollowerData returns objects with required fields', () => {
    const f = snake.getFollowerData()[0];
    expect(typeof f.u).toBe('number');
    expect(typeof f.v).toBe('number');
    expect(typeof f.health).toBe('number');
    expect(typeof f.maxHealth).toBe('number');
    expect(typeof f.enemyType).toBe('string');
    expect(typeof f.alive).toBe('boolean');
    expect(typeof f.row).toBe('number');
    expect(typeof f.rowIndex).toBe('number');
  });

  // ──────────────────── die / callbacks ────────────────────

  it('die() fires onHeadDeath with FractalSnake instance', () => {
    let receivedSelf: FractalSnake | null = null;
    FractalSnake.onHeadDeath = (self) => { receivedSelf = self; };

    snake.die();

    expect(receivedSelf).toBe(snake);
    expect(snake.alive).toBe(false);
  });

  it('die() does not fire twice on double-call', () => {
    let callCount = 0;
    FractalSnake.onHeadDeath = () => { callCount++; };

    snake.die();
    snake.die(); // second call should be ignored (alive guard)

    expect(callCount).toBe(1);
  });

  it('onHeadDeath receives the FractalSnake instance (not an array)', () => {
    const tiny = new FractalSnake(0.5, 0.5, { numRows: 1, followersPerRow: 1 });
    let receivedSelf: FractalSnake | null = null;
    FractalSnake.onHeadDeath = (self) => { receivedSelf = self; };

    tiny.die();
    expect(receivedSelf).toBe(tiny);
    // Caller can get followers via receivedSelf.getFollowerData()
    expect(receivedSelf!.getFollowerData().length).toBe(1);

    tiny.destroy();
  });

  it('onHeadDeath callback — follower data includes enemyType', () => {
    const types: string[] = [];
    FractalSnake.onHeadDeath = (self) => {
      self.getFollowerData().filter(f => f.alive).forEach(f => types.push(f.enemyType));
    };
    snake.die();
    expect(types.every(t => typeof t === 'string' && t.length > 0)).toBe(true);
  });

  // ──────────────────── movement ────────────────────

  it('updateBehavior moves head toward player', () => {
    const prevU = snake.surfacePosition.u;
    const prevV = snake.surfacePosition.v;

    snake.updateBehavior(0.016, 0.3, 0.3);

    const moved = Math.abs(snake.surfacePosition.u - prevU) + Math.abs(snake.surfacePosition.v - prevV);
    expect(moved).toBeGreaterThan(0);
  });

  it('position history drives follower positions after enough ticks', () => {
    // Simulate enough frames so history builds up and followers get updated
    for (let i = 0; i < 50; i++) {
      snake.updateBehavior(0.016, 0.2, 0.2);
    }

    const data = snake.getFollowerData();
    const headU = snake.surfacePosition.u;
    const headV = snake.surfacePosition.v;

    // First follower at rowIndex=0, SEGMENT_HISTORY_STEP=6 frames behind
    // After 50 ticks, first follower should NOT be at head's current position
    const firstFollowerRow0 = data.find(f => f.row === 0 && f.rowIndex === 0)!;
    expect(firstFollowerRow0).toBeDefined();
    // It's either at a different position than current head, or V differs by the row offset
    // The important thing: it has been updated from initial position
    expect(firstFollowerRow0.u !== 0.5 || firstFollowerRow0.v !== 0.5).toBe(true);
  });

  it('double-row followers have different V offsets from each other', () => {
    // Run enough ticks so history populates
    for (let i = 0; i < 20; i++) {
      snake.updateBehavior(0.016, 0.5, 0.5);
    }

    const data = snake.getFollowerData();
    // Followers at the same rowIndex but different rows should differ in V
    const f0 = data.find(f => f.row === 0 && f.rowIndex === 0)!;
    const f1 = data.find(f => f.row === 1 && f.rowIndex === 0)!;
    expect(f0).toBeDefined();
    expect(f1).toBeDefined();
    // V should differ by 0.06 (±0.03 offset from same history position)
    expect(Math.abs(f1.v - f0.v)).toBeCloseTo(0.06, 2);
  });

  // ──────────────────── hitTestFollower / damageFollower ────────────────────

  it('hitTestFollower returns null when no followers within radius', () => {
    // Followers start at head position (0.5, 0.5); test far away point
    const idx = snake.hitTestFollower(0.9, 0.9, 0.08);
    expect(idx).toBeNull();
  });

  it('hitTestFollower returns an index for a follower at the same UV', () => {
    // First follower should be at (0.5, 0.5 ± 0.03) initially
    const idx = snake.hitTestFollower(0.5, 0.47, 0.08);
    expect(typeof idx).toBe('number');
    expect(idx).not.toBeNull();
  });

  it('damageFollower reduces follower health', () => {
    const before = snake.getFollowerData()[0].health;
    const idx = snake.hitTestFollower(0.5, 0.47, 0.08) ?? 0;
    snake.damageFollower(idx, 1);
    const after = snake.getFollowerData()[idx].health;
    expect(after).toBe(before - 1);
  });

  it('damageFollower returns true when follower health reaches 0', () => {
    const data = snake.getFollowerData();
    const idx = 0;
    const maxHp = data[idx].maxHealth;
    const died = snake.damageFollower(idx, maxHp);
    expect(died).toBe(true);
    expect(snake.getFollowerData()[idx].alive).toBe(false);
  });

  it('onFollowerFreed fires when follower health reaches 0', () => {
    let firedU = -1;
    let firedType = '';
    FractalSnake.onFollowerFreed = (u, _v, type) => { firedU = u; firedType = type; };

    const data = snake.getFollowerData();
    snake.damageFollower(0, data[0].maxHealth);

    expect(firedU).toBeGreaterThanOrEqual(0);
    expect(firedType.length).toBeGreaterThan(0);
  });

  it('die() fires onHeadDeath before calling super (alive still true inside callback)', () => {
    let aliveInsideCallback = false;
    FractalSnake.onHeadDeath = (self) => { aliveInsideCallback = self.alive; };
    snake.die();
    expect(aliveInsideCallback).toBe(true);
    expect(snake.alive).toBe(false);
  });

  // ──────────────────── destroy ────────────────────

  it('destroy() cleans up meshes without throwing', () => {
    expect(() => snake.destroy()).not.toThrow();
  });

  it('destroy() removes all followers from followerRoot', () => {
    snake.destroy();
    expect(snake.followerRoot.children.length).toBe(0);
  });

  it('destroy() clears follower array (getFollowerData returns empty)', () => {
    snake.destroy();
    expect(snake.getFollowerData().length).toBe(0);
  });
});
