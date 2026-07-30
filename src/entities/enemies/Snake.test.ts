/**
 * Snake enemy unit tests
 *
 * Tests: initial state, segment creation, orbit movement, growing mechanic,
 * segment-peel on bullet hit, head-death spawning all remaining segments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Snake } from './Snake';
import { computeSnakeInitialQueueLength } from './EnemySpawner';

// Minimal mock surface transform used for applySurfaceTransform calls
const mockTransform = {
  position: { x: 0, y: 0, z: 0, clone: () => mockTransform.position, copy: () => mockTransform.position, addScaledVector: () => mockTransform.position },
  normal: { x: 0, y: 1, z: 0, dot: () => 0 },
  tangent: { x: 1, y: 0, z: 0 },
  bitangent: { x: 0, y: 0, z: 1 },
};

const mockGetTransform = () => mockTransform as any;

describe('Snake enemy', () => {
  let snake: Snake;

  beforeEach(() => {
    // Reset static callbacks
    Snake.onHeadDeath = null;
    Snake.onSegmentDeath = null;
    snake = new Snake(0.5, 0.5);
  });

  afterEach(() => {
    Snake.onHeadDeath = null;
    Snake.onSegmentDeath = null;
  });

  // ──────────────────── construction ────────────────────

  it('spawns with correct default initial segment count (2)', () => {
    const data = snake.getSegmentData();
    // DEFAULT_INITIAL_SEGMENTS = 2 (lowest difficulty / early-game default)
    expect(data.length).toBe(2);
  });

  it('spawns with custom initial segment count', () => {
    const snake5 = new Snake(0.5, 0.5, 14, 5);
    expect(snake5.getSegmentData().length).toBe(5);
    snake5.destroy();
  });

  it('clamps initial segments to maxSegments', () => {
    // initialSegments (10) > maxSegments (4) → clamped to 4
    const snakeClamped = new Snake(0.5, 0.5, 4, 10);
    expect(snakeClamped.getSegmentData().length).toBe(4);
    snakeClamped.destroy();
  });

  it('head has non-zero radius', () => {
    expect(snake.radius).toBeGreaterThan(0);
  });

  it('head mesh exists', () => {
    expect(snake.mesh).not.toBeNull();
  });

  it('segmentRoot is a THREE.Group', () => {
    expect(snake.segmentRoot).toBeDefined();
    // segmentRoot has children for each segment (default 2)
    expect(snake.segmentRoot.children.length).toBe(2);
  });

  it('starts alive', () => {
    expect(snake.alive).toBe(true);
    expect(snake.active).toBe(true);
  });

  // ──────────────────── takeDamage ────────────────────

  it('damages the head deterministically instead of randomly peeling tail segments', () => {
    Snake.onSegmentDeath = vi.fn();
    const initialSegCount = snake.getSegmentData().length;
    const initialHP = snake.health;
    snake.takeDamage(1);

    expect(snake.health).toBe(initialHP - 1);
    expect(snake.getSegmentData().length).toBe(initialSegCount);
    expect(snake.segmentRoot.children.length).toBe(initialSegCount);
    expect(snake.alive).toBe(true); // head still alive
    expect(Snake.onSegmentDeath).not.toHaveBeenCalled();
  });

  it('keeps queue records with explicit type, health, maxHealth, and queueIndex', () => {
    const data = snake.getSegmentData();
    expect(data[0]).toMatchObject({
      type: 'grunt',
      health: 2,
      maxHealth: 2,
      queueIndex: 0,
    });
    expect(typeof data[0].surfaceU).toBe('number');
    expect(typeof data[0].surfaceV).toBe('number');
  });

  it('damages head even when Math.random would have taken the old peel path', () => {
    Snake.onSegmentDeath = vi.fn();
    const initialHP = snake.health;

    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);

    snake.takeDamage(1);

    expect(snake.health).toBe(initialHP - 1);
    expect(Snake.onSegmentDeath).not.toHaveBeenCalled();

    randSpy.mockRestore();
  });

  it('tracks dead queue segments without releasing them on head death', () => {
    expect(snake.damageSegment(0, 2)).toBe(true);

    const released: Array<{ queueIndex: number }> = [];
    Snake.onHeadDeath = (segs) => released.push(...segs);

    snake.takeDamage(snake.health);

    expect(released.map((s) => s.queueIndex)).toEqual([1]);
  });

  // ──────────────────── head death ────────────────────

  it('fires onHeadDeath with all remaining segments when head is killed', () => {
    const spawnedGrunts: Array<{ surfaceU: number; surfaceV: number; health: number; maxHealth: number; queueIndex: number }> = [];
    Snake.onHeadDeath = (segs) => segs.forEach((s) => spawnedGrunts.push(s));
    const remainingSegs = snake.getSegmentData().length;
    snake.takeDamage(snake.health);

    expect(snake.alive).toBe(false);
    expect(spawnedGrunts.length).toBe(remainingSegs);
    expect(spawnedGrunts[0]).toMatchObject({
      health: 2,
      maxHealth: 2,
      queueIndex: 0,
    });
    expect(snake.getSegmentData().length).toBe(0);
    expect(snake.segmentRoot.children.length).toBe(0);
  });

  it('does not fire onHeadDeath twice on double die()', () => {
    const calls: number[] = [];
    Snake.onHeadDeath = (segs) => calls.push(segs.length);

    snake.takeDamage(snake.health);
    snake.die(); // second call should be ignored (alive=false guard)

    expect(calls.length).toBe(1);
  });

  it('syncs queued segment records from MP network state', () => {
    snake.setQueuedSegmentsFromNetwork([
      { type: 'grunt', surfaceU: 0.7, surfaceV: 0.6, health: 4, maxHealth: 6, queueIndex: 1 },
      { type: 'grunt', surfaceU: 0.8, surfaceV: 0.6, health: 3, maxHealth: 6, queueIndex: 0 },
      { type: 'grunt', surfaceU: 0.9, surfaceV: 0.6, health: 2, maxHealth: 6, queueIndex: 2 },
    ]);

    const data = snake.getSegmentData();
    expect(data).toHaveLength(3);
    expect(data.map((s) => s.queueIndex)).toEqual([0, 1, 2]);
    expect(data.map((s) => s.health)).toEqual([3, 4, 2]);
    expect(snake.segmentRoot.children.length).toBe(3);
  });

  // ──────────────────── movement ────────────────────

  it('updates surface position each tick (orbit movement)', () => {
    const prevU = snake.surfacePosition.u;
    const prevV = snake.surfacePosition.v;

    snake.updateBehavior(0.016, 0.5, 0.5);

    // Position should change as it tries to orbit
    const movedU = Math.abs(snake.surfacePosition.u - prevU);
    const movedV = Math.abs(snake.surfacePosition.v - prevV);
    expect(movedU + movedV).toBeGreaterThan(0);
  });

  it('segments follow head with some delay (history-based)', () => {
    // Simulate several ticks so posHistory builds up
    for (let i = 0; i < 40; i++) {
      snake.updateBehavior(0.016, 0.3, 0.3); // orbit toward (0.3, 0.3)
    }

    const segs = snake.getSegmentData();
    // Segments should NOT be at the exact same position as the head
    // (they follow with a delay from position history)
    const headU = snake.surfacePosition.u;
    const headV = snake.surfacePosition.v;
    const seg0 = segs[0];
    // First segment is SEGMENT_HISTORY_STEP (8) frames behind head
    // After 40 ticks the head has moved; segment should be at an earlier history entry
    expect(seg0.u !== headU || seg0.v !== headV).toBe(true);
  });

  // ──────────────────── growing ────────────────────

  it('adds a segment after GROW_INTERVAL seconds', () => {
    const before = snake.getSegmentData().length;
    // Simulate just over 7 seconds in small steps
    for (let i = 0; i < 450; i++) {
      snake.updateBehavior(0.016, 0.5, 0.5); // 450 * 0.016 ≈ 7.2s
    }
    const after = snake.getSegmentData().length;
    expect(after).toBeGreaterThan(before);
  });

  // ──────────────────── destroy ────────────────────

  it('clears segment list on destroy', () => {
    snake.destroy();
    expect(snake.getSegmentData().length).toBe(0);
    expect(snake.segmentRoot.children.length).toBe(0);
  });
});

describe('snake queue length scaling', () => {
  it('scales early, mid, and late queues while honoring max segment and enemy budgets', () => {
    expect(computeSnakeInitialQueueLength(0, 50, 50)).toBe(2);
    expect(computeSnakeInitialQueueLength(1.9, 50, 50)).toBe(3);
    expect(computeSnakeInitialQueueLength(3, 50, 50)).toBe(6);
    expect(computeSnakeInitialQueueLength(5.9, 50, 50)).toBe(9);
    expect(computeSnakeInitialQueueLength(8, 50, 50)).toBe(14);
    expect(computeSnakeInitialQueueLength(20, 50, 7)).toBe(7);
    expect(computeSnakeInitialQueueLength(20, 6, 50)).toBe(6);
  });
});
