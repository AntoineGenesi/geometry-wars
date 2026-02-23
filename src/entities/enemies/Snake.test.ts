/**
 * Snake enemy unit tests
 *
 * Tests: initial state, segment creation, orbit movement, growing mechanic,
 * segment-peel on bullet hit, head-death spawning all remaining segments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Snake } from './Snake';

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

  it('spawns with correct initial segment count', () => {
    const data = snake.getSegmentData();
    // INITIAL_SEGMENTS = 4
    expect(data.length).toBe(4);
  });

  it('head has non-zero radius', () => {
    expect(snake.radius).toBeGreaterThan(0);
  });

  it('head mesh exists', () => {
    expect(snake.mesh).not.toBeNull();
  });

  it('segmentRoot is a THREE.Group', () => {
    expect(snake.segmentRoot).toBeDefined();
    // segmentRoot has children for each segment
    expect(snake.segmentRoot.children.length).toBe(4);
  });

  it('starts alive', () => {
    expect(snake.alive).toBe(true);
    expect(snake.active).toBe(true);
  });

  // ──────────────────── takeDamage ────────────────────

  it('frequently peels a tail segment when segments exist', () => {
    const segDead: Array<{ u: number; v: number }> = [];
    Snake.onSegmentDeath = (u, v) => segDead.push({ u, v });

    // Force the random to always pick the segment path
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.7 → segment hit

    const initialSegCount = snake.getSegmentData().length;
    snake.takeDamage(1);

    expect(segDead.length).toBe(1);
    expect(snake.getSegmentData().length).toBe(initialSegCount - 1);
    expect(snake.segmentRoot.children.length).toBe(initialSegCount - 1);
    expect(snake.alive).toBe(true); // head still alive

    randSpy.mockRestore();
  });

  it('damages head when random says head hit', () => {
    Snake.onSegmentDeath = vi.fn();
    const initialHP = snake.health;

    // Force random to head-hit path (>= 0.7)
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

    snake.takeDamage(1);

    expect(snake.health).toBe(initialHP - 1);
    expect(Snake.onSegmentDeath).not.toHaveBeenCalled();

    randSpy.mockRestore();
  });

  it('always damages head when no segments remain', () => {
    // Remove all segments manually by hitting with segment path
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const segmentCount = snake.getSegmentData().length;
    for (let i = 0; i < segmentCount; i++) {
      snake.takeDamage(1);
    }
    randSpy.mockRestore();

    expect(snake.getSegmentData().length).toBe(0);
    const hp = snake.health;

    // Force random to segment path again — but there are none, so should still hit head
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    snake.takeDamage(1);

    expect(snake.health).toBe(hp - 1);
  });

  // ──────────────────── head death ────────────────────

  it('fires onHeadDeath with all remaining segments when head is killed', () => {
    const spawnedGrunts: Array<{ u: number; v: number }> = [];
    Snake.onHeadDeath = (segs) => segs.forEach((s) => spawnedGrunts.push(s));

    // Kill head directly (bypass segment shield by forcing rand >= 0.7 always)
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

    // Reduce health to 1
    for (let i = 0; i < snake.health - 1; i++) {
      snake.takeDamage(1);
    }
    const remainingSegs = snake.getSegmentData().length;
    snake.takeDamage(1); // kill shot

    expect(snake.alive).toBe(false);
    expect(spawnedGrunts.length).toBe(remainingSegs);

    randSpy.mockRestore();
  });

  it('does not fire onHeadDeath twice on double die()', () => {
    const calls: number[] = [];
    Snake.onHeadDeath = (segs) => calls.push(segs.length);

    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    // Kill head
    for (let i = 0; i < snake.health; i++) snake.takeDamage(1);
    snake.die(); // second call should be ignored (alive=false guard)

    expect(calls.length).toBe(1);
    randSpy.mockRestore();
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
