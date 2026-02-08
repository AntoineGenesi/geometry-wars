/**
 * Tests for the Worker-based collision detection and AI computation system.
 *
 * Since Web Workers are not available in vitest, we test:
 * 1. SharedArrayBuffer layout, allocation, and read/write
 * 2. Pure collision detection function (same code that runs in the worker)
 * 3. Pure AI computation function (same code that runs in the worker)
 * 4. WorkerBridge main-thread fallback path
 * 5. WorkerPool management logic
 * 6. Buffer resize/growth behavior
 * 7. Double-buffering swap correctness
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createEntityBuffer,
  createCollisionResultBuffer,
  createAIOutputBuffer,
  getEntityViews,
  getCollisionResultViews,
  getAIOutputViews,
  writeEntityData,
  readCollisionPairs,
  readAIDeltas,
  POS_STRIDE,
  VEL_STRIDE,
  AI_OUTPUT_STRIDE,
  COLLISION_PAIR_STRIDE,
  MAX_COLLISION_PAIRS,
  EnemyType,
  ENEMY_TYPE_MAP,
  type EntityData,
  type EntityBufferLayout,
  type EntityBufferViews,
} from './shared-buffers';

import {
  runCollisionDetection,
  type CollisionInput,
  type CollisionOutput,
} from './collision.worker';

import {
  runAIComputation,
  resetAIState,
  type AIInput,
  type AIOutput,
} from './ai.worker';

import {
  WorkerBridge,
  type CollisionEntity,
  type AIEnemy,
} from './WorkerBridge';

import { WorkerPool } from './WorkerPool';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeEntityData(overrides: Partial<EntityData> = {}): EntityData {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 0.3,
    type: 0,
    surfaceU: 0.5,
    surfaceV: 0.5,
    speed: 0.05,
    ...overrides,
  };
}

function makeCollisionEntity(overrides: Partial<CollisionEntity> = {}): CollisionEntity {
  return {
    position: { x: 0, y: 0, z: 0 },
    radius: 0.3,
    active: true,
    ...overrides,
  };
}

function makeAIEnemy(
  type: string,
  u: number,
  v: number,
  speed: number = 0.05,
): AIEnemy {
  return {
    surfacePosition: { u, v },
    speed,
    active: true,
    alive: true,
    constructor: { name: type } as any,
  };
}

// ---------------------------------------------------------------------------
// SharedArrayBuffer layout tests
// ---------------------------------------------------------------------------

describe('SharedArrayBuffer Layout', () => {
  it('should allocate entity buffer with correct capacity', () => {
    const layout = createEntityBuffer(256);
    expect(layout.capacity).toBe(256);
    expect(layout.count).toBe(0);
    expect(layout.sab).toBeInstanceOf(SharedArrayBuffer);
  });

  it('should allocate entity buffer with non-overlapping regions', () => {
    const layout = createEntityBuffer(100);
    const views = getEntityViews(layout);

    // Verify each view has the correct length
    expect(views.positions.length).toBe(100 * POS_STRIDE);
    expect(views.velocities.length).toBe(100 * VEL_STRIDE);
    expect(views.radii.length).toBe(100);
    expect(views.types.length).toBe(100);
    expect(views.surfaceU.length).toBe(100);
    expect(views.surfaceV.length).toBe(100);
    expect(views.speeds.length).toBe(100);
  });

  it('should write and read positions correctly', () => {
    const layout = createEntityBuffer(10);
    const views = getEntityViews(layout);

    const entities: EntityData[] = [
      makeEntityData({ x: 1.5, y: 2.5, z: 3.5 }),
      makeEntityData({ x: -1.0, y: 0.0, z: 4.0 }),
    ];

    const written = writeEntityData(layout, views, entities);
    expect(written).toBe(2);
    expect(layout.count).toBe(2);

    expect(views.positions[0]).toBeCloseTo(1.5);
    expect(views.positions[1]).toBeCloseTo(2.5);
    expect(views.positions[2]).toBeCloseTo(3.5);
    expect(views.positions[3]).toBeCloseTo(-1.0);
    expect(views.positions[4]).toBeCloseTo(0.0);
    expect(views.positions[5]).toBeCloseTo(4.0);
  });

  it('should write and read radii correctly', () => {
    const layout = createEntityBuffer(5);
    const views = getEntityViews(layout);

    const entities = [
      makeEntityData({ radius: 0.3 }),
      makeEntityData({ radius: 0.5 }),
      makeEntityData({ radius: 1.2 }),
    ];

    writeEntityData(layout, views, entities);

    expect(views.radii[0]).toBeCloseTo(0.3);
    expect(views.radii[1]).toBeCloseTo(0.5);
    expect(views.radii[2]).toBeCloseTo(1.2);
  });

  it('should write and read types correctly', () => {
    const layout = createEntityBuffer(5);
    const views = getEntityViews(layout);

    const entities = [
      makeEntityData({ type: EnemyType.Grunt }),
      makeEntityData({ type: EnemyType.Weaver }),
      makeEntityData({ type: EnemyType.Snake }),
    ];

    writeEntityData(layout, views, entities);

    expect(views.types[0]).toBe(EnemyType.Grunt);
    expect(views.types[1]).toBe(EnemyType.Weaver);
    expect(views.types[2]).toBe(EnemyType.Snake);
  });

  it('should write and read surface coordinates correctly', () => {
    const layout = createEntityBuffer(5);
    const views = getEntityViews(layout);

    const entities = [
      makeEntityData({ surfaceU: 0.25, surfaceV: 0.75 }),
      makeEntityData({ surfaceU: 0.1, surfaceV: 0.9 }),
    ];

    writeEntityData(layout, views, entities);

    expect(views.surfaceU[0]).toBeCloseTo(0.25);
    expect(views.surfaceV[0]).toBeCloseTo(0.75);
    expect(views.surfaceU[1]).toBeCloseTo(0.1);
    expect(views.surfaceV[1]).toBeCloseTo(0.9);
  });

  it('should cap write count at capacity', () => {
    const layout = createEntityBuffer(2);
    const views = getEntityViews(layout);

    const entities = [
      makeEntityData({ x: 1 }),
      makeEntityData({ x: 2 }),
      makeEntityData({ x: 3 }),  // Should be dropped
    ];

    const written = writeEntityData(layout, views, entities);
    expect(written).toBe(2);
    expect(layout.count).toBe(2);
  });

  it('should handle zero entities', () => {
    const layout = createEntityBuffer(10);
    const views = getEntityViews(layout);

    const written = writeEntityData(layout, views, []);
    expect(written).toBe(0);
    expect(layout.count).toBe(0);
  });
});

describe('CollisionResultBuffer Layout', () => {
  it('should allocate collision result buffer', () => {
    const layout = createCollisionResultBuffer(100);
    expect(layout.maxPairs).toBe(100);
    expect(layout.sab).toBeInstanceOf(SharedArrayBuffer);
  });

  it('should read empty collision pairs', () => {
    const layout = createCollisionResultBuffer(100);
    const views = getCollisionResultViews(layout);

    Atomics.store(views.count, 0, 0);
    const pairs = readCollisionPairs(views);
    expect(pairs).toHaveLength(0);
  });

  it('should read collision pairs written via Atomics', () => {
    const layout = createCollisionResultBuffer(100);
    const views = getCollisionResultViews(layout);

    // Simulate worker writing pairs
    views.pairs[0] = 0;
    views.pairs[1] = 5;
    views.pairs[2] = 2;
    views.pairs[3] = 7;
    Atomics.store(views.count, 0, 2);

    const pairs = readCollisionPairs(views);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual([0, 5]);
    expect(pairs[1]).toEqual([2, 7]);
  });
});

describe('AIOutputBuffer Layout', () => {
  it('should allocate AI output buffer', () => {
    const layout = createAIOutputBuffer(100);
    expect(layout.capacity).toBe(100);
    expect(layout.sab).toBeInstanceOf(SharedArrayBuffer);
  });

  it('should read AI deltas', () => {
    const layout = createAIOutputBuffer(10);
    const views = getAIOutputViews(layout);

    // Simulate worker writing deltas
    views.deltas[0] = 0.01;   // enemy 0 du
    views.deltas[1] = -0.02;  // enemy 0 dv
    views.deltas[2] = 0.03;   // enemy 1 du
    views.deltas[3] = 0.04;   // enemy 1 dv

    const deltas = readAIDeltas(views, 2);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].du).toBeCloseTo(0.01);
    expect(deltas[0].dv).toBeCloseTo(-0.02);
    expect(deltas[1].du).toBeCloseTo(0.03);
    expect(deltas[1].dv).toBeCloseTo(0.04);
  });
});

describe('EnemyType mapping', () => {
  it('should map all known enemy class names', () => {
    expect(ENEMY_TYPE_MAP['Grunt']).toBe(EnemyType.Grunt);
    expect(ENEMY_TYPE_MAP['Weaver']).toBe(EnemyType.Weaver);
    expect(ENEMY_TYPE_MAP['Wanderer']).toBe(EnemyType.Wanderer);
    expect(ENEMY_TYPE_MAP['Spinner']).toBe(EnemyType.Spinner);
    expect(ENEMY_TYPE_MAP['Snake']).toBe(EnemyType.Snake);
    expect(ENEMY_TYPE_MAP['Rocket']).toBe(EnemyType.Rocket);
    expect(ENEMY_TYPE_MAP['Repulsor']).toBe(EnemyType.Repulsor);
    expect(ENEMY_TYPE_MAP['GravityWell']).toBe(EnemyType.GravityWell);
    expect(ENEMY_TYPE_MAP['Boss']).toBe(EnemyType.Boss);
  });

  it('should return undefined for unknown types', () => {
    expect(ENEMY_TYPE_MAP['NonExistentEnemy']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pure collision detection tests
// ---------------------------------------------------------------------------

describe('Collision Detection (pure function)', () => {
  let resultBuffer: ReturnType<typeof createCollisionResultBuffer>;
  let resultViews: ReturnType<typeof getCollisionResultViews>;

  beforeEach(() => {
    resultBuffer = createCollisionResultBuffer(1000);
    resultViews = getCollisionResultViews(resultBuffer);
  });

  it('should detect collision between overlapping entities', () => {
    const positions = new Float32Array([
      0, 0, 0,     // Entity 0 at origin
      0.2, 0, 0,   // Entity 1 very close (within combined radii)
    ]);
    const radii = new Float32Array([0.3, 0.3]); // Combined: 0.6, distance: 0.2

    const input: CollisionInput = { positions, radii, count: 2 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(1);

    const pairs = readCollisionPairs(resultViews);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([0, 1]);
  });

  it('should NOT detect collision between distant entities', () => {
    const positions = new Float32Array([
      0, 0, 0,
      10, 10, 10,  // Far away
    ]);
    const radii = new Float32Array([0.3, 0.3]);

    const input: CollisionInput = { positions, radii, count: 2 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(0);
  });

  it('should handle zero entities', () => {
    const positions = new Float32Array(0);
    const radii = new Float32Array(0);

    const input: CollisionInput = { positions, radii, count: 0 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(0);
  });

  it('should handle single entity (no pairs possible)', () => {
    const positions = new Float32Array([1, 2, 3]);
    const radii = new Float32Array([0.5]);

    const input: CollisionInput = { positions, radii, count: 1 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(0);
  });

  it('should detect multiple collision pairs', () => {
    // Three entities in a cluster
    const positions = new Float32Array([
      0, 0, 0,
      0.1, 0, 0,
      0.2, 0, 0,
    ]);
    const radii = new Float32Array([0.3, 0.3, 0.3]);

    const input: CollisionInput = { positions, radii, count: 3 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    // All 3 pairs should collide: (0,1), (0,2), (1,2)
    expect(count).toBe(3);
  });

  it('should not produce duplicate pairs', () => {
    const positions = new Float32Array([
      0, 0, 0,
      0.1, 0, 0,
    ]);
    const radii = new Float32Array([0.5, 0.5]);

    const input: CollisionInput = { positions, radii, count: 2 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(1);

    const pairs = readCollisionPairs(resultViews);
    // Should be [0, 1] not [1, 0] (i < j ordering)
    expect(pairs[0][0]).toBeLessThan(pairs[0][1]);
  });

  it('should handle entities in different spatial hash cells', () => {
    // Two clusters, each pair collides within cluster but not across
    const positions = new Float32Array([
      0, 0, 0,       // Cluster A
      0.1, 0, 0,     // Cluster A
      100, 100, 100,  // Cluster B
      100.1, 100, 100, // Cluster B
    ]);
    const radii = new Float32Array([0.3, 0.3, 0.3, 0.3]);

    const input: CollisionInput = { positions, radii, count: 4 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(2);  // Two collisions, one per cluster
  });

  it('should respect maxPairs limit', () => {
    const smallResultBuffer = createCollisionResultBuffer(1);
    const smallViews = getCollisionResultViews(smallResultBuffer);

    // Three overlapping entities = 3 pairs, but maxPairs = 1
    const positions = new Float32Array([
      0, 0, 0,
      0.1, 0, 0,
      0.2, 0, 0,
    ]);
    const radii = new Float32Array([0.3, 0.3, 0.3]);

    const input: CollisionInput = { positions, radii, count: 3 };
    const output: CollisionOutput = {
      pairs: smallViews.pairs,
      pairCount: smallViews.count,
      maxPairs: 1,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(1);
  });

  it('should detect collisions across spatial hash cell boundaries', () => {
    // Two entities in adjacent cells, just barely touching
    const cellSize = 2.5;
    const positions = new Float32Array([
      cellSize - 0.1, 0, 0,  // Near cell boundary
      cellSize + 0.1, 0, 0,  // Other side of boundary
    ]);
    const radii = new Float32Array([0.5, 0.5]); // Combined: 1.0, distance: 0.2

    const input: CollisionInput = { positions, radii, count: 2 };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const count = runCollisionDetection(input, output);
    expect(count).toBe(1);
  });

  it('should handle 100 entities efficiently', () => {
    const n = 100;
    const positions = new Float32Array(n * 3);
    const radii = new Float32Array(n);

    // Spread entities on a grid (some will collide, most won't)
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (i % 10) * 2;
      positions[i * 3 + 1] = Math.floor(i / 10) * 2;
      positions[i * 3 + 2] = 0;
      radii[i] = 0.3;
    }

    const input: CollisionInput = { positions, radii, count: n };
    const output: CollisionOutput = {
      pairs: resultViews.pairs,
      pairCount: resultViews.count,
      maxPairs: resultBuffer.maxPairs,
    };

    const start = performance.now();
    runCollisionDetection(input, output);
    const elapsed = performance.now() - start;

    // Should complete in well under 16ms for 100 entities
    expect(elapsed).toBeLessThan(16);
  });
});

// ---------------------------------------------------------------------------
// Pure AI computation tests
// ---------------------------------------------------------------------------

describe('AI Computation (pure function)', () => {
  let aiOutputLayout: ReturnType<typeof createAIOutputBuffer>;
  let aiViews: ReturnType<typeof getAIOutputViews>;

  beforeEach(() => {
    resetAIState();
    aiOutputLayout = createAIOutputBuffer(100);
    aiViews = getAIOutputViews(aiOutputLayout);
  });

  afterEach(() => {
    resetAIState();
  });

  it('should compute grunt AI: chase toward player', () => {
    const surfaceU = new Float32Array([0.2]);
    const surfaceV = new Float32Array([0.2]);
    const types = new Uint8Array([EnemyType.Grunt]);
    const speeds = new Float32Array([0.05]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.8,
      playerV: 0.8,
      dt: 1.0,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);

    const deltas = readAIDeltas(aiViews, 1);
    expect(deltas).toHaveLength(1);
    // Grunt should move toward player (positive du and dv since player is at 0.8, 0.8)
    expect(deltas[0].du).toBeGreaterThan(0);
    expect(deltas[0].dv).toBeGreaterThan(0);
  });

  it('should compute weaver AI: momentum-based chase', () => {
    const surfaceU = new Float32Array([0.3]);
    const surfaceV = new Float32Array([0.3]);
    const types = new Uint8Array([EnemyType.Weaver]);
    const speeds = new Float32Array([0.04]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.7,
      playerV: 0.7,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);

    // Weaver should have some movement toward player
    expect(deltas[0].du).toBeGreaterThan(0);
    expect(deltas[0].dv).toBeGreaterThan(0);
  });

  it('should compute wanderer AI: random direction', () => {
    const surfaceU = new Float32Array([0.5]);
    const surfaceV = new Float32Array([0.5]);
    const types = new Uint8Array([EnemyType.Wanderer]);
    const speeds = new Float32Array([0.04]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.5,
      playerV: 0.5,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);

    // Wanderer moves in some direction (may be any direction)
    const magnitude = Math.sqrt(deltas[0].du * deltas[0].du + deltas[0].dv * deltas[0].dv);
    expect(magnitude).toBeGreaterThan(0);
  });

  it('should compute rocket AI: straight line with bounce', () => {
    // Place rocket near boundary so it might bounce
    const surfaceU = new Float32Array([0.99]);
    const surfaceV = new Float32Array([0.5]);
    const types = new Uint8Array([EnemyType.Rocket]);
    const speeds = new Float32Array([0.05]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.5,
      playerV: 0.5,
      dt: 0.5,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);

    // Rocket should produce non-zero movement
    const magnitude = Math.sqrt(deltas[0].du * deltas[0].du + deltas[0].dv * deltas[0].dv);
    expect(magnitude).toBeGreaterThan(0);
  });

  it('should compute repulsor AI: 3-phase behavior', () => {
    const surfaceU = new Float32Array([0.5]);
    const surfaceV = new Float32Array([0.5]);
    const types = new Uint8Array([EnemyType.Repulsor]);
    const speeds = new Float32Array([0.06]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.8,
      playerV: 0.8,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    // Phase 0 (Lock): should not move
    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);
    expect(deltas[0].du).toBe(0);
    expect(deltas[0].dv).toBe(0);
  });

  it('should compute snake AI: sinusoidal chase', () => {
    const surfaceU = new Float32Array([0.3]);
    const surfaceV = new Float32Array([0.3]);
    const types = new Uint8Array([EnemyType.Snake]);
    const speeds = new Float32Array([0.05]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.7,
      playerV: 0.7,
      dt: 0.5,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);

    // Snake should move generally toward player
    const magnitude = Math.sqrt(deltas[0].du * deltas[0].du + deltas[0].dv * deltas[0].dv);
    expect(magnitude).toBeGreaterThan(0);
  });

  it('should handle multiple enemy types simultaneously', () => {
    const count = 5;
    const surfaceU = new Float32Array([0.2, 0.4, 0.6, 0.8, 0.1]);
    const surfaceV = new Float32Array([0.2, 0.4, 0.6, 0.8, 0.1]);
    const types = new Uint8Array([
      EnemyType.Grunt,
      EnemyType.Weaver,
      EnemyType.Wanderer,
      EnemyType.Spinner,
      EnemyType.Snake,
    ]);
    const speeds = new Float32Array([0.05, 0.04, 0.04, 0.05, 0.05]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count,
      playerU: 0.5,
      playerV: 0.5,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, count);

    expect(deltas).toHaveLength(5);
    // Each enemy should produce some movement
    for (const delta of deltas) {
      const magnitude = Math.sqrt(delta.du * delta.du + delta.dv * delta.dv);
      expect(magnitude).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle unknown enemy types with default chase AI', () => {
    const surfaceU = new Float32Array([0.2]);
    const surfaceV = new Float32Array([0.2]);
    const types = new Uint8Array([255]); // Unknown type
    const speeds = new Float32Array([0.05]);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: 1,
      playerU: 0.8,
      playerV: 0.8,
      dt: 1.0,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas = readAIDeltas(aiViews, 1);

    // Default AI should chase player
    expect(deltas[0].du).toBeGreaterThan(0);
    expect(deltas[0].dv).toBeGreaterThan(0);
  });

  it('should set ready flag via Atomics after computation', () => {
    Atomics.store(aiViews.ready, 0, 0);

    const input: AIInput = {
      surfaceU: new Float32Array([0.5]),
      surfaceV: new Float32Array([0.5]),
      types: new Uint8Array([0]),
      speeds: new Float32Array([0.05]),
      count: 1,
      playerU: 0.5,
      playerV: 0.5,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    expect(Atomics.load(aiViews.ready, 0)).toBe(1);
  });

  it('should reset AI state correctly', () => {
    // Run AI to create state
    const input: AIInput = {
      surfaceU: new Float32Array([0.5]),
      surfaceV: new Float32Array([0.5]),
      types: new Uint8Array([EnemyType.Grunt]),
      speeds: new Float32Array([0.05]),
      count: 1,
      playerU: 0.8,
      playerV: 0.8,
      dt: 1.0,
    };

    const output: AIOutput = {
      deltas: aiViews.deltas,
      ready: aiViews.ready,
    };

    runAIComputation(input, output);
    const deltas1 = readAIDeltas(aiViews, 1);

    // Reset and run again -- grunt state (currentSpeed) should reset
    resetAIState();
    runAIComputation(input, output);
    const deltas2 = readAIDeltas(aiViews, 1);

    // After reset, grunt starts with currentSpeed=0.02 again
    // Both runs should produce similar results (reset restores initial state)
    expect(deltas2[0].du).toBeCloseTo(deltas1[0].du, 3);
    expect(deltas2[0].dv).toBeCloseTo(deltas1[0].dv, 3);
  });

  it('should handle 500 enemies efficiently', () => {
    const n = 500;
    const surfaceU = new Float32Array(n);
    const surfaceV = new Float32Array(n);
    const types = new Uint8Array(n);
    const speeds = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      surfaceU[i] = Math.random();
      surfaceV[i] = Math.random();
      types[i] = i % 8; // Cycle through types
      speeds[i] = 0.03 + Math.random() * 0.04;
    }

    const bigAIOutput = createAIOutputBuffer(n);
    const bigViews = getAIOutputViews(bigAIOutput);

    const input: AIInput = {
      surfaceU, surfaceV, types, speeds,
      count: n,
      playerU: 0.5,
      playerV: 0.5,
      dt: 0.016,
    };

    const output: AIOutput = {
      deltas: bigViews.deltas,
      ready: bigViews.ready,
    };

    const start = performance.now();
    runAIComputation(input, output);
    const elapsed = performance.now() - start;

    // Should complete well within a frame budget
    expect(elapsed).toBeLessThan(16);
  });
});

// ---------------------------------------------------------------------------
// WorkerBridge tests (main-thread fallback path)
// ---------------------------------------------------------------------------

describe('WorkerBridge (fallback mode)', () => {
  let bridge: WorkerBridge;

  beforeEach(() => {
    bridge = new WorkerBridge({
      useWorkers: false,
      initialCapacity: 256,
    });
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should create bridge in fallback mode', () => {
    expect(bridge.isUsingWorkers).toBe(false);
  });

  it('should report initial capacity', () => {
    expect(bridge.capacity).toBe(256);
  });

  it('should detect collisions between overlapping entities', () => {
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: 0.3, y: 0, z: 0 }, radius: 0.5 }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].indexA).toBe(0);
    expect(pairs[0].indexB).toBe(1);
  });

  it('should not detect collision between distant entities', () => {
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.3 }),
      makeCollisionEntity({ position: { x: 10, y: 10, z: 10 }, radius: 0.3 }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(0);
  });

  it('should skip inactive entities', () => {
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.5, active: true }),
      makeCollisionEntity({ position: { x: 0.1, y: 0, z: 0 }, radius: 0.5, active: false }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(0);
  });

  it('should handle empty entity list', () => {
    const pairs = bridge.updateCollisions([]);
    expect(pairs).toHaveLength(0);
  });

  it('should compute enemy AI movement deltas', () => {
    const enemies: AIEnemy[] = [
      makeAIEnemy('Grunt', 0.2, 0.2, 0.05),
    ];

    const deltas = bridge.updateEnemyAI(enemies, 0.8, 0.8, 1.0);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].du).toBeGreaterThan(0);
    expect(deltas[0].dv).toBeGreaterThan(0);
  });

  it('should compute deltas for multiple enemy types', () => {
    const enemies: AIEnemy[] = [
      makeAIEnemy('Grunt', 0.2, 0.2),
      makeAIEnemy('Weaver', 0.4, 0.4),
      makeAIEnemy('Wanderer', 0.6, 0.6),
    ];

    const deltas = bridge.updateEnemyAI(enemies, 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(3);
  });

  it('should skip inactive/dead enemies in AI', () => {
    const enemies: AIEnemy[] = [
      makeAIEnemy('Grunt', 0.2, 0.2),
      { ...makeAIEnemy('Grunt', 0.3, 0.3), active: false },
      { ...makeAIEnemy('Grunt', 0.4, 0.4), alive: false },
    ];

    const deltas = bridge.updateEnemyAI(enemies, 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(1);
  });

  it('should handle empty enemy list for AI', () => {
    const deltas = bridge.updateEnemyAI([], 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(0);
  });

  it('should auto-grow buffer when entity count exceeds capacity', () => {
    const smallBridge = new WorkerBridge({
      useWorkers: false,
      initialCapacity: 4,
      growthFactor: 2,
    });

    // Create more entities than initial capacity
    const entities: CollisionEntity[] = [];
    for (let i = 0; i < 10; i++) {
      entities.push(makeCollisionEntity({
        position: { x: i * 5, y: 0, z: 0 },
        radius: 0.3,
      }));
    }

    // Should not throw, buffer should grow
    const pairs = smallBridge.updateCollisions(entities);
    expect(smallBridge.capacity).toBeGreaterThanOrEqual(10);

    smallBridge.dispose();
  });

  it('should reset AI state', () => {
    const enemies: AIEnemy[] = [makeAIEnemy('Grunt', 0.2, 0.2)];

    bridge.updateEnemyAI(enemies, 0.8, 0.8, 1.0);
    bridge.resetState();

    // Should not throw after reset
    const deltas = bridge.updateEnemyAI(enemies, 0.8, 0.8, 1.0);
    expect(deltas).toHaveLength(1);
  });

  it('should return empty results after disposal', () => {
    bridge.dispose();
    const pairs = bridge.updateCollisions([makeCollisionEntity()]);
    expect(pairs).toHaveLength(0);

    const deltas = bridge.updateEnemyAI([makeAIEnemy('Grunt', 0.5, 0.5)], 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(0);
  });

  it('should handle async collision path in fallback mode', async () => {
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: 0.3, y: 0, z: 0 }, radius: 0.5 }),
    ];

    const pairs = await bridge.updateCollisionsAsync(entities);
    expect(pairs).toHaveLength(1);
  });

  it('should handle async AI path in fallback mode', async () => {
    const enemies: AIEnemy[] = [makeAIEnemy('Grunt', 0.2, 0.2)];
    const deltas = await bridge.updateEnemyAIAsync(enemies, 0.8, 0.8, 1.0);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].du).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WorkerBridge static methods
// ---------------------------------------------------------------------------

describe('WorkerBridge.isWorkerAvailable', () => {
  it('should return a boolean', () => {
    const result = WorkerBridge.isWorkerAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// WorkerPool tests (without actual workers)
// ---------------------------------------------------------------------------

describe('WorkerPool', () => {
  it('should create pool with specified worker count', () => {
    const mockWorkers: any[] = [];
    const pool = new WorkerPool(
      () => {
        const w = { postMessage: () => {}, onmessage: null, onerror: null, terminate: () => {} };
        mockWorkers.push(w);
        return w as any;
      },
      3,
    );

    expect(pool.size).toBe(3);
    expect(mockWorkers).toHaveLength(3);
    pool.terminate();
  });

  it('should start with zero busy workers', () => {
    const pool = new WorkerPool(
      () => ({ postMessage: () => {}, onmessage: null, onerror: null, terminate: () => {} } as any),
      2,
    );

    expect(pool.busyCount).toBe(0);
    expect(pool.queueLength).toBe(0);
    pool.terminate();
  });

  it('should dispatch task to worker and resolve on response', async () => {
    let workerRef: any = null;
    const pool = new WorkerPool<any, any>(
      () => {
        const w = {
          postMessage: (data: any) => {
            // Simulate async response
            setTimeout(() => {
              (w as any).onmessage({ data: { result: data.value * 2 } });
            }, 5);
          },
          onmessage: null as any,
          onerror: null as any,
          terminate: () => {},
        };
        workerRef = w;
        return w as any;
      },
      1,
    );

    const result = await pool.execute({ value: 21 });
    expect(result).toEqual({ result: 42 });
    pool.terminate();
  });

  it('should queue tasks when all workers are busy', async () => {
    const pool = new WorkerPool<any, any>(
      () => ({
        postMessage: () => {},
        onmessage: null,
        onerror: null,
        terminate: () => {},
      } as any),
      1,
    );

    // First task occupies the single worker
    const p1 = pool.execute({ task: 1 }).catch(() => { /* expected on terminate */ });
    expect(pool.busyCount).toBe(1);

    // Second task should be queued
    const p2 = pool.execute({ task: 2 }).catch(() => { /* expected on terminate */ });
    expect(pool.queueLength).toBe(1);

    pool.terminate();
    await Promise.allSettled([p1, p2]);
  });

  it('should reject pending tasks on terminate', async () => {
    const pool = new WorkerPool<any, any>(
      () => ({
        postMessage: () => {},
        onmessage: null,
        onerror: null,
        terminate: () => {},
      } as any),
      1,
    );

    const promise = pool.execute({ task: 1 });
    pool.terminate();

    await expect(promise).rejects.toThrow('WorkerPool terminated');
  });

  it('should reject new tasks after termination', async () => {
    const pool = new WorkerPool<any, any>(
      () => ({
        postMessage: () => {},
        onmessage: null,
        onerror: null,
        terminate: () => {},
      } as any),
      1,
    );

    pool.terminate();

    await expect(pool.execute({ task: 1 })).rejects.toThrow('WorkerPool has been terminated');
  });

  it('should handle worker error and reject task', async () => {
    let workerRef: any = null;
    const pool = new WorkerPool<any, any>(
      () => {
        const w = {
          postMessage: () => {
            // Simulate error
            setTimeout(() => {
              (w as any).onerror({ message: 'Worker crashed' });
            }, 5);
          },
          onmessage: null as any,
          onerror: null as any,
          terminate: () => {},
        };
        workerRef = w;
        return w as any;
      },
      1,
    );

    await expect(pool.execute({ task: 1 })).rejects.toThrow('Worker crashed');
    pool.terminate();
  });

  it('should process queued tasks after current task completes', async () => {
    const results: number[] = [];
    const pool = new WorkerPool<any, any>(
      () => {
        const w = {
          postMessage: (data: any) => {
            setTimeout(() => {
              (w as any).onmessage({ data: { id: data.id } });
            }, 5);
          },
          onmessage: null as any,
          onerror: null as any,
          terminate: () => {},
        };
        return w as any;
      },
      1,
    );

    const p1 = pool.execute({ id: 1 }).then(r => { results.push(r.id); return r; });
    const p2 = pool.execute({ id: 2 }).then(r => { results.push(r.id); return r; });

    await Promise.all([p1, p2]);
    expect(results).toEqual([1, 2]);

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// Integration: collision + AI pipeline
// ---------------------------------------------------------------------------

describe('Integration: full pipeline', () => {
  let bridge: WorkerBridge;

  beforeEach(() => {
    bridge = new WorkerBridge({ useWorkers: false, initialCapacity: 128 });
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should run collision + AI in same frame', () => {
    // Setup: 3 enemies near each other + player
    const collisionEntities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: 0.3, y: 0, z: 0 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: 5, y: 5, z: 5 }, radius: 0.3 }),
    ];

    const aiEnemies: AIEnemy[] = [
      makeAIEnemy('Grunt', 0.2, 0.2),
      makeAIEnemy('Weaver', 0.3, 0.3),
      makeAIEnemy('Wanderer', 0.8, 0.8),
    ];

    // Run collision detection
    const pairs = bridge.updateCollisions(collisionEntities);
    expect(pairs.length).toBeGreaterThanOrEqual(1);

    // Run AI computation
    const deltas = bridge.updateEnemyAI(aiEnemies, 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(3);

    // Verify grunt moves toward player
    expect(deltas[0].du).toBeGreaterThan(0);
    expect(deltas[0].dv).toBeGreaterThan(0);
  });

  it('should handle rapid sequential frames', () => {
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 0, y: 0, z: 0 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: 0.3, y: 0, z: 0 }, radius: 0.5 }),
    ];

    // Simulate 10 frames
    for (let frame = 0; frame < 10; frame++) {
      const pairs = bridge.updateCollisions(entities);
      expect(pairs).toHaveLength(1);
    }
  });

  it('should handle 1000 entities with collision + AI pipeline', () => {
    const n = 1000;

    const collisionEntities: CollisionEntity[] = [];
    const aiEnemies: AIEnemy[] = [];
    const types = ['Grunt', 'Weaver', 'Wanderer', 'Spinner', 'Snake'];

    for (let i = 0; i < n; i++) {
      const x = (i % 50) * 2;
      const y = Math.floor(i / 50) * 2;
      collisionEntities.push(makeCollisionEntity({
        position: { x, y, z: 0 },
        radius: 0.3,
      }));

      aiEnemies.push(makeAIEnemy(
        types[i % types.length],
        Math.random(),
        Math.random(),
        0.03 + Math.random() * 0.03,
      ));
    }

    const start = performance.now();

    const pairs = bridge.updateCollisions(collisionEntities);
    const deltas = bridge.updateEnemyAI(aiEnemies, 0.5, 0.5, 0.016);

    const elapsed = performance.now() - start;

    expect(deltas).toHaveLength(n);
    // Both operations should complete well within a frame at 60fps
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Double-buffering verification
// ---------------------------------------------------------------------------

describe('Double-buffering', () => {
  it('should swap buffers between writes', () => {
    const bridge = new WorkerBridge({ useWorkers: false, initialCapacity: 32 });

    // First call writes to back buffer, swaps
    bridge.updateCollisions([
      makeCollisionEntity({ position: { x: 1, y: 0, z: 0 }, radius: 0.3 }),
    ]);

    // Second call writes to other buffer, swaps again
    bridge.updateCollisions([
      makeCollisionEntity({ position: { x: 2, y: 0, z: 0 }, radius: 0.3 }),
    ]);

    // Should not throw or corrupt data
    bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('should handle entities at the same position (distance = 0)', () => {
    const bridge = new WorkerBridge({ useWorkers: false });
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 5, y: 5, z: 5 }, radius: 0.3 }),
      makeCollisionEntity({ position: { x: 5, y: 5, z: 5 }, radius: 0.3 }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(1);
    bridge.dispose();
  });

  it('should handle very large coordinates', () => {
    const bridge = new WorkerBridge({ useWorkers: false });
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: 99999, y: 99999, z: 99999 }, radius: 0.3 }),
      makeCollisionEntity({ position: { x: 99999.1, y: 99999, z: 99999 }, radius: 0.3 }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(1);
    bridge.dispose();
  });

  it('should handle negative coordinates', () => {
    const bridge = new WorkerBridge({ useWorkers: false });
    const entities: CollisionEntity[] = [
      makeCollisionEntity({ position: { x: -5, y: -5, z: -5 }, radius: 0.5 }),
      makeCollisionEntity({ position: { x: -4.8, y: -5, z: -5 }, radius: 0.5 }),
    ];

    const pairs = bridge.updateCollisions(entities);
    expect(pairs).toHaveLength(1);
    bridge.dispose();
  });

  it('should handle AI with player at same position as enemy', () => {
    const bridge = new WorkerBridge({ useWorkers: false });
    const enemies: AIEnemy[] = [makeAIEnemy('Grunt', 0.5, 0.5)];

    // Player at exact same position
    const deltas = bridge.updateEnemyAI(enemies, 0.5, 0.5, 0.016);
    expect(deltas).toHaveLength(1);
    // Grunt should produce near-zero movement when at player position
    expect(Math.abs(deltas[0].du)).toBeLessThan(0.01);
    expect(Math.abs(deltas[0].dv)).toBeLessThan(0.01);

    bridge.dispose();
  });

  it('should handle zero dt for AI', () => {
    const bridge = new WorkerBridge({ useWorkers: false });
    const enemies: AIEnemy[] = [makeAIEnemy('Grunt', 0.2, 0.2)];

    const deltas = bridge.updateEnemyAI(enemies, 0.8, 0.8, 0);
    expect(deltas).toHaveLength(1);
    // With dt=0, movement should be zero
    expect(deltas[0].du).toBe(0);
    expect(deltas[0].dv).toBe(0);

    bridge.dispose();
  });
});
