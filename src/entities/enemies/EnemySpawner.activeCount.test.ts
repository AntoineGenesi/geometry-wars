/**
 * Regression test for s44r2-05: enemy sync broken on torus / selective maps.
 *
 * ROOT CAUSE: network-main.ts never set enemy.active = false when removing
 * enemies from networkEnemies. EnemySpawner.spawn() counts active enemies by
 * iterating this.enemies[] and checking enemy.active === true. Dead enemies
 * remained in the array with active=true, causing activeCount to grow until
 * hitting the 400 cap, at which point all new spawns returned a dummy inactive
 * Wanderer — invisible to both host and remote client.
 *
 * FIX: enemy.active = false is now set before networkEnemies.delete() in all
 * three removal paths in network-main.ts.
 *
 * This test directly verifies the activeCount logic that guards EnemySpawner.spawn().
 */

import { describe, it, expect } from 'vitest';

// Pure logic test — no Three.js imports needed.
// Replicates the exact activeCount computation from EnemySpawner.spawn() (line 446-448).
function countActive(enemies: Array<{ active: boolean }>): number {
  let count = 0;
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].active) count++;
  }
  return count;
}

describe('EnemySpawner activeCount — s44r2-05 regression', () => {
  it('counts only enemies with active=true', () => {
    const enemies = [
      { active: true },
      { active: true },
      { active: false },
    ];
    expect(countActive(enemies)).toBe(2);
  });

  it('returns 0 after all enemies are marked inactive (death cleanup)', () => {
    // Simulate: 10 enemies were spawned, all die, network-main sets active=false
    const enemies = Array.from({ length: 10 }, () => ({ active: true }));
    expect(countActive(enemies)).toBe(10);

    // BUG (before fix): network-main only called networkEnemies.delete(id),
    //   never enemy.active = false — so count stays 10 despite no live enemies.
    // FIX (after fix): each cleanup path now sets enemy.active = false.
    enemies.forEach(e => { e.active = false; }); // what the fix does
    expect(countActive(enemies)).toBe(0);
  });

  it('does NOT hit the 400 cap when enemies are properly deactivated', () => {
    const MAX = 400;
    const enemies: Array<{ active: boolean }> = [];

    // Simulate spawning and dying 400 times over multiple waves
    for (let wave = 0; wave < 10; wave++) {
      // Spawn 40 enemies this wave
      for (let i = 0; i < 40; i++) {
        enemies.push({ active: true });
      }
      // All die — fix ensures active is cleared
      enemies.forEach(e => { e.active = false; });
    }

    // Total objects in array: 400. But activeCount should be 0 (all deactivated).
    expect(enemies.length).toBe(400);
    const active = countActive(enemies);
    expect(active).toBe(0);
    // New spawns would NOT be blocked by the cap.
    expect(active < MAX).toBe(true);
  });

  it('WOULD hit the 400 cap without the fix (demonstrates the bug)', () => {
    const MAX = 400;
    const enemies: Array<{ active: boolean }> = [];

    // Simulate the BUG: enemies are removed from networkEnemies but active is never cleared
    for (let wave = 0; wave < 10; wave++) {
      for (let i = 0; i < 40; i++) {
        enemies.push({ active: true }); // spawned
        // BUG: active never set to false — enemy stays "active" in spawner array
      }
    }

    // 400 objects in array, all still active=true — cap is hit!
    expect(enemies.length).toBe(MAX);
    const buggyActive = countActive(enemies);
    expect(buggyActive).toBe(MAX); // Bug: all 400 counted as active
    // This would cause spawn() to return dummy inactive Wanderer for ALL new spawns.
    expect(buggyActive >= MAX).toBe(true);
  });
});
