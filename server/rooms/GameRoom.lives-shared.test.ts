/**
 * Regression test for S36: MP lives shared — enemy hits all players in same tick.
 *
 * Bug: The server collision loop iterated ALL players for EACH enemy. An enemy
 * within 0.04 UV of multiple players would decrement BOTH players' lives in the
 * same tick. `wasHit` was per-player (preventing a player from being hit by 2
 * enemies), but there was no per-enemy guard (an enemy could hit multiple players).
 *
 * Fix: Add a `hitEnemyIds` Set before the player forEach. When an enemy hits a
 * player, add its ID to the set. Skip enemies already in the set for subsequent
 * players.
 *
 * These tests validate the fix logic in isolation (pure simulation, no Colyseus).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the collision logic from GameRoom.checkCollisions() in isolation
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  alive: boolean;
  lives: number;
  surfaceU: number;
  surfaceV: number;
  invincible: number;
}

interface Enemy {
  id: string;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

/** Wrap-aware UV distance (mirrors GameRoom.uvDistWrapped for non-V-wrapping surfaces). */
function uvDistWrapped(u1: number, v1: number, u2: number, v2: number): number {
  let du = Math.abs(u1 - u2);
  if (du > 0.5) du = 1 - du;
  const dv = Math.abs(v1 - v2);
  return Math.sqrt(du * du + dv * dv);
}

/** Run one tick of player-enemy collisions WITH the hitEnemyIds fix (the correct behaviour). */
function checkCollisionsFixed(players: Player[], enemies: Enemy[]): void {
  const hitEnemyIds = new Set<string>();

  players.forEach((player) => {
    if (!player.alive) return;
    if (player.invincible > 0) return;

    let wasHit = false;

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (wasHit) return;
      if (hitEnemyIds.has(enemy.id)) return; // Fix: each enemy hits at most one player

      const dist = uvDistWrapped(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
      if (dist < 0.04) {
        wasHit = true;
        hitEnemyIds.add(enemy.id);
        player.lives--;
      }
    });
  });
}

/** Run one tick of player-enemy collisions WITHOUT the hitEnemyIds fix (the buggy behaviour). */
function checkCollisionsBuggy(players: Player[], enemies: Enemy[]): void {
  players.forEach((player) => {
    if (!player.alive) return;
    if (player.invincible > 0) return;

    let wasHit = false;

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (wasHit) return;

      const dist = uvDistWrapped(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
      if (dist < 0.04) {
        wasHit = true;
        player.lives--;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe('GameRoom player-enemy collision: per-enemy hit guard (S36 regression)', () => {
  it('FIXED: 2 players at same UV with 1 overlapping enemy — only 1 player loses a life', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];

    checkCollisionsFixed(players, enemies);

    const livesLost = players.filter(p => p.lives < 3).length;
    expect(livesLost).toBe(1); // Only one player should be hit
    expect(players[0].lives + players[1].lives).toBe(5); // Total lives lost = 1
  });

  it('BUGGY (documents the old behaviour): 2 players at same UV with 1 enemy — BOTH lose a life', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];

    checkCollisionsBuggy(players, enemies);

    // This is the BUG: both players lose a life from the same enemy
    expect(players[0].lives).toBe(2);
    expect(players[1].lives).toBe(2);
  });

  it('FIXED: enemy close to both players — only the first player iterated is hit', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.50, surfaceV: 0.50, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.51, surfaceV: 0.50, invincible: 0 }, // 0.01 UV away
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.505, surfaceV: 0.50 }, // midway between both players
    ];

    checkCollisionsFixed(players, enemies);

    // Total lives lost must be exactly 1 (not 2)
    const totalLivesLost = (3 - players[0].lives) + (3 - players[1].lives);
    expect(totalLivesLost).toBe(1);
  });

  it('FIXED: 2 different enemies, each near a different player — both players can be hit', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.2, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.8, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.2, surfaceV: 0.5 }, // hits p1
      { id: 'e2', alive: true, surfaceU: 0.8, surfaceV: 0.5 }, // hits p2
    ];

    checkCollisionsFixed(players, enemies);

    // Each player should lose a life from their respective enemy
    expect(players[0].lives).toBe(2);
    expect(players[1].lives).toBe(2);
  });

  it('FIXED: invincible player is skipped — enemy not consumed, still hits other player', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 1.5 }, // invincible
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];

    checkCollisionsFixed(players, enemies);

    // p1 is invincible — should not be hit
    expect(players[0].lives).toBe(3);
    // p2 is vulnerable — should be hit (enemy wasn't consumed by p1)
    expect(players[1].lives).toBe(2);
  });

  it('FIXED: dead enemy is skipped entirely', () => {
    const players: Player[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: Enemy[] = [
      { id: 'e1', alive: false, surfaceU: 0.5, surfaceV: 0.5 }, // dead enemy
    ];

    checkCollisionsFixed(players, enemies);

    expect(players[0].lives).toBe(3); // No hit from dead enemy
  });
});
