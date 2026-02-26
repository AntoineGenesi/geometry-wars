/**
 * S37 Verification: MP lives shared — hitEnemyIds fix applied to GameRoom.ts
 *
 * Confirms that server/rooms/GameRoom.ts checkCollisions() includes the
 * hitEnemyIds Set introduced in S36, which prevents one enemy from hitting
 * multiple players in the same tick.
 *
 * Key scenario from acceptance criteria:
 *   3 players, 1 enemy near all 3 → only 1 player loses a life (not all 3)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Structural check: verify the fix is actually in the source file
// ---------------------------------------------------------------------------

describe('S37 verification: hitEnemyIds fix applied to GameRoom.ts', () => {
  it('GameRoom.ts checkCollisions() contains hitEnemyIds Set declaration', () => {
    const src = readFileSync(resolve(__dirname, 'GameRoom.ts'), 'utf8');
    expect(src).toContain('const hitEnemyIds = new Set<string>()');
  });

  it('GameRoom.ts checkCollisions() guards enemies already in hitEnemyIds', () => {
    const src = readFileSync(resolve(__dirname, 'GameRoom.ts'), 'utf8');
    expect(src).toContain('hitEnemyIds.has(enemy.id)');
  });

  it('GameRoom.ts checkCollisions() adds hit enemies to hitEnemyIds', () => {
    const src = readFileSync(resolve(__dirname, 'GameRoom.ts'), 'utf8');
    expect(src).toContain('hitEnemyIds.add(enemy.id)');
  });
});

// ---------------------------------------------------------------------------
// Behavioural check: replicate the fixed logic, test the 3-player scenario
// ---------------------------------------------------------------------------

interface MockPlayer {
  id: string;
  alive: boolean;
  lives: number;
  surfaceU: number;
  surfaceV: number;
  invincible: number;
}

interface MockEnemy {
  id: string;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

function uvDist(u1: number, v1: number, u2: number, v2: number): number {
  let du = Math.abs(u1 - u2);
  if (du > 0.5) du = 1 - du;
  const dv = Math.abs(v1 - v2);
  return Math.sqrt(du * du + dv * dv);
}

/** Replicates the FIXED GameRoom.checkCollisions() player-enemy collision block. */
function fixedCollisions(players: MockPlayer[], enemies: MockEnemy[]): void {
  const hitEnemyIds = new Set<string>();

  players.forEach((player) => {
    if (!player.alive) return;
    if (player.invincible > 0) return;

    let wasHit = false;

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (wasHit) return;
      if (hitEnemyIds.has(enemy.id)) return; // Fix: each enemy hits at most one player

      const dist = uvDist(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
      if (dist < 0.04) {
        wasHit = true;
        hitEnemyIds.add(enemy.id);
        player.lives--;
      }
    });
  });
}

describe('S37 acceptance criteria: 3 players, 1 enemy near all 3 → only 1 player hit', () => {
  it('enemy overlapping all 3 players only hits 1 of them', () => {
    const players: MockPlayer[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p3', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: MockEnemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 }, // overlaps all 3
    ];

    fixedCollisions(players, enemies);

    const livesLost = players.reduce((acc, p) => acc + (3 - p.lives), 0);
    expect(livesLost).toBe(1); // Only 1 total life lost — not 3
  });

  it('3 players near enemy: exactly 2 remain at full lives after 1 hit', () => {
    const players: MockPlayer[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p3', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: MockEnemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];

    fixedCollisions(players, enemies);

    const fullLives = players.filter(p => p.lives === 3).length;
    const hitPlayers = players.filter(p => p.lives < 3).length;
    expect(hitPlayers).toBe(1);
    expect(fullLives).toBe(2);
  });

  it('3 players each near a DIFFERENT enemy: all 3 can be hit', () => {
    const players: MockPlayer[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.1, surfaceV: 0.5, invincible: 0 },
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },
      { id: 'p3', alive: true, lives: 3, surfaceU: 0.9, surfaceV: 0.5, invincible: 0 },
    ];
    const enemies: MockEnemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.1, surfaceV: 0.5 }, // near p1
      { id: 'e2', alive: true, surfaceU: 0.5, surfaceV: 0.5 }, // near p2
      { id: 'e3', alive: true, surfaceU: 0.9, surfaceV: 0.5 }, // near p3
    ];

    fixedCollisions(players, enemies);

    // All 3 players should each lose 1 life (different enemies)
    expect(players[0].lives).toBe(2);
    expect(players[1].lives).toBe(2);
    expect(players[2].lives).toBe(2);
  });

  it('invincible players are skipped, enemy can still hit a vulnerable player', () => {
    const players: MockPlayer[] = [
      { id: 'p1', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 1.0 }, // invincible
      { id: 'p2', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 1.0 }, // invincible
      { id: 'p3', alive: true, lives: 3, surfaceU: 0.5, surfaceV: 0.5, invincible: 0 },   // vulnerable
    ];
    const enemies: MockEnemy[] = [
      { id: 'e1', alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];

    fixedCollisions(players, enemies);

    // p1 and p2 skip (invincible). Enemy not yet consumed → hits p3.
    expect(players[0].lives).toBe(3);
    expect(players[1].lives).toBe(3);
    expect(players[2].lives).toBe(2); // p3 hit
  });
});
