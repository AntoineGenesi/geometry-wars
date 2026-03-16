/**
 * AiTaskDispatcher unit tests
 *
 * Tests the validation logic (V1 range clamping, V2 cross-validation)
 * and the dispatcher's result storage/retrieval.
 *
 * Run with: cd distributed-compute-experiment && npx vitest tests/AiTaskDispatcher.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiTaskDispatcher, computeServerAI } from '../server/AiTaskDispatcher';
import { ComputationPool } from '../server/ComputationPool';
import type { AiResult, AiTask, EnemySnapshot, PlayerSnapshot } from '../protocol/messages';

// ---------------------------------------------------------------------------
// computeServerAI unit tests
// ---------------------------------------------------------------------------

describe('computeServerAI', () => {
  const players: PlayerSnapshot[] = [
    { id: 'p1', u: 0.8, v: 0.5, alive: true },
  ];

  it('moves toward nearest player', () => {
    const enemy: EnemySnapshot = { id: 'e1', type: 'grunt', u: 0.5, v: 0.5 };
    const dt = 1 / 60;
    const result = computeServerAI(enemy, players, dt);

    // Enemy at (0.5, 0.5), player at (0.8, 0.5) → should move in +u direction
    expect(result.id).toBe('e1');
    expect(result.du).toBeGreaterThan(0);
    expect(Math.abs(result.dv)).toBeLessThan(0.001); // No v movement needed
  });

  it('returns zero delta when no alive players', () => {
    const enemy: EnemySnapshot = { id: 'e1', type: 'grunt', u: 0.5, v: 0.5 };
    const deadPlayers: PlayerSnapshot[] = [
      { id: 'p1', u: 0.8, v: 0.5, alive: false },
    ];
    const result = computeServerAI(enemy, deadPlayers, 1/60);
    expect(result.du).toBe(0);
    expect(result.dv).toBe(0);
  });

  it('uses toroidal distance — prefers short path across boundary', () => {
    // Enemy at u=0.05, player at u=0.95 → shortest path is -0.1 (go left, cross 0)
    const enemy: EnemySnapshot = { id: 'e1', type: 'grunt', u: 0.05, v: 0.5 };
    const player: PlayerSnapshot = { id: 'p1', u: 0.95, v: 0.5, alive: true };
    const result = computeServerAI(enemy, [player], 1/60);
    // Should move in -u direction (toward u=0 boundary, then wrap to u=0.95)
    expect(result.du).toBeLessThan(0);
  });

  it('respects enemy speed (grunt slower than mayfly)', () => {
    const gruntEnemy: EnemySnapshot = { id: 'e_grunt', type: 'grunt', u: 0.5, v: 0.5 };
    const mayflyEnemy: EnemySnapshot = { id: 'e_mayfly', type: 'mayfly', u: 0.5, v: 0.5 };
    const dt = 1 / 60;

    const gruntResult = computeServerAI(gruntEnemy, players, dt);
    const mayflyResult = computeServerAI(mayflyEnemy, players, dt);

    const gruntMag = Math.hypot(gruntResult.du, gruntResult.dv);
    const mayflyMag = Math.hypot(mayflyResult.du, mayflyResult.dv);

    expect(mayflyMag).toBeGreaterThan(gruntMag);
  });
});

// ---------------------------------------------------------------------------
// AiTaskDispatcher validation tests
// ---------------------------------------------------------------------------

describe('AiTaskDispatcher — validation', () => {
  let pool: ComputationPool;
  let dispatcher: AiTaskDispatcher;
  const sentMessages: Array<{ sessionId: string; type: string; data: unknown }> = [];
  const sentAcks: Array<{ sessionId: string; taskId: string; outcome: string }> = [];

  beforeEach(() => {
    sentMessages.length = 0;
    sentAcks.length = 0;

    pool = new ComputationPool();
    pool.addClient('client1');
    pool.updateHeartbeat('client1', 30, 90);
    pool.setSharedLoad(50);

    dispatcher = new AiTaskDispatcher(
      pool,
      (sessionId, type, data) => sentMessages.push({ sessionId, type, data }),
      (sessionId, taskId, outcome) => sentAcks.push({ sessionId, taskId, outcome }),
    );
  });

  const makeEnemies = (count: number): EnemySnapshot[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `e${i}`,
      type: 'grunt',
      u: 0.1 + i * 0.05,
      v: 0.5,
    }));

  const makePlayers = (): PlayerSnapshot[] => [
    { id: 'p1', u: 0.8, v: 0.5, alive: true },
  ];

  it('dispatchTasks sends an AiTask message to an eligible client', () => {
    const enemies = makeEnemies(10);
    const players = makePlayers();

    dispatcher.dispatchTasks(1, enemies as any, players as any, 1/60);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe('ai_task');
    expect(sentMessages[0].sessionId).toBe('client1');
  });

  it('does not dispatch when sharedLoad is 0', () => {
    pool.setSharedLoad(0);
    dispatcher.dispatchTasks(1, makeEnemies(10) as any, makePlayers() as any, 1/60);
    expect(sentMessages).toHaveLength(0);
  });

  it('accepts valid result within speed limits', () => {
    const enemies = makeEnemies(2);
    const players = makePlayers();
    dispatcher.dispatchTasks(1, enemies as any, players as any, 1/60);

    const taskId = (sentMessages[0].data as any).taskId;

    // Compute the correct result using server AI (should always pass V2)
    const results = enemies.map(e => computeServerAI(e, players, 1/60));
    const validResult: AiResult = {
      type: 'ai_result',
      taskId,
      tick: 1,
      results,
    };

    dispatcher.receiveResult(validResult, 1);

    expect(sentAcks).toHaveLength(1);
    expect(sentAcks[0].outcome).toBe('applied');
  });

  it('rejects result with NaN du/dv', () => {
    const enemies = makeEnemies(2);
    dispatcher.dispatchTasks(1, enemies as any, makePlayers() as any, 1/60);
    const taskId = (sentMessages[0].data as any).taskId;

    const badResult: AiResult = {
      type: 'ai_result',
      taskId,
      tick: 1,
      results: [
        { id: 'e0', du: NaN, dv: 0 },
        { id: 'e1', du: 0, dv: Infinity },
      ],
    };

    dispatcher.receiveResult(badResult, 1);
    expect(sentAcks[0].outcome).toBe('rejected_validation');
  });

  it('rejects result that exceeds maximum speed', () => {
    // Use 4 enemies: at 50% load, floor(4 * 0.5) = 2 delegated → message sent
    const enemies = makeEnemies(4);
    dispatcher.dispatchTasks(1, enemies as any, makePlayers() as any, 1/60);
    const taskId = (sentMessages[0].data as any).taskId;
    const task = sentMessages[0].data as any;
    const firstEnemyId = task.enemies[0].id;

    // Grunt speed = 0.07 UV/s, dt = 1/60 → max ~0.00128 UV/tick
    // Send 100x that — clearly exceeds speed limit
    const badResult: AiResult = {
      type: 'ai_result',
      taskId,
      tick: 1,
      results: [{ id: firstEnemyId, du: 0.5, dv: 0 }], // Way too fast
    };

    dispatcher.receiveResult(badResult, 1);
    expect(sentAcks[0].outcome).toBe('rejected_validation');
  });

  it('rejects stale results (arrived too many ticks late)', () => {
    const enemies = makeEnemies(2);
    const players = makePlayers();
    dispatcher.dispatchTasks(1, enemies as any, players as any, 1/60);
    const taskId = (sentMessages[0].data as any).taskId;

    const results = enemies.map(e => computeServerAI(e, players, 1/60));
    const staleResult: AiResult = {
      type: 'ai_result',
      taskId,
      tick: 1,
      results,
    };

    // Pass currentTick=10 — task was from tick 1, that's 9 ticks late (> maxLateTicks=2)
    dispatcher.receiveResult(staleResult, 10);
    expect(sentAcks[0].outcome).toBe('rejected_stale');
  });

  it('getValidatedResult returns null for unknown enemy', () => {
    expect(dispatcher.getValidatedResult('nonexistent')).toBeNull();
  });

  it('getValidatedResult returns result after successful validation', () => {
    // Use 100% shared load to ensure all enemies are delegated
    pool.setSharedLoad(100);
    const enemies = makeEnemies(2);
    const players = makePlayers();
    dispatcher.dispatchTasks(1, enemies as any, players as any, 1/60);
    const taskId = (sentMessages[0].data as any).taskId;
    const delegatedEnemies = (sentMessages[0].data as any).enemies as EnemySnapshot[];

    // Only compute results for the enemies that were actually delegated
    const results = delegatedEnemies.map(e => computeServerAI(e, players, 1/60));
    dispatcher.receiveResult({
      type: 'ai_result', taskId, tick: 1, results,
    }, 1);

    for (const e of delegatedEnemies) {
      expect(dispatcher.getValidatedResult(e.id)).not.toBeNull();
    }
  });

  it('endTick() clears pending results', () => {
    // Use 100% shared load to ensure at least one enemy is delegated
    pool.setSharedLoad(100);
    const enemies = makeEnemies(2);
    const players = makePlayers();
    dispatcher.dispatchTasks(1, enemies as any, players as any, 1/60);
    const taskId = (sentMessages[0].data as any).taskId;
    const delegatedEnemies = (sentMessages[0].data as any).enemies as EnemySnapshot[];

    const results = delegatedEnemies.map(e => computeServerAI(e, players, 1/60));
    dispatcher.receiveResult({ type: 'ai_result', taskId, tick: 1, results }, 1);

    const firstId = delegatedEnemies[0].id;
    expect(dispatcher.getValidatedResult(firstId)).not.toBeNull();
    dispatcher.endTick(1);
    expect(dispatcher.getValidatedResult(firstId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ComputationPool tests
// ---------------------------------------------------------------------------

describe('ComputationPool', () => {
  it('returns null when sharedLoad is 0', () => {
    const pool = new ComputationPool();
    pool.addClient('c1');
    pool.updateHeartbeat('c1', 20, 90);
    pool.setSharedLoad(0);
    expect(pool.selectClient()).toBeNull();
  });

  it('returns eligible client when sharedLoad > 0', () => {
    const pool = new ComputationPool();
    pool.addClient('c1');
    pool.updateHeartbeat('c1', 20, 90);
    pool.setSharedLoad(50);
    expect(pool.selectClient()).toBe('c1');
  });

  it('skips overloaded clients (cpuLoad >= 70)', () => {
    const pool = new ComputationPool();
    pool.addClient('c1');
    pool.updateHeartbeat('c1', 80, 90); // overloaded
    pool.setSharedLoad(50);
    expect(pool.selectClient()).toBeNull();
  });

  it('evicts client after too many rejections', () => {
    const pool = new ComputationPool();
    pool.addClient('c1');
    pool.updateHeartbeat('c1', 20, 90);
    pool.setSharedLoad(50);

    // Simulate 100 tasks in pairs (send + validate), 10% rejected — above 5% threshold
    // recordValidationResult increments the window counter, so 100 calls = full window
    for (let i = 0; i < 100; i++) {
      pool.recordTaskSent('c1');
      const rejected = i < 10; // First 10 are rejected = 10%
      pool.recordValidationResult('c1', rejected);
    }

    // After 100 validated tasks with 10% rejection rate, c1 should be evicted
    expect(pool.selectClient()).toBeNull();
  });

  it('picks lowest-load client when multiple eligible', () => {
    const pool = new ComputationPool();
    pool.addClient('c1');
    pool.addClient('c2');
    pool.updateHeartbeat('c1', 60, 90);
    pool.updateHeartbeat('c2', 20, 90); // lower load
    pool.setSharedLoad(50);

    expect(pool.selectClient()).toBe('c2');
  });
});
