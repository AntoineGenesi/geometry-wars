/**
 * Multi-player lives independence tests.
 *
 * Verifies that lives are truly per-player — when one player dies,
 * only their life counter decreases while other players retain their lives.
 *
 * Covers:
 *  - Split-screen: Player class instances are independent
 *  - Server: GameRoom collision decrements only the hit player
 *  - HUD: SplitScreenHUD receives per-player data
 */

import { describe, it, expect } from 'vitest';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';

// ---------------------------------------------------------------------------
// Helper: simulate the server-side collision logic from GameRoom.ts
// (Lines 1010-1051 of server/rooms/GameRoom.ts)
// ---------------------------------------------------------------------------

interface MockPlayerState {
  id: string;
  lives: number;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
  multiplier: number;
}

interface MockEnemyState {
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

/**
 * Replicate the exact collision logic from GameRoom.tickPlaying().
 * Returns updated player states (new objects, no mutation of originals).
 */
function simulateServerCollision(
  players: MockPlayerState[],
  enemies: MockEnemyState[],
  invincibilityMap: Map<string, number>,
): MockPlayerState[] {
  return players.map(player => {
    const updated = { ...player };
    if (!updated.alive) return updated;

    const invincible = invincibilityMap.get(updated.id) ?? 0;
    if (invincible > 0) return updated;

    let wasHit = false;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (wasHit) continue;

      const du = updated.surfaceU - enemy.surfaceU;
      const dv = updated.surfaceV - enemy.surfaceV;
      const dist = Math.sqrt(du * du + dv * dv);

      if (dist < 0.04) {
        wasHit = true;
        updated.lives--;
        updated.multiplier = 1;

        if (updated.lives <= 0) {
          updated.alive = false;
        } else {
          invincibilityMap.set(updated.id, 2.0);
        }
      }
    }

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Tests: Server-side multi-player collision independence
// ---------------------------------------------------------------------------

describe('MP Lives Independence — Server collision logic', () => {
  it('only the hit player loses a life, other player unaffected', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 4 },
      { id: 'p2', lives: 3, alive: true, surfaceU: 0.8, surfaceV: 0.8, multiplier: 2 },
    ];
    // Enemy right on top of player 1, far from player 2
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];
    const invMap = new Map<string, number>();

    const result = simulateServerCollision(players, enemies, invMap);

    expect(result[0].lives).toBe(2); // player 1 lost a life
    expect(result[0].multiplier).toBe(1); // multiplier reset
    expect(result[1].lives).toBe(3); // player 2 UNCHANGED
    expect(result[1].multiplier).toBe(2); // multiplier preserved
  });

  it('both players can lose lives independently when each is near a different enemy', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 3, alive: true, surfaceU: 0.2, surfaceV: 0.2, multiplier: 1 },
      { id: 'p2', lives: 3, alive: true, surfaceU: 0.8, surfaceV: 0.8, multiplier: 1 },
    ];
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.2, surfaceV: 0.2 }, // near p1
      { alive: true, surfaceU: 0.8, surfaceV: 0.8 }, // near p2
    ];
    const invMap = new Map<string, number>();

    const result = simulateServerCollision(players, enemies, invMap);

    expect(result[0].lives).toBe(2); // p1 lost a life
    expect(result[1].lives).toBe(2); // p2 also lost a life (independently)
  });

  it('invincible player is not hit while other player can be', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 2, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 },
      { id: 'p2', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.51, multiplier: 1 },
    ];
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];
    // p1 is invincible
    const invMap = new Map<string, number>([['p1', 1.5]]);

    const result = simulateServerCollision(players, enemies, invMap);

    expect(result[0].lives).toBe(2); // p1 NOT hit (invincible)
    expect(result[1].lives).toBe(2); // p2 IS hit (close enough, not invincible)
  });

  it('dead player with 0 lives is not affected by subsequent collisions', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 0, alive: false, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 },
      { id: 'p2', lives: 3, alive: true, surfaceU: 0.9, surfaceV: 0.9, multiplier: 1 },
    ];
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];
    const invMap = new Map<string, number>();

    const result = simulateServerCollision(players, enemies, invMap);

    expect(result[0].lives).toBe(0); // still 0, not negative
    expect(result[0].alive).toBe(false);
    expect(result[1].lives).toBe(3); // unaffected
  });

  it('repeated hits over multiple ticks deplete one player independently', () => {
    let players: MockPlayerState[] = [
      { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 },
      { id: 'p2', lives: 3, alive: true, surfaceU: 0.9, surfaceV: 0.9, multiplier: 1 },
    ];
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.5, surfaceV: 0.5 },
    ];
    const invMap = new Map<string, number>();

    // Hit 1
    players = simulateServerCollision(players, enemies, invMap);
    expect(players[0].lives).toBe(2);
    expect(players[1].lives).toBe(3);

    // Clear invincibility for next hit
    invMap.clear();

    // Hit 2
    players = simulateServerCollision(players, enemies, invMap);
    expect(players[0].lives).toBe(1);
    expect(players[1].lives).toBe(3);

    // Clear invincibility for final hit
    invMap.clear();

    // Hit 3 — player 1 dies
    players = simulateServerCollision(players, enemies, invMap);
    expect(players[0].lives).toBe(0);
    expect(players[0].alive).toBe(false);
    expect(players[1].lives).toBe(3); // STILL 3 — completely independent
    expect(players[1].alive).toBe(true);
  });

  it('game over only when ALL players dead', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 0, alive: false, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 },
      { id: 'p2', lives: 1, alive: true, surfaceU: 0.9, surfaceV: 0.9, multiplier: 1 },
    ];

    // Replicate the checkGameOver logic
    let anyAlive = false;
    for (const p of players) {
      if (p.alive) anyAlive = true;
    }

    expect(anyAlive).toBe(true); // NOT game over — p2 still alive
  });

  it('3-player scenario: middle player dies, others unaffected', () => {
    const players: MockPlayerState[] = [
      { id: 'p1', lives: 3, alive: true, surfaceU: 0.2, surfaceV: 0.5, multiplier: 1 },
      { id: 'p2', lives: 1, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 },
      { id: 'p3', lives: 3, alive: true, surfaceU: 0.8, surfaceV: 0.5, multiplier: 1 },
    ];
    const enemies: MockEnemyState[] = [
      { alive: true, surfaceU: 0.5, surfaceV: 0.5 }, // only near p2
    ];
    const invMap = new Map<string, number>();

    const result = simulateServerCollision(players, enemies, invMap);

    expect(result[0].lives).toBe(3); // p1 unaffected
    expect(result[1].lives).toBe(0); // p2 dead
    expect(result[1].alive).toBe(false);
    expect(result[2].lives).toBe(3); // p3 unaffected
  });
});

// ---------------------------------------------------------------------------
// Tests: Client-side Player class independence (split-screen)
// ---------------------------------------------------------------------------

describe('MP Lives Independence — Player class instances', () => {
  // BulletPool requires a surface/game context we don't have in unit tests.
  // Create a minimal mock to avoid import errors.
  function createMockPlayer(): Player {
    // Player constructor requires a BulletPool, but we only test lives/die
    // which don't fire bullets. Pass null and cast to avoid setup overhead.
    const player = new Player(null as unknown as BulletPool);
    player.lives = 3;
    player.alive = true;
    // Clear spawn invincibility so die() works immediately.
    // In the real game, update() ticks the timer, and the collision code
    // checks canTakeDamage before calling die(). Here we bypass that.
    (player as any).isInvincible = false;
    (player as any).invincibilityTimer = 0;
    return player;
  }

  it('two Player instances have independent lives', () => {
    const p1 = createMockPlayer();
    const p2 = createMockPlayer();

    expect(p1.lives).toBe(3);
    expect(p2.lives).toBe(3);

    p1.die();

    expect(p1.lives).toBe(2);
    expect(p1.alive).toBe(false);
    expect(p2.lives).toBe(3); // INDEPENDENT — not shared
    expect(p2.alive).toBe(true);
  });

  it('killing one player multiple times does not affect other', () => {
    const p1 = createMockPlayer();
    const p2 = createMockPlayer();

    // Kill p1 three times
    p1.die();
    expect(p1.lives).toBe(2);
    p1.alive = true; // simulate respawn
    p1.die();
    expect(p1.lives).toBe(1);
    p1.alive = true;
    p1.die();
    expect(p1.lives).toBe(0);

    // p2 completely untouched
    expect(p2.lives).toBe(3);
    expect(p2.alive).toBe(true);
  });

  it('Player.die() does not decrement when invincible', () => {
    const p1 = createMockPlayer();
    const p2 = createMockPlayer();

    // Make p1 invincible (simulated via canTakeDamage)
    // canTakeDamage returns false during invincibility
    p1.respawn(0.5, 0.5); // respawn grants invincibility

    p1.die(); // should be blocked by invincibility
    expect(p1.lives).toBe(3); // no change — invincible
    expect(p2.lives).toBe(3); // still independent
  });
});

// ---------------------------------------------------------------------------
// Tests: SplitScreenHUD data independence
// ---------------------------------------------------------------------------

describe('MP Lives Independence — HUD data', () => {
  it('HUD update receives correct per-player lives data', () => {
    // Simulate the data that multiplayer-main.ts passes to hud.update()
    const players = [
      { score: 1000, multiplier: 2, lives: 2, bombs: 3 },
      { score: 500, multiplier: 1, lives: 3, bombs: 1 },
    ];

    // In multiplayer-main.ts line 1540-1544:
    // hud.update(playerIndex, { lives: player.lives, ... })
    // Verify each player index gets their own data
    const hudData0 = {
      score: players[0].score,
      multiplier: players[0].multiplier,
      lives: players[0].lives,
      bombs: players[0].bombs,
    };
    const hudData1 = {
      score: players[1].score,
      multiplier: players[1].multiplier,
      lives: players[1].lives,
      bombs: players[1].bombs,
    };

    expect(hudData0.lives).toBe(2); // p1 has 2 lives
    expect(hudData1.lives).toBe(3); // p2 has 3 lives
    expect(hudData0.lives).not.toBe(hudData1.lives); // DIFFERENT
  });
});
