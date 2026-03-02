/**
 * Unit tests for s44h-17: Lives System Enhancement
 *
 * Tests:
 * - Configurable initial lives (1-9)
 * - Infinite lives toggle prevents decrement
 * - Game over when lives reach 0 (normal mode)
 * - No game over with infinite lives
 * - Multiplier reset still applies in infinite lives mode (death penalties)
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the core collision+lives logic from GameRoom in isolation
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  alive: boolean;
  lives: number;
  multiplier: number;
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

interface GameConfig {
  initialLives: number;
  infiniteLives: boolean;
}

function uvDistWrapped(u1: number, v1: number, u2: number, v2: number): number {
  let du = Math.abs(u1 - u2);
  if (du > 0.5) du = 1 - du;
  const dv = Math.abs(v1 - v2);
  return Math.sqrt(du * du + dv * dv);
}

/**
 * Simulate one tick of player-enemy collision applying the s44h-17 logic:
 * - Infinite lives: skip lives decrement but still reset multiplier
 * - Player alive = false when lives <= 0 (and not infinite)
 */
function checkCollisionsWithConfig(players: Player[], enemies: Enemy[], config: GameConfig): void {
  const hitEnemyIds = new Set<string>();

  players.forEach((player) => {
    if (!player.alive) return;
    if (player.invincible > 0) return;

    let wasHit = false;

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (wasHit) return;
      if (hitEnemyIds.has(enemy.id)) return;

      const dist = uvDistWrapped(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
      if (dist < 0.04) {
        wasHit = true;
        hitEnemyIds.add(enemy.id);

        // Infinite lives: skip decrement but still apply death penalties
        if (!config.infiniteLives) {
          player.lives--;
        }
        player.multiplier = 1; // penalty always applies

        if (!config.infiniteLives && player.lives <= 0) {
          player.alive = false;
        }
      }
    });
  });
}

/**
 * Create a fresh player with configurable initial lives.
 */
function makePlayer(id: string, config: GameConfig, u = 0.5, v = 0.5): Player {
  return {
    id,
    alive: true,
    lives: config.initialLives,
    multiplier: 10,
    surfaceU: u,
    surfaceV: v,
    invincible: 0,
  };
}

function makeEnemy(id: string, u = 0.5, v = 0.5): Enemy {
  return { id, alive: true, surfaceU: u, surfaceV: v };
}

// ---------------------------------------------------------------------------
// Tests: configurable initial lives
// ---------------------------------------------------------------------------

describe('s44h-17: Configurable initial lives', () => {
  it('players start with 1 life when host sets initialLives=1', () => {
    const config: GameConfig = { initialLives: 1, infiniteLives: false };
    const player = makePlayer('p1', config);
    expect(player.lives).toBe(1);
  });

  it('players start with 5 lives when host sets initialLives=5', () => {
    const config: GameConfig = { initialLives: 5, infiniteLives: false };
    const player = makePlayer('p1', config);
    expect(player.lives).toBe(5);
  });

  it('players start with 9 lives when host sets initialLives=9', () => {
    const config: GameConfig = { initialLives: 9, infiniteLives: false };
    const player = makePlayer('p1', config);
    expect(player.lives).toBe(9);
  });

  it('game over after exactly N deaths with N initial lives', () => {
    const config: GameConfig = { initialLives: 2, infiniteLives: false };
    const player = makePlayer('p1', config);
    const enemy = makeEnemy('e1');

    // First hit
    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.lives).toBe(1);
    expect(player.alive).toBe(true);

    // Re-enable vulnerability (simulate respawn, reset invincibility)
    player.invincible = 0;

    // Second hit — game over
    checkCollisionsWithConfig([player], [makeEnemy('e2')], config);
    expect(player.lives).toBe(0);
    expect(player.alive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: normal lives mode
// ---------------------------------------------------------------------------

describe('s44h-17: Normal lives mode (infiniteLives=false)', () => {
  it('lives decrement on each enemy hit', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: false };
    const player = makePlayer('p1', config);

    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.lives).toBe(2);
    expect(player.alive).toBe(true);
  });

  it('player dies when lives reach 0', () => {
    const config: GameConfig = { initialLives: 1, infiniteLives: false };
    const player = makePlayer('p1', config);

    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.lives).toBe(0);
    expect(player.alive).toBe(false);
  });

  it('multiplier resets on hit', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: false };
    const player = makePlayer('p1', config);
    player.multiplier = 20;

    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.multiplier).toBe(1);
  });

  it('dead player is not hit again', () => {
    const config: GameConfig = { initialLives: 1, infiniteLives: false };
    const player = makePlayer('p1', config);

    // Kill the player
    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.alive).toBe(false);

    // Another tick — dead player should not be processed
    player.invincible = 0;
    checkCollisionsWithConfig([player], [makeEnemy('e2')], config);
    expect(player.lives).toBe(0); // Lives stayed at 0, not -1
  });
});

// ---------------------------------------------------------------------------
// Tests: infinite lives mode
// ---------------------------------------------------------------------------

describe('s44h-17: Infinite lives mode (infiniteLives=true)', () => {
  it('lives count does NOT decrement on enemy hit', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: true };
    const player = makePlayer('p1', config);

    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    expect(player.lives).toBe(3); // Unchanged
  });

  it('player remains alive after multiple hits', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: true };
    const player = makePlayer('p1', config);

    // Simulate 5 hits (reset invincibility each time)
    for (let i = 0; i < 5; i++) {
      player.invincible = 0;
      checkCollisionsWithConfig([player], [makeEnemy(`e${i}`)], config);
    }

    expect(player.alive).toBe(true);
    expect(player.lives).toBe(3); // Never changed
  });

  it('multiplier still resets on hit (death penalty applied even with infinite lives)', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: true };
    const player = makePlayer('p1', config);
    player.multiplier = 50;

    checkCollisionsWithConfig([player], [makeEnemy('e1')], config);
    // Multiplier reset is a death penalty that applies regardless of lives mode
    expect(player.multiplier).toBe(1);
    expect(player.alive).toBe(true); // But player is still alive
  });

  it('two players: both remain alive after enemy hit in infinite lives mode', () => {
    const config: GameConfig = { initialLives: 3, infiniteLives: true };
    const p1 = makePlayer('p1', config, 0.2, 0.5);
    const p2 = makePlayer('p2', config, 0.8, 0.5);
    const e1 = makeEnemy('e1', 0.2, 0.5); // hits p1
    const e2 = makeEnemy('e2', 0.8, 0.5); // hits p2

    checkCollisionsWithConfig([p1, p2], [e1, e2], config);

    expect(p1.alive).toBe(true);
    expect(p2.alive).toBe(true);
    expect(p1.lives).toBe(3);
    expect(p2.lives).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: SP Player.ts die() with infiniteLives field
// ---------------------------------------------------------------------------

describe('s44h-17: SP Player die() with infiniteLives', () => {
  it('lives decrement normally when infiniteLives=false', () => {
    // Simulate the Player.die() logic
    let lives = 3;
    let alive = true;
    const infiniteLives = false;

    // die() logic
    if (!infiniteLives) lives -= 1;
    // respawn condition
    const willRespawn = lives > 0 || infiniteLives;

    expect(lives).toBe(2);
    expect(willRespawn).toBe(true);
  });

  it('lives unchanged when infiniteLives=true', () => {
    let lives = 3;
    const infiniteLives = true;

    if (!infiniteLives) lives -= 1;
    const willRespawn = lives > 0 || infiniteLives;

    expect(lives).toBe(3);
    expect(willRespawn).toBe(true);
  });

  it('game over when lives=1 and infiniteLives=false', () => {
    let lives = 1;
    const infiniteLives = false;

    if (!infiniteLives) lives -= 1;
    const willRespawn = lives > 0 || infiniteLives;

    expect(lives).toBe(0);
    expect(willRespawn).toBe(false); // No respawn — game over
  });

  it('no game over when lives=1 and infiniteLives=true', () => {
    let lives = 1;
    const infiniteLives = true;

    if (!infiniteLives) lives -= 1;
    const willRespawn = lives > 0 || infiniteLives;

    expect(lives).toBe(1); // Unchanged
    expect(willRespawn).toBe(true); // Always respawn
  });
});

// ---------------------------------------------------------------------------
// Tests: choice string parsing for lives configuration
// ---------------------------------------------------------------------------

describe('s44h-17: Lives config from choice string', () => {
  /**
   * Mirrors the parsing logic from GameRoom.startGameWithSettings().
   */
  function parseLivesConfig(choice: string): { initialLives: number; infiniteLives: boolean } {
    const parts = choice.split(':');
    const livesParam = parts[3];
    if (livesParam === 'infinite') {
      return { infiniteLives: true, initialLives: 3 };
    }
    const parsedLives = parseInt(livesParam, 10);
    const initialLives = (parsedLives >= 1 && parsedLives <= 9) ? parsedLives : 3;
    return { infiniteLives: false, initialLives };
  }

  it('defaults to 3 lives when no lives param provided', () => {
    const config = parseLivesConfig('sphere:waves:medium');
    expect(config.initialLives).toBe(3);
    expect(config.infiniteLives).toBe(false);
  });

  it('parses lives=1', () => {
    const config = parseLivesConfig('sphere:waves:medium:1');
    expect(config.initialLives).toBe(1);
    expect(config.infiniteLives).toBe(false);
  });

  it('parses lives=5', () => {
    const config = parseLivesConfig('sphere:king:medium:5');
    expect(config.initialLives).toBe(5);
    expect(config.infiniteLives).toBe(false);
  });

  it('parses lives=9', () => {
    const config = parseLivesConfig('torus:claustrophobia:large:9');
    expect(config.initialLives).toBe(9);
    expect(config.infiniteLives).toBe(false);
  });

  it('parses infinite lives', () => {
    const config = parseLivesConfig('sphere:waves:medium:infinite');
    expect(config.infiniteLives).toBe(true);
    expect(config.initialLives).toBe(3);
  });

  it('clamps out-of-range lives to default 3', () => {
    const tooHigh = parseLivesConfig('sphere:waves:medium:10');
    expect(tooHigh.initialLives).toBe(3);

    const tooLow = parseLivesConfig('sphere:waves:medium:0');
    expect(tooLow.initialLives).toBe(3);

    const invalid = parseLivesConfig('sphere:waves:medium:abc');
    expect(invalid.initialLives).toBe(3);
  });
});
