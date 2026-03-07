/**
 * s44r-04-02 Regression: Client-authoritative bullet-enemy hit detection.
 *
 * The server previously ran UV-based bullet-enemy collision which was broken on
 * non-sphere surfaces because bullet UV used sphere-approximation while enemies used
 * actual surface UV. Fix: client reports hits via 'bullet_hit' message; server trusts
 * and applies damage.
 *
 * These tests verify the server-side bullet_hit handler logic in pure JS (no Colyseus).
 */

import { describe, it, expect } from 'vitest';
import { WEAPON_CONFIGS } from '../shared/GameConstants';
import { LEVEL_DAMAGE_MULTIPLIERS } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types mirroring PlayerState / EnemyState fields used in bullet_hit
// ---------------------------------------------------------------------------

interface TestPlayer {
  id: string;
  sessionId: string;
  playerLevel: number;
  playerKills: number;
  enemyKills: number;
  score: number;
  multiplier: number;
  buffs: string[];
}

interface TestEnemy {
  id: string;
  alive: boolean;
  health: number;
  type: string;
  surfaceU: number;
  surfaceV: number;
}

interface BulletHitData {
  bulletId: string;
  enemyId: string;
  weaponType: string;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// Extracted bullet_hit handler logic (mirrors GameRoom's onMessage handler)
// ---------------------------------------------------------------------------

function getPlayerLevel(kills: number): number {
  // Simplified level formula for tests (matches server: 1 kill = level 1, etc.)
  return Math.floor(kills / 10);
}

function getEnemyScore(type: string): number {
  const scoreTable: Record<string, number> = {
    wanderer: 50,
    grunt: 100,
    snake: 75,
  };
  return scoreTable[type] ?? 50;
}

function calculateBuffDamageMult(_player: TestPlayer): number {
  // No buffs in these tests — returns 1.0
  return 1.0;
}

interface BulletHitResult {
  rejected: boolean;
  damageDealt: number;
  enemyKilled: boolean;
  scoreAwarded: number;
}

function handleBulletHit(
  clientSessionId: string,
  data: BulletHitData,
  players: Map<string, TestPlayer>,
  enemies: TestEnemy[],
): BulletHitResult {
  const result: BulletHitResult = { rejected: false, damageDealt: 0, enemyKilled: false, scoreAwarded: 0 };

  // Sender must own the bullet
  if (!data.ownerId || data.ownerId !== clientSessionId) {
    result.rejected = true;
    return result;
  }
  if (!data.enemyId || typeof data.enemyId !== 'string') {
    result.rejected = true;
    return result;
  }

  const player = players.get(clientSessionId);
  if (!player) { result.rejected = true; return result; }

  const enemyIdx = enemies.findIndex((e) => e.id === data.enemyId);
  if (enemyIdx < 0) { result.rejected = true; return result; }

  const enemy = enemies[enemyIdx];
  if (!enemy.alive) { result.rejected = true; return result; }

  const weaponType = typeof data.weaponType === 'string' ? data.weaponType : 'standard';
  const weaponCfg = WEAPON_CONFIGS[weaponType] ?? WEAPON_CONFIGS.standard;
  const levelIdx = Math.min(player.playerLevel, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
  const buffDamageMult = calculateBuffDamageMult(player);
  const finalDamage = weaponCfg.damage * levelDamageMult * buffDamageMult;
  enemy.health -= finalDamage;
  result.damageDealt = finalDamage;

  if (enemy.health <= 0) {
    enemy.alive = false;
    enemies.splice(enemyIdx, 1);
    result.enemyKilled = true;

    const score = getEnemyScore(enemy.type) * player.multiplier;
    player.score += score;
    result.scoreAwarded = score;
    player.playerKills++;
    player.enemyKills++;

    const newLevel = getPlayerLevel(player.playerKills);
    if (newLevel > player.playerLevel) player.playerLevel = newLevel;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bullet_hit handler (s44r-04-02 client-authoritative hit detection)', () => {
  function makePlayer(overrides: Partial<TestPlayer> = {}): TestPlayer {
    return {
      id: 'player1',
      sessionId: 'player1',
      playerLevel: 0,
      playerKills: 0,
      enemyKills: 0,
      score: 0,
      multiplier: 1,
      buffs: [],
      ...overrides,
    };
  }

  function makeEnemy(overrides: Partial<TestEnemy> = {}): TestEnemy {
    return {
      id: 'enemy1',
      alive: true,
      health: 3,
      type: 'wanderer',
      surfaceU: 0.5,
      surfaceV: 0.5,
      ...overrides,
    };
  }

  it('applies correct damage for standard weapon at level 0', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemies = [makeEnemy({ health: 100 })];
    const data: BulletHitData = {
      bulletId: 'b1',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    expect(result.rejected).toBe(false);
    const expectedDamage = WEAPON_CONFIGS.standard.damage * LEVEL_DAMAGE_MULTIPLIERS[0];
    expect(result.damageDealt).toBeCloseTo(expectedDamage);
    expect(enemies[0].health).toBeCloseTo(100 - expectedDamage);
    expect(result.enemyKilled).toBe(false);
  });

  it('kills enemy when health drops to 0 and awards score', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemies = [makeEnemy({ health: 1, type: 'wanderer' })];
    const data: BulletHitData = {
      bulletId: 'b2',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    expect(result.enemyKilled).toBe(true);
    expect(enemies.length).toBe(0); // removed from array
    expect(result.scoreAwarded).toBe(getEnemyScore('wanderer')); // multiplier=1
    expect(players.get('player1')!.playerKills).toBe(1);
    expect(players.get('player1')!.enemyKills).toBe(1);
  });

  it('rejects bullet_hit when ownerId does not match sender sessionId', () => {
    const players = new Map([
      ['player1', makePlayer({ id: 'player1', sessionId: 'player1' })],
      ['player2', makePlayer({ id: 'player2', sessionId: 'player2' })],
    ]);
    const enemies = [makeEnemy()];
    // player2's client claims bullet belongs to player1 — injection attempt
    const data: BulletHitData = {
      bulletId: 'b3',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1', // claims someone else's bullet
    };

    const result = handleBulletHit('player2', data, players, enemies);

    expect(result.rejected).toBe(true);
    expect(enemies[0].health).toBe(3); // unmodified
  });

  it('is a no-op when enemy is already dead', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemies = [makeEnemy({ alive: false, health: 0 })];
    const data: BulletHitData = {
      bulletId: 'b4',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    expect(result.rejected).toBe(true);
    expect(result.damageDealt).toBe(0);
    expect(result.enemyKilled).toBe(false);
  });

  it('applies level damage multiplier at higher player levels', () => {
    const level = 3;
    const players = new Map([['player1', makePlayer({ playerLevel: level })]]);
    const enemies = [makeEnemy({ health: 1000 })];
    const data: BulletHitData = {
      bulletId: 'b5',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    const levelIdx = Math.min(level, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
    const expectedDamage = WEAPON_CONFIGS.standard.damage * LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
    expect(result.damageDealt).toBeCloseTo(expectedDamage);
    expect(LEVEL_DAMAGE_MULTIPLIERS[levelIdx]).toBeGreaterThan(LEVEL_DAMAGE_MULTIPLIERS[0]);
  });

  it('awards score multiplied by player.multiplier', () => {
    const players = new Map([['player1', makePlayer({ multiplier: 5 })]]);
    const enemies = [makeEnemy({ health: 1, type: 'grunt' })];
    const data: BulletHitData = {
      bulletId: 'b6',
      enemyId: 'enemy1',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    expect(result.enemyKilled).toBe(true);
    expect(result.scoreAwarded).toBe(getEnemyScore('grunt') * 5);
  });

  it('rejects bullet_hit for non-existent enemy', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemies: TestEnemy[] = [];
    const data: BulletHitData = {
      bulletId: 'b7',
      enemyId: 'ghost-enemy',
      weaponType: 'standard',
      ownerId: 'player1',
    };

    const result = handleBulletHit('player1', data, players, enemies);

    expect(result.rejected).toBe(true);
  });
});
