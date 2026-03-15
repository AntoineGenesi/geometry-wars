/**
 * Regression test for s44r18-01: MP invisible enemies still broken.
 *
 * ROOT CAUSE: EnemySpawner.spawn() returns a dummy inactive Wanderer when the
 * 400-cap is hit. In network-main.ts, getOrCreateEnemy() was storing this dummy
 * in the networkEnemies map. On subsequent onStateChange calls, the dummy was
 * returned early (enemy already in map), preventing the REAL enemy from ever
 * being created. Dummy has active=false → skipped in updateInstancesWithLOD
 * → zero-scale matrix → permanently invisible.
 *
 * RELATED BUG: In network mode, enemySpawner.update() is NOT called (server is
 * authoritative), so dead enemies accumulate in enemies[] across rounds. This
 * caused unbounded array growth and potentially premature 400-cap hits.
 *
 * FIX 1 (EnemySpawner.ts): Added cleanupInactiveEnemies() to purge dead enemies
 *   from enemies[] without calling update(). Call this before spawn() in network mode.
 *
 * FIX 2 (network-main.ts): After spawn(), if !enemy.active (dummy returned),
 *   dispose the dummy mesh and return null instead of storing it in networkEnemies.
 *   This lets the next onStateChange retry spawning with a real enemy.
 */

import { describe, it, expect } from 'vitest';

// ─── Pure logic replicas (no Three.js) ─────────────────────────────────────

/**
 * Replica of EnemySpawner.cleanupInactiveEnemies() logic.
 * In-place compaction: preserve only active entries.
 */
function cleanupInactiveEnemies(enemies: Array<{ active: boolean }>): void {
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < enemies.length; readIdx++) {
    if (enemies[readIdx].active) {
      enemies[writeIdx++] = enemies[readIdx];
    }
  }
  enemies.length = writeIdx;
}

/**
 * Replica of the activeCount scan in EnemySpawner.spawn().
 */
function countActive(enemies: Array<{ active: boolean }>): number {
  let count = 0;
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].active) count++;
  }
  return count;
}

/**
 * Replica of getOrCreateEnemy dummy detection logic:
 * returns null if spawn returned an inactive dummy.
 */
function getOrCreateEnemyLogic(
  networkEnemies: Map<string, { active: boolean }>,
  id: string,
  spawnFn: () => { active: boolean }
): { active: boolean } | null {
  // Early return if already tracked (this was the bug — dummies got stored here)
  if (networkEnemies.has(id)) {
    return networkEnemies.get(id)!;
  }

  const enemy = spawnFn();

  // s44r18-01 FIX: reject dummy inactive enemies — do NOT store in networkEnemies
  if (!enemy.active) {
    return null;
  }

  networkEnemies.set(id, enemy);
  return enemy;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('EnemySpawner.cleanupInactiveEnemies — s44r18-01 regression', () => {
  it('removes inactive enemies from the array', () => {
    const enemies = [
      { active: true },
      { active: false },
      { active: true },
      { active: false },
      { active: false },
    ];
    cleanupInactiveEnemies(enemies);
    expect(enemies.length).toBe(2);
    expect(enemies.every(e => e.active)).toBe(true);
  });

  it('preserves order of active enemies', () => {
    const e1 = { active: true, id: 1 };
    const e2 = { active: false, id: 2 };
    const e3 = { active: true, id: 3 };
    const enemies = [e1, e2, e3] as Array<{ active: boolean; id?: number }>;
    cleanupInactiveEnemies(enemies as Array<{ active: boolean }>);
    expect(enemies.length).toBe(2);
    expect((enemies[0] as { id?: number }).id).toBe(1);
    expect((enemies[1] as { id?: number }).id).toBe(3);
  });

  it('handles empty array', () => {
    const enemies: Array<{ active: boolean }> = [];
    cleanupInactiveEnemies(enemies);
    expect(enemies.length).toBe(0);
  });

  it('handles all-active array (no-op)', () => {
    const enemies = [{ active: true }, { active: true }, { active: true }];
    cleanupInactiveEnemies(enemies);
    expect(enemies.length).toBe(3);
  });

  it('handles all-inactive array (clears to empty)', () => {
    const enemies = [{ active: false }, { active: false }, { active: false }];
    cleanupInactiveEnemies(enemies);
    expect(enemies.length).toBe(0);
  });

  it('prevents unbounded array growth across rounds in network mode', () => {
    // In network mode, update() is not called — enemies accumulate as active=false.
    // cleanupInactiveEnemies() must compact the array between rounds.
    const enemies: Array<{ active: boolean }> = [];
    const MAX = 400;

    for (let round = 0; round < 5; round++) {
      // Spawn 100 enemies per round
      for (let i = 0; i < 100; i++) {
        enemies.push({ active: true });
      }
      // Active count should be fine: at most 100
      expect(countActive(enemies)).toBeLessThanOrEqual(100);
      expect(countActive(enemies)).toBeLessThan(MAX);

      // All die at end of round
      enemies.forEach(e => { e.active = false; });

      // WITHOUT cleanup: array grows to 500 entries after round 5,
      // but all inactive — so cap won't fire but O(n) scan is costly.
      // WITH cleanup: compact before next round
      cleanupInactiveEnemies(enemies);
      expect(enemies.length).toBe(0); // all dead → cleaned
    }

    // After 5 rounds × 100 enemies: array is empty, not 500 entries
    expect(enemies.length).toBe(0);
  });
});

describe('getOrCreateEnemy dummy detection — s44r18-01 regression', () => {
  it('returns null when spawn returns inactive dummy (cap hit)', () => {
    const networkEnemies = new Map<string, { active: boolean }>();
    // Simulate: 400-cap hit → spawn returns inactive dummy
    const dummySpawn = () => ({ active: false });

    const result = getOrCreateEnemyLogic(networkEnemies, 'enemy-1', dummySpawn);

    expect(result).toBeNull();
    // The dummy must NOT be stored — future calls should retry spawn
    expect(networkEnemies.has('enemy-1')).toBe(false);
  });

  it('stores real enemy when spawn succeeds', () => {
    const networkEnemies = new Map<string, { active: boolean }>();
    const realSpawn = () => ({ active: true });

    const result = getOrCreateEnemyLogic(networkEnemies, 'enemy-1', realSpawn);

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(networkEnemies.has('enemy-1')).toBe(true);
  });

  it('returns existing enemy on second call (early return — no double-spawn)', () => {
    const networkEnemies = new Map<string, { active: boolean }>();
    let spawnCount = 0;
    const realSpawn = () => { spawnCount++; return { active: true }; };

    getOrCreateEnemyLogic(networkEnemies, 'enemy-1', realSpawn);
    getOrCreateEnemyLogic(networkEnemies, 'enemy-1', realSpawn);

    expect(spawnCount).toBe(1); // spawned only once
  });

  it('REGRESSION: previously, dummy would be stored and slot permanently poisoned', () => {
    // BUG SCENARIO (before fix):
    // Round 4 wave: 400-cap hit → spawn returns dummy (active=false)
    // OLD CODE stored the dummy: networkEnemies.set(id, dummy)
    // Next onStateChange for same id: found in map → returned dummy → REAL never created
    // Result: enemy permanently invisible (active=false → zero-scale matrix)

    const networkEnemies = new Map<string, { active: boolean }>();
    let isCapHit = true;

    // With OLD code (storing dummy):
    const buggyGetOrCreate = (id: string) => {
      if (networkEnemies.has(id)) return networkEnemies.get(id)!;
      const enemy = isCapHit ? { active: false } : { active: true };
      networkEnemies.set(id, enemy); // BUG: always stores, even dummies
      return enemy;
    };

    // First call: cap hit, dummy stored
    const first = buggyGetOrCreate('enemy-1');
    expect(first.active).toBe(false); // dummy

    // Cap clears — but slot is poisoned
    isCapHit = false;
    const second = buggyGetOrCreate('enemy-1');
    // BUG: returns the stored dummy, never retries spawn
    expect(second.active).toBe(false); // still returns dummy — this is the bug

    // With NEW code (returning null, not storing):
    const networkEnemies2 = new Map<string, { active: boolean }>();
    isCapHit = true;

    const first2 = getOrCreateEnemyLogic(networkEnemies2, 'enemy-1', () =>
      isCapHit ? { active: false } : { active: true }
    );
    expect(first2).toBeNull(); // not stored

    isCapHit = false; // cap clears
    const second2 = getOrCreateEnemyLogic(networkEnemies2, 'enemy-1', () =>
      isCapHit ? { active: false } : { active: true }
    );
    // FIX: slot not poisoned → retry succeeds → real enemy stored
    expect(second2).not.toBeNull();
    expect(second2!.active).toBe(true);
  });
});
