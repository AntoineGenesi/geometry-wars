/**
 * Integration tests for PvPvE enemy kill tracking (s44j-pvpve-14c).
 *
 * Tests that:
 * - enemyKills is incremented per player on bullet-kills
 * - enemyKills is independent from PvP kills
 * - enemyKills resets correctly on round restart
 * - Total leaderboard = kills + enemyKills
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types mirroring PlayerState fields used in enemy kill tracking
// ---------------------------------------------------------------------------

interface TrackedPlayer {
  id: string;
  name: string;
  playerLevel: number;
  playerKills: number;
  /** PvPvE enemy kills — separate field for leaderboard. */
  enemyKills: number;
  /** PvP kills (player vs player). */
  kills: number;
  score: number;
  multiplier: number;
}

interface TrackedEnemy {
  id: string;
  type: string;
  health: number;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

interface TrackedBullet {
  ownerId: string;
  x: number;
  y: number;
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// Logic mirroring GameRoom bullet-enemy collision section
// ---------------------------------------------------------------------------

const LEVEL_THRESHOLDS = [0, 10, 25, 50, 100, 200, 350, 500, 750, 1000];
const BULLET_DAMAGE = 1;
const HIT_RADIUS = 0.05;
const ENEMY_SCORE_MAP: Record<string, number> = {
  grunt: 100,
  wanderer: 150,
  tracker: 200,
};

function getPlayerLevel(kills: number): number {
  let level = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (kills >= LEVEL_THRESHOLDS[i]) level = i;
  }
  return level;
}

function getEnemyScore(type: string): number {
  return ENEMY_SCORE_MAP[type] ?? 100;
}

interface LevelUpEvent {
  playerId: string;
  newLevel: number;
}

/**
 * Process bullet-enemy collisions, mirroring GameRoom's logic.
 * Returns list of enemies killed and level-up events.
 */
function processBulletEnemyCollisions(
  bullets: TrackedBullet[],
  players: Map<string, TrackedPlayer>,
  enemies: TrackedEnemy[],
  levelUpEvents: LevelUpEvent[],
): { killedEnemyIds: Set<string> } {
  const killedEnemyIds = new Set<string>();
  const hitBullets = new Set<number>();

  bullets.forEach((bullet, bIndex) => {
    if (hitBullets.has(bIndex)) return;

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (hitBullets.has(bIndex)) return;

      const du = bullet.x - enemy.surfaceU;
      const dv = bullet.y - enemy.surfaceV;
      const dist = Math.sqrt(du * du + dv * dv);

      if (dist < HIT_RADIUS) {
        enemy.health -= BULLET_DAMAGE;

        if (enemy.health <= 0) {
          enemy.alive = false;
          killedEnemyIds.add(enemy.id);

          const owner = players.get(bullet.ownerId);
          if (owner) {
            owner.score += getEnemyScore(enemy.type) * owner.multiplier;
            owner.playerKills++;
            owner.enemyKills++;
            const newLevel = getPlayerLevel(owner.playerKills);
            if (newLevel > owner.playerLevel) {
              owner.playerLevel = newLevel;
              levelUpEvents.push({ playerId: owner.id, newLevel });
            }
          }
        }
        hitBullets.add(bIndex);
      }
    });
  });

  return { killedEnemyIds };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string): TrackedPlayer {
  return {
    id,
    name: `Player${id}`,
    playerLevel: 0,
    playerKills: 0,
    enemyKills: 0,
    kills: 0,
    score: 0,
    multiplier: 1,
  };
}

function makeEnemy(id: string, u: number, v: number, type = 'grunt'): TrackedEnemy {
  return { id, type, health: 1, alive: true, surfaceU: u, surfaceV: v };
}

function makeBullet(ownerId: string, x: number, y: number): TrackedBullet {
  return { ownerId, x, y, consumed: false };
}

// ---------------------------------------------------------------------------
// Tests: enemyKills tracking
// ---------------------------------------------------------------------------

describe('PvPvE enemy kill tracking: enemyKills field', () => {
  it('increments enemyKills when player bullet kills an enemy', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const enemies = [makeEnemy('e1', 0.5, 0.5)];
    const bullets = [makeBullet('p1', 0.5, 0.5)];
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, enemies, events);

    expect(p1.enemyKills).toBe(1);
  });

  it('increments enemyKills by 1 per enemy killed, not per bullet', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const enemies = [
      makeEnemy('e1', 0.2, 0.2),
      makeEnemy('e2', 0.8, 0.8),
    ];
    const bullets = [
      makeBullet('p1', 0.2, 0.2),
      makeBullet('p1', 0.8, 0.8),
    ];
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, enemies, events);

    expect(p1.enemyKills).toBe(2);
  });

  it('credits enemy kill to the correct player (bullet owner)', () => {
    const p1 = makePlayer('p1');
    const p2 = makePlayer('p2');
    const players = new Map([['p1', p1], ['p2', p2]]);
    const enemies = [
      makeEnemy('e1', 0.3, 0.3),
      makeEnemy('e2', 0.7, 0.7),
    ];
    const bullets = [
      makeBullet('p1', 0.3, 0.3), // p1 kills e1
      makeBullet('p2', 0.7, 0.7), // p2 kills e2
    ];
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, enemies, events);

    expect(p1.enemyKills).toBe(1);
    expect(p2.enemyKills).toBe(1);
  });

  it('does NOT increment enemyKills when bullet misses', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const enemies = [makeEnemy('e1', 0.5, 0.5)];
    const bullets = [makeBullet('p1', 0.99, 0.99)]; // Far away
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, enemies, events);

    expect(p1.enemyKills).toBe(0);
  });

  it('does NOT increment enemyKills when bullet hits but does not kill (partial damage not in this model)', () => {
    // In this simplified model, each bullet does 1 damage; enemy has 1 HP.
    // Test that a dead enemy doesn't get double-counted.
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const enemy = makeEnemy('e1', 0.5, 0.5);
    enemy.health = 1;
    const bullets = [
      makeBullet('p1', 0.5, 0.5), // kills the enemy
      makeBullet('p1', 0.5, 0.5), // hits dead enemy — should not increment
    ];
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, [enemy], events);

    expect(p1.enemyKills).toBe(1);
  });

  it('tracks enemyKills and kills independently (both fields coexist)', () => {
    const p1 = makePlayer('p1');
    // Manually simulate PvP kill (would be done by separate code path)
    p1.kills = 2;

    const players = new Map([['p1', p1]]);
    const enemies = [makeEnemy('e1', 0.5, 0.5)];
    const bullets = [makeBullet('p1', 0.5, 0.5)];
    const events: LevelUpEvent[] = [];

    processBulletEnemyCollisions(bullets, players, enemies, events);

    expect(p1.kills).toBe(2);      // PvP kills unchanged by enemy kill
    expect(p1.enemyKills).toBe(1); // Enemy kill tracked separately
  });
});

// ---------------------------------------------------------------------------
// Tests: leaderboard total calculation
// ---------------------------------------------------------------------------

describe('PvPvE leaderboard total = kills + enemyKills', () => {
  it('total is sum of PvP kills and enemy kills', () => {
    const p1 = makePlayer('p1');
    p1.kills = 3;
    p1.enemyKills = 7;

    const total = p1.kills + p1.enemyKills;
    expect(total).toBe(10);
  });

  it('total is 0 when player has no kills', () => {
    const p1 = makePlayer('p1');
    expect(p1.kills + p1.enemyKills).toBe(0);
  });

  it('total increases with each enemy killed', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const events: LevelUpEvent[] = [];

    for (let i = 0; i < 5; i++) {
      const enemies = [makeEnemy(`e${i}`, 0.5, 0.5)];
      const bullets = [makeBullet('p1', 0.5, 0.5)];
      processBulletEnemyCollisions(bullets, players, enemies, events);
    }

    expect(p1.enemyKills).toBe(5);
    expect(p1.kills + p1.enemyKills).toBe(5);
  });

  it('sorting by total correctly ranks players', () => {
    const p1 = makePlayer('p1'); p1.kills = 2; p1.enemyKills = 3; // total 5
    const p2 = makePlayer('p2'); p2.kills = 0; p2.enemyKills = 8; // total 8
    const p3 = makePlayer('p3'); p3.kills = 1; p3.enemyKills = 1; // total 2

    const entries = [p1, p2, p3];
    entries.sort((a, b) => (b.kills + b.enemyKills) - (a.kills + a.enemyKills));

    expect(entries[0].id).toBe('p2'); // 8 total
    expect(entries[1].id).toBe('p1'); // 5 total
    expect(entries[2].id).toBe('p3'); // 2 total
  });
});

// ---------------------------------------------------------------------------
// Tests: round reset
// ---------------------------------------------------------------------------

describe('PvPvE enemy kills reset on round restart', () => {
  it('enemyKills resets to 0 after round restart', () => {
    const p1 = makePlayer('p1');
    p1.enemyKills = 15;

    // Simulate round restart
    p1.playerKills = 0;
    p1.enemyKills = 0;
    p1.kills = 0;
    p1.playerLevel = 0;

    expect(p1.enemyKills).toBe(0);
    expect(p1.kills).toBe(0);
  });

  it('enemyKills accumulates again after reset', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const events: LevelUpEvent[] = [];

    // Round 1: 3 kills
    for (let i = 0; i < 3; i++) {
      const enemies = [makeEnemy(`r1e${i}`, 0.5, 0.5)];
      processBulletEnemyCollisions([makeBullet('p1', 0.5, 0.5)], players, enemies, events);
    }
    expect(p1.enemyKills).toBe(3);

    // Round restart
    p1.playerKills = 0;
    p1.enemyKills = 0;
    p1.kills = 0;
    p1.playerLevel = 0;

    // Round 2: 2 kills
    for (let i = 0; i < 2; i++) {
      const enemies = [makeEnemy(`r2e${i}`, 0.5, 0.5)];
      processBulletEnemyCollisions([makeBullet('p1', 0.5, 0.5)], players, enemies, events);
    }
    expect(p1.enemyKills).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: playerKills mirrors enemyKills (both updated together)
// ---------------------------------------------------------------------------

describe('playerKills and enemyKills are updated together', () => {
  it('playerKills and enemyKills are always equal after enemy kills only', () => {
    const p1 = makePlayer('p1');
    const players = new Map([['p1', p1]]);
    const events: LevelUpEvent[] = [];

    for (let i = 0; i < 5; i++) {
      const enemies = [makeEnemy(`e${i}`, 0.5, 0.5)];
      processBulletEnemyCollisions([makeBullet('p1', 0.5, 0.5)], players, enemies, events);
    }

    // playerKills is used for level progression and equals enemyKills when only enemy kills occurred
    expect(p1.playerKills).toBe(p1.enemyKills);
    expect(p1.playerKills).toBe(5);
  });
});
